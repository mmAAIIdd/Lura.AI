from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import AuthContext, require_auth, require_csrf
from app.models import (
    FeedbackSentiment,
    FeedbackSignal,
    MetricSnapshot,
    ProductRelease,
    User,
)
from app.routers.projects import get_owned_project
from app.schemas import (
    FeedbackCreateRequest,
    FeedbackResponse,
    MetricSnapshotCreateRequest,
    MetricSnapshotResponse,
    ProductContextSummaryResponse,
    ReleaseCreateRequest,
    ReleaseResponse,
)
from app.services import add_audit_log, rate_limit

router = APIRouter(prefix="/projects/{project_id}", tags=["product-context"])


async def commit_ingestion(
    db: AsyncSession,
    request: Request,
    context: AuthContext,
    action: str,
) -> None:
    await add_audit_log(db, action, request, context.user.id)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A record with the same source identifier already exists",
        ) from error


@router.get("/context/summary", response_model=ProductContextSummaryResponse)
async def get_context_summary(
    project_id: UUID,
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> ProductContextSummaryResponse:
    await get_owned_project(db, project_id, current_user.id)
    releases = await db.scalar(
        select(func.count()).select_from(ProductRelease).where(ProductRelease.project_id == project_id)
    )
    feedback_signals = await db.scalar(
        select(func.count()).select_from(FeedbackSignal).where(FeedbackSignal.project_id == project_id)
    )
    metric_snapshots = await db.scalar(
        select(func.count()).select_from(MetricSnapshot).where(MetricSnapshot.project_id == project_id)
    )
    negative_feedback = await db.scalar(
        select(func.count()).select_from(FeedbackSignal).where(
            FeedbackSignal.project_id == project_id,
            FeedbackSignal.sentiment == FeedbackSentiment.NEGATIVE,
        )
    )
    unlinked_feedback = await db.scalar(
        select(func.count()).select_from(FeedbackSignal).where(
            FeedbackSignal.project_id == project_id,
            FeedbackSignal.release_id.is_(None),
        )
    )
    return ProductContextSummaryResponse(
        releases=releases or 0,
        feedback_signals=feedback_signals or 0,
        metric_snapshots=metric_snapshots or 0,
        negative_feedback=negative_feedback or 0,
        unlinked_feedback=unlinked_feedback or 0,
    )


@router.get("/releases", response_model=list[ReleaseResponse])
async def list_releases(
    project_id: UUID,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[ProductRelease]:
    await get_owned_project(db, project_id, current_user.id)
    return list(
        (
            await db.scalars(
                select(ProductRelease)
                .where(ProductRelease.project_id == project_id)
                .order_by(ProductRelease.released_at.desc())
                .limit(limit)
            )
        ).all()
    )


@router.post("/releases", response_model=ReleaseResponse, status_code=status.HTTP_201_CREATED)
async def create_release(
    project_id: UUID,
    payload: ReleaseCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> ProductRelease:
    await rate_limit(request.app.state.redis, f"ingest:release:{context.user.id}", 120, 300)
    await get_owned_project(db, project_id, context.user.id)
    release = ProductRelease(project_id=project_id, **payload.model_dump())
    db.add(release)
    await commit_ingestion(db, request, context, "release_created")
    await db.refresh(release)
    return release


@router.get("/feedback", response_model=list[FeedbackResponse])
async def list_feedback(
    project_id: UUID,
    release_id: UUID | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[FeedbackSignal]:
    await get_owned_project(db, project_id, current_user.id)
    query = select(FeedbackSignal).where(FeedbackSignal.project_id == project_id)
    if release_id is not None:
        query = query.where(FeedbackSignal.release_id == release_id)
    return list((await db.scalars(query.order_by(FeedbackSignal.occurred_at.desc()).limit(limit))).all())


@router.post("/feedback", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
async def create_feedback(
    project_id: UUID,
    payload: FeedbackCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> FeedbackSignal:
    await rate_limit(request.app.state.redis, f"ingest:feedback:{context.user.id}", 500, 300)
    await get_owned_project(db, project_id, context.user.id)
    if payload.release_id is not None:
        release_exists = await db.scalar(
            select(ProductRelease.id).where(
                ProductRelease.id == payload.release_id,
                ProductRelease.project_id == project_id,
            )
        )
        if release_exists is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Release does not belong to this project",
            )
    signal = FeedbackSignal(project_id=project_id, **payload.model_dump())
    db.add(signal)
    await commit_ingestion(db, request, context, "feedback_created")
    await db.refresh(signal)
    return signal


@router.get("/metrics", response_model=list[MetricSnapshotResponse])
async def list_metric_snapshots(
    project_id: UUID,
    metric_key: str | None = Query(default=None, min_length=1, max_length=120),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> list[MetricSnapshot]:
    await get_owned_project(db, project_id, current_user.id)
    query = select(MetricSnapshot).where(MetricSnapshot.project_id == project_id)
    if metric_key is not None:
        query = query.where(MetricSnapshot.metric_key == metric_key)
    return list((await db.scalars(query.order_by(MetricSnapshot.measured_at.desc()).limit(limit))).all())


@router.post("/metrics", response_model=MetricSnapshotResponse, status_code=status.HTTP_201_CREATED)
async def create_metric_snapshot(
    project_id: UUID,
    payload: MetricSnapshotCreateRequest,
    request: Request,
    context: AuthContext = Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> MetricSnapshot:
    await rate_limit(request.app.state.redis, f"ingest:metric:{context.user.id}", 500, 300)
    await get_owned_project(db, project_id, context.user.id)
    snapshot = MetricSnapshot(project_id=project_id, **payload.model_dump())
    db.add(snapshot)
    await commit_ingestion(db, request, context, "metric_snapshot_created")
    await db.refresh(snapshot)
    return snapshot
