"""Add document storage for retrieval and register the default Gemini model.

Revision ID: 0007_workspace_rag
Revises: 0006_secure_registration
Create Date: 2026-08-14
"""

from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0007_workspace_rag"
down_revision = "0006_secure_registration"
branch_labels = None
depends_on = None


GEMINI_MODEL = {
    "id": UUID("00000000-0000-4000-8000-000000000004"),
    "key": "google-gemini-3.7-flash",
    "provider": "google",
    "external_model_id": "gemini-3.7-flash",
    "display_name": "Gemini 3.7 Flash",
    "supports_tools": True,
    "is_enabled": True,
}


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("source_kind", sa.String(length=40), nullable=False, server_default="upload"),
        sa.Column("char_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_documents_project_id", "documents", ["project_id"])
    op.create_index("ix_documents_project_created", "documents", ["project_id", "created_at"])

    op.create_table(
        "document_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("embedding", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id", "ordinal", name="uq_document_chunk_ordinal"),
    )
    op.create_index("ix_document_chunks_document_id", "document_chunks", ["document_id"])
    op.create_index("ix_document_chunks_project_id", "document_chunks", ["project_id"])
    op.create_index("ix_document_chunks_project", "document_chunks", ["project_id"])

    ai_models = sa.table(
        "ai_models",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("key", sa.String),
        sa.column("provider", sa.String),
        sa.column("external_model_id", sa.String),
        sa.column("display_name", sa.String),
        sa.column("supports_tools", sa.Boolean),
        sa.column("is_enabled", sa.Boolean),
    )
    op.bulk_insert(ai_models, [GEMINI_MODEL])


def downgrade() -> None:
    op.execute(sa.text("DELETE FROM ai_models WHERE key = 'google-gemini-3.7-flash'"))
    op.drop_index("ix_document_chunks_project", table_name="document_chunks")
    op.drop_index("ix_document_chunks_project_id", table_name="document_chunks")
    op.drop_index("ix_document_chunks_document_id", table_name="document_chunks")
    op.drop_table("document_chunks")
    op.drop_index("ix_documents_project_created", table_name="documents")
    op.drop_index("ix_documents_project_id", table_name="documents")
    op.drop_table("documents")
