from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import require_auth
from app.models import AIModel, Skill, Tool, User
from app.schemas import AIModelResponse, CatalogItemResponse

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/models", response_model=list[AIModelResponse])
async def list_models(
    _: User = Depends(require_auth), db: AsyncSession = Depends(get_db)
) -> list[AIModel]:
    return (
        await db.scalars(
            select(AIModel).where(AIModel.is_enabled.is_(True)).order_by(AIModel.provider, AIModel.display_name)
        )
    ).all()


@router.get("/skills", response_model=list[CatalogItemResponse])
async def list_skills(
    _: User = Depends(require_auth), db: AsyncSession = Depends(get_db)
) -> list[Skill]:
    return (await db.scalars(select(Skill).where(Skill.is_enabled.is_(True)).order_by(Skill.name))).all()


@router.get("/tools", response_model=list[CatalogItemResponse])
async def list_tools(
    _: User = Depends(require_auth), db: AsyncSession = Depends(get_db)
) -> list[Tool]:
    return (await db.scalars(select(Tool).where(Tool.is_enabled.is_(True)).order_by(Tool.name))).all()
