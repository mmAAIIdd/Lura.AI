"""Add releases, feedback signals and metric snapshots.

Revision ID: 0004_product_context
Revises: 0003_conversations
Create Date: 2026-08-14
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0004_product_context"
down_revision = "0003_conversations"
branch_labels = None
depends_on = None

def upgrade() -> None:
    release_status = postgresql.ENUM(
        "planned", "rolling_out", "released", "rolled_back", name="release_status", create_type=False
    )
    feedback_source = postgresql.ENUM(
        "review", "support", "interview", "survey", "other", name="feedback_source", create_type=False
    )
    feedback_sentiment = postgresql.ENUM(
        "negative", "neutral", "positive", name="feedback_sentiment", create_type=False
    )
    op.execute(
        "DO $$ BEGIN CREATE TYPE release_status AS ENUM "
        "('planned', 'rolling_out', 'released', 'rolled_back'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN CREATE TYPE feedback_source AS ENUM "
        "('review', 'support', 'interview', 'survey', 'other'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )
    op.execute(
        "DO $$ BEGIN CREATE TYPE feedback_sentiment AS ENUM "
        "('negative', 'neutral', 'positive'); "
        "EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
    )

    op.create_table(
        "product_releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", release_status, nullable=False, server_default="released"),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "version", name="uq_product_releases_project_version"),
    )
    op.create_index("ix_product_releases_project_id", "product_releases", ["project_id"])
    op.create_index("ix_product_releases_released_at", "product_releases", ["released_at"])
    op.create_index("ix_product_releases_project_released", "product_releases", ["project_id", "released_at"])

    op.create_table(
        "feedback_signals",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("release_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("product_releases.id", ondelete="SET NULL")),
        sa.Column("source", feedback_source, nullable=False),
        sa.Column("external_ref", sa.String(length=255)),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sentiment", feedback_sentiment, nullable=False, server_default="neutral"),
        sa.Column("topic", sa.String(length=160)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "source", "external_ref", name="uq_feedback_signals_source_ref"),
    )
    op.create_index("ix_feedback_signals_project_id", "feedback_signals", ["project_id"])
    op.create_index("ix_feedback_signals_release_id", "feedback_signals", ["release_id"])
    op.create_index("ix_feedback_signals_topic", "feedback_signals", ["topic"])
    op.create_index("ix_feedback_signals_occurred_at", "feedback_signals", ["occurred_at"])
    op.create_index("ix_feedback_signals_project_occurred", "feedback_signals", ["project_id", "occurred_at"])

    op.create_table(
        "metric_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric_key", sa.String(length=120), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("unit", sa.String(length=40)),
        sa.Column("segment", sa.String(length=120), nullable=False, server_default="all"),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "metric_key", "segment", "measured_at", name="uq_metric_snapshot_point"),
    )
    op.create_index("ix_metric_snapshots_project_id", "metric_snapshots", ["project_id"])
    op.create_index("ix_metric_snapshots_measured_at", "metric_snapshots", ["measured_at"])
    op.create_index("ix_metric_snapshots_project_metric_time", "metric_snapshots", ["project_id", "metric_key", "measured_at"])


def downgrade() -> None:
    op.drop_table("metric_snapshots")
    op.drop_table("feedback_signals")
    op.drop_table("product_releases")
    op.execute("DROP TYPE IF EXISTS feedback_sentiment")
    op.execute("DROP TYPE IF EXISTS feedback_source")
    op.execute("DROP TYPE IF EXISTS release_status")
