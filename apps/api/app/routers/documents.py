from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_runtime import AIProviderError, AIProviderRuntime
from app.config import get_settings
from app.database import get_db
from app.dependencies import AuthContext, require_auth, require_csrf
from app.models import Document, DocumentChunk, User
from app.rag import index_document
from app.routers.projects import get_owned_project
from app.schemas import DocumentCreateRequest, DocumentResponse, MessageResponse
from app.services import add_audit_log, rate_limit

router = APIRouter(tags=["documents"])
settings = get_settings()
runtime = AIProviderRuntime(settings)


@router.get("/projects/{project_id}/documents", response_model=list[DocumentResponse])
async def list_documents(
    project_id: UUID,
    limit: int = Query(default=200, ge=1, le=500),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[Document]:
    await get_owned_project(db, project_id, current_user.id)
    return list(
        (
            await db.scalars(
                select(Document)
                .where(Document.project_id == project_id)
                .order_by(Document.created_at.desc())
                .limit(limit)
            )
        ).all()
    )


@router.post(
    "/projects/{project_id}/documents",
    response_model=DocumentResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_document(
    project_id: UUID,
    payload: DocumentCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> Document:
    await rate_limit(request.app.state.redis, f"ingest:document:{context.user.id}", 60, 300)
    await get_owned_project(db, project_id, context.user.id)

    document = Document(
        project_id=project_id,
        title=payload.title,
        source_kind=payload.source_kind or "upload",
        char_count=len(payload.content),
    )
    db.add(document)
    await db.flush()

    try:
        document.chunk_count = await index_document(db, runtime, settings, document, payload.content)
    except AIProviderError as error:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)) from error

    if document.chunk_count == 0:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The document has no readable text",
        )

    await add_audit_log(db, "document_indexed", request, context.user.id)
    await db.commit()
    await db.refresh(document)
    return document


@router.delete("/documents/{document_id}", response_model=MessageResponse)
async def delete_document(
    document_id: UUID,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    document = await db.scalar(select(Document).where(Document.id == document_id))
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await get_owned_project(db, document.project_id, context.user.id)

    await db.delete(document)
    await add_audit_log(db, "document_deleted", request, context.user.id)
    await db.commit()
    return MessageResponse(message="Document deleted")


@router.get("/projects/{project_id}/documents/stats")
async def document_stats(
    project_id: UUID,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    await get_owned_project(db, project_id, current_user.id)
    documents = await db.scalar(
        select(func.count()).select_from(Document).where(Document.project_id == project_id)
    )
    chunks = await db.scalar(
        select(func.count()).select_from(DocumentChunk).where(DocumentChunk.project_id == project_id)
    )
    return {"documents": documents or 0, "chunks": chunks or 0}
