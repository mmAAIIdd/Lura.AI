from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.dependencies import AuthContext, require_auth, require_csrf
from app.models import AIModel, Project, ProjectSkill, ProjectTool, Skill, Tool, User
from app.schemas import (
    AIModelResponse,
    CatalogItemResponse,
    MessageResponse,
    ProjectCreateRequest,
    ProjectResponse,
    ProjectUpdateRequest,
)
from app.services import add_audit_log

router = APIRouter(prefix="/projects", tags=["projects"])

PROJECT_LOAD_OPTIONS = (
    selectinload(Project.ai_model),
    selectinload(Project.skills).selectinload(ProjectSkill.skill),
    selectinload(Project.tools).selectinload(ProjectTool.tool),
)


def serialize_project(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        system_prompt=project.system_prompt,
        memory_enabled=project.memory_enabled,
        ai_model=AIModelResponse.model_validate(project.ai_model),
        skills=[CatalogItemResponse.model_validate(link.skill) for link in project.skills],
        tools=[CatalogItemResponse.model_validate(link.tool) for link in project.tools],
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


async def get_enabled_model(db: AsyncSession, model_id: UUID) -> AIModel:
    model = await db.scalar(select(AIModel).where(AIModel.id == model_id, AIModel.is_enabled.is_(True)))
    if not model:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected model is unavailable")
    return model


async def get_enabled_components[T: Skill | Tool](
    db: AsyncSession, component_type: type[T], component_ids: list[UUID], label: str
) -> list[T]:
    if not component_ids:
        return []
    components = (
        await db.scalars(
            select(component_type).where(component_type.id.in_(component_ids), component_type.is_enabled.is_(True))
        )
    ).all()
    if len(components) != len(component_ids):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"One or more {label} are unavailable")
    return components


async def get_owned_project(db: AsyncSession, project_id: UUID, user_id: UUID) -> Project:
    project = await db.scalar(
        select(Project).options(*PROJECT_LOAD_OPTIONS).where(Project.id == project_id, Project.owner_id == user_id)
    )
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


DEFAULT_WORKSPACE_NAME = "Рабочее пространство"
DEFAULT_MODEL_KEY = "google-gemini-3.7-flash"
DEFAULT_SYSTEM_PROMPT = (
    "Ты аналитик продукта в Lura. Ты разбираешь последствия продуктовых изменений.\n\n"
    "Всегда разделяй четыре уровня и подписывай их явно: факты, корреляции, гипотезы, рекомендации. "
    "Факт — то, что прямо есть в данных. Корреляция — совпадение во времени, а не доказанная причина. "
    "Гипотеза — возможное объяснение с уровнем уверенности и контраргументами. "
    "Рекомендация — одно проверяемое действие и способ измерить результат.\n\n"
    "Никогда не выдумывай числа. Если данных не хватает, скажи, каких именно. "
    "Когда используешь загруженные документы, ссылайся на их названия."
)


@router.get("/default", response_model=ProjectResponse)
async def get_default_workspace(
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    """Returns the user's workspace, provisioning one on first visit.

    Lura has a single workspace per user, so the client never has to pick a project.
    """
    existing = await db.scalar(
        select(Project)
        .options(*PROJECT_LOAD_OPTIONS)
        .where(Project.owner_id == context.user.id)
        .order_by(Project.created_at)
        .limit(1)
    )
    if existing:
        return serialize_project(existing)

    model = await db.scalar(
        select(AIModel).where(AIModel.key == DEFAULT_MODEL_KEY, AIModel.is_enabled.is_(True))
    )
    if not model:
        model = await db.scalar(select(AIModel).where(AIModel.is_enabled.is_(True)).order_by(AIModel.created_at))
    if not model:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No AI model is available"
        )

    skill_ids = list((await db.scalars(select(Skill.id).where(Skill.is_enabled.is_(True)))).all())
    tool_ids = list((await db.scalars(select(Tool.id).where(Tool.is_enabled.is_(True)))).all())

    project = Project(
        owner_id=context.user.id,
        ai_model_id=model.id,
        name=DEFAULT_WORKSPACE_NAME,
        description="Единое пространство анализа продукта.",
        system_prompt=DEFAULT_SYSTEM_PROMPT,
        memory_enabled=True,
        skills=[ProjectSkill(skill_id=skill_id) for skill_id in skill_ids],
        tools=[ProjectTool(tool_id=tool_id) for tool_id in tool_ids],
    )
    db.add(project)
    await db.flush()
    await add_audit_log(db, "workspace_provisioned", request, context.user.id)
    await db.commit()
    return serialize_project(await get_owned_project(db, project.id, context.user.id))


@router.get("", response_model=list[ProjectResponse])
async def list_projects(
    current_user: User = Depends(require_auth), db: AsyncSession = Depends(get_db)
) -> list[ProjectResponse]:
    projects = (
        await db.scalars(
            select(Project)
            .options(*PROJECT_LOAD_OPTIONS)
            .where(Project.owner_id == current_user.id)
            .order_by(Project.updated_at.desc())
        )
    ).all()
    return [serialize_project(project) for project in projects]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    await get_enabled_model(db, payload.ai_model_id)
    await get_enabled_components(db, Skill, payload.skill_ids, "skills")
    await get_enabled_components(db, Tool, payload.tool_ids, "tools")

    project = Project(
        owner_id=context.user.id,
        ai_model_id=payload.ai_model_id,
        name=payload.name,
        description=payload.description or None,
        system_prompt=payload.system_prompt,
        memory_enabled=payload.memory_enabled,
        skills=[ProjectSkill(skill_id=skill_id) for skill_id in payload.skill_ids],
        tools=[ProjectTool(tool_id=tool_id) for tool_id in payload.tool_ids],
    )
    db.add(project)
    await db.flush()
    await add_audit_log(db, "project_created", request, context.user.id)
    await db.commit()
    return serialize_project(await get_owned_project(db, project.id, context.user.id))


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: UUID, current_user: User = Depends(require_auth), db: AsyncSession = Depends(get_db)
) -> ProjectResponse:
    return serialize_project(await get_owned_project(db, project_id, current_user.id))


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: UUID,
    payload: ProjectUpdateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ProjectResponse:
    project = await get_owned_project(db, project_id, context.user.id)
    changes = payload.model_dump(exclude_unset=True)

    if "ai_model_id" in changes:
        await get_enabled_model(db, changes["ai_model_id"])
    if "skill_ids" in changes:
        skill_ids = changes.pop("skill_ids")
        await get_enabled_components(db, Skill, skill_ids, "skills")
        project.skills = [ProjectSkill(skill_id=skill_id) for skill_id in skill_ids]
    if "tool_ids" in changes:
        tool_ids = changes.pop("tool_ids")
        await get_enabled_components(db, Tool, tool_ids, "tools")
        project.tools = [ProjectTool(tool_id=tool_id) for tool_id in tool_ids]

    for field, value in changes.items():
        if field == "description":
            value = value or None
        setattr(project, field, value)

    await add_audit_log(db, "project_updated", request, context.user.id)
    await db.commit()
    return serialize_project(await get_owned_project(db, project.id, context.user.id))


@router.delete("/{project_id}", response_model=MessageResponse)
async def delete_project(
    project_id: UUID,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MessageResponse:
    project = await get_owned_project(db, project_id, context.user.id)
    await db.delete(project)
    await add_audit_log(db, "project_deleted", request, context.user.id)
    await db.commit()
    return MessageResponse(message="Project deleted")
