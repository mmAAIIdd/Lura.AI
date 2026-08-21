import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai_runtime import AIProviderError, AIProviderRuntime, RuntimeMessage
from app.config import get_settings
from app.database import get_db
from app.dependencies import AuthContext, require_auth, require_csrf
from app.models import Conversation, ConversationMessage, Project, ProjectSkill, ProjectTool, User
from app.rag import RetrievedChunk, format_context, retrieve_context
from app.routers.projects import get_owned_project
from app.schemas import (
    ConversationCreateRequest,
    ConversationDetailResponse,
    ConversationMessageRequest,
    ConversationMessageResponse,
    ConversationMessageWithSourcesResponse,
    ConversationResponse,
    MessageResponse,
    RetrievedChunkResponse,
)
from app.services import add_audit_log, rate_limit, utc_now

logger = logging.getLogger(__name__)
router = APIRouter(tags=["conversations"])
settings = get_settings()
runtime = AIProviderRuntime(settings)

CONVERSATION_LOAD_OPTIONS = (
    selectinload(Conversation.project).selectinload(Project.ai_model),
    selectinload(Conversation.project).selectinload(Project.skills).selectinload(ProjectSkill.skill),
    selectinload(Conversation.project).selectinload(Project.tools).selectinload(ProjectTool.tool),
)


def serialize_conversation(conversation: Conversation) -> ConversationResponse:
    return ConversationResponse(
        id=conversation.id,
        project_id=conversation.project_id,
        title=conversation.title,
        created_at=conversation.created_at,
        updated_at=conversation.updated_at,
    )


async def get_owned_conversation(
    db: AsyncSession, conversation_id: UUID, user_id: UUID
) -> Conversation:
    conversation = await db.scalar(
        select(Conversation)
        .options(*CONVERSATION_LOAD_OPTIONS)
        .where(Conversation.id == conversation_id, Conversation.owner_id == user_id)
    )
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


@router.get("/projects/{project_id}/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    project_id: UUID,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[ConversationResponse]:
    await get_owned_project(db, project_id, current_user.id)
    conversations = (
        await db.scalars(
            select(Conversation)
            .where(Conversation.project_id == project_id, Conversation.owner_id == current_user.id)
            .order_by(Conversation.updated_at.desc())
        )
    ).all()
    return [serialize_conversation(conversation) for conversation in conversations]


@router.post(
    "/projects/{project_id}/conversations",
    response_model=ConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    project_id: UUID,
    payload: ConversationCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ConversationResponse:
    await get_owned_project(db, project_id, context.user.id)
    conversation = Conversation(project_id=project_id, owner_id=context.user.id, title=payload.title)
    db.add(conversation)
    await db.flush()
    await add_audit_log(db, "conversation_created", request, context.user.id)
    await db.commit()
    return serialize_conversation(conversation)


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation(
    conversation_id: UUID,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ConversationDetailResponse:
    conversation = await get_owned_conversation(db, conversation_id, current_user.id)
    messages = (
        await db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.created_at)
        )
    ).all()
    return ConversationDetailResponse(
        **serialize_conversation(conversation).model_dump(),
        messages=[ConversationMessageResponse.model_validate(message) for message in messages],
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ConversationMessageWithSourcesResponse,
)
async def send_message(
    conversation_id: UUID,
    payload: ConversationMessageRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ConversationMessageWithSourcesResponse:
    await rate_limit(request.app.state.redis, f"ai:message:{context.user.id}", 30, 300)
    conversation = await get_owned_conversation(db, conversation_id, context.user.id)
    history = (
        await db.scalars(
            select(ConversationMessage)
            .where(ConversationMessage.conversation_id == conversation.id)
            .order_by(ConversationMessage.created_at.desc())
            .limit(settings.ai_runtime_max_history_messages)
        )
    ).all()
    runtime_messages = [
        RuntimeMessage(role=message.role, content=message.content) for message in reversed(history)
    ]
    runtime_messages.append(RuntimeMessage(role="user", content=payload.content))

    # Persist the question before calling the provider so a provider failure cannot discard it.
    user_message = ConversationMessage(
        conversation_id=conversation.id,
        role="user",
        content=payload.content,
    )
    db.add(user_message)
    if conversation.title == "New conversation":
        conversation.title = payload.content[:160]
    conversation.updated_at = utc_now()
    await db.commit()

    chunks: list[RetrievedChunk] = []
    try:
        chunks = await retrieve_context(db, runtime, settings, conversation.project_id, payload.content)
    except AIProviderError:
        # Retrieval is an enhancement; a failure there must not block the answer.
        logger.warning("Retrieval unavailable for project %s", conversation.project_id)

    try:
        output = await runtime.generate(
            conversation.project.ai_model,
            conversation.project,
            runtime_messages,
            format_context(chunks) if chunks else None,
        )
    except AIProviderError as error:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    assistant_message = ConversationMessage(
        conversation_id=conversation.id,
        role="assistant",
        content=output,
        provider=conversation.project.ai_model.provider,
        model_key=conversation.project.ai_model.key,
    )
    db.add(assistant_message)
    conversation.updated_at = utc_now()
    await add_audit_log(db, "ai_message_completed", request, context.user.id)
    await db.commit()
    await db.refresh(assistant_message)
    return ConversationMessageWithSourcesResponse(
        **ConversationMessageResponse.model_validate(assistant_message).model_dump(),
        sources=[
            RetrievedChunkResponse(
                title=chunk.title,
                ordinal=chunk.ordinal,
                score=round(chunk.score, 4),
                content=chunk.content[:600],
            )
            for chunk in chunks
        ],
    )


@router.delete("/conversations/{conversation_id}", response_model=MessageResponse)
async def delete_conversation(
    conversation_id: UUID,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    conversation = await get_owned_conversation(db, conversation_id, context.user.id)
    await db.delete(conversation)
    await add_audit_log(db, "conversation_deleted", request, context.user.id)
    await db.commit()
    return MessageResponse(message="Conversation deleted")
