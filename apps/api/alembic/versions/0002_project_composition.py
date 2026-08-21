"""Create modular project composition tables.

Revision ID: 0002_project_composition
Revises: 0001_auth_foundation
Create Date: 2026-08-13
"""

from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0002_project_composition"
down_revision = "0001_auth_foundation"
branch_labels = None
depends_on = None


MODELS = [
    {
        "id": UUID("00000000-0000-4000-8000-000000000001"),
        "key": "openai-gpt-4.1-mini",
        "provider": "openai",
        "external_model_id": "gpt-4.1-mini",
        "display_name": "GPT-4.1 mini",
        "supports_tools": True,
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000002"),
        "key": "google-gemini-2.5-flash",
        "provider": "google",
        "external_model_id": "gemini-2.5-flash",
        "display_name": "Gemini 2.5 Flash",
        "supports_tools": True,
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000003"),
        "key": "anthropic-claude-sonnet-4",
        "provider": "anthropic",
        "external_model_id": "claude-sonnet-4-0",
        "display_name": "Claude Sonnet 4",
        "supports_tools": True,
        "is_enabled": True,
    },
]

SKILLS = [
    {
        "id": UUID("00000000-0000-4000-8000-000000000101"),
        "slug": "research",
        "name": "Research",
        "description": "Structure research, compare evidence and state uncertainty.",
        "instruction": "Break research into claims, collect evidence and distinguish facts from inference.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000102"),
        "slug": "source-verification",
        "name": "Source verification",
        "description": "Prioritize primary and current sources with explicit citations.",
        "instruction": "Verify material claims with reputable sources and cite them in the final response.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000103"),
        "slug": "python",
        "name": "Python engineering",
        "description": "Write maintainable, tested Python code.",
        "instruction": "Use typed, readable Python and validate behavior before presenting a solution.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000104"),
        "slug": "react",
        "name": "React engineering",
        "description": "Build accessible, resilient React interfaces.",
        "instruction": "Use small components, explicit state and accessible interactions.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000105"),
        "slug": "database-engineering",
        "name": "Database engineering",
        "description": "Design reliable schemas, queries and migrations.",
        "instruction": "Use explicit constraints, indexes and safe migrations for persistent data.",
        "is_enabled": True,
    },
]

TOOLS = [
    {
        "id": UUID("00000000-0000-4000-8000-000000000201"),
        "slug": "web-search",
        "name": "Web search",
        "description": "Find current information through a configured search provider.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000202"),
        "slug": "file-access",
        "name": "File access",
        "description": "Read and manage files within an explicitly authorized workspace.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000203"),
        "slug": "code-execution",
        "name": "Code execution",
        "description": "Run isolated code jobs with constrained resources.",
        "is_enabled": True,
    },
    {
        "id": UUID("00000000-0000-4000-8000-000000000204"),
        "slug": "github",
        "name": "GitHub",
        "description": "Work with repositories after a user grants access.",
        "is_enabled": True,
    },
]


def upgrade() -> None:
    op.create_table(
        "ai_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=50), nullable=False),
        sa.Column("external_model_id", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=False),
        sa.Column("supports_tools", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_ai_models_key", "ai_models", ["key"])
    op.create_index("ix_ai_models_provider", "ai_models", ["provider"])

    for table_name in ("skills", "tools"):
        op.create_table(
            table_name,
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("description", sa.String(length=500), nullable=False),
            *([sa.Column("instruction", sa.Text(), nullable=False)] if table_name == "skills" else []),
            sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("slug"),
        )
        op.create_index(f"ix_{table_name}_slug", table_name, ["slug"])

    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ai_model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ai_models.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=1000)),
        sa.Column("system_prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("memory_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_projects_owner_id", "projects", ["owner_id"])
    op.create_index("ix_projects_ai_model_id", "projects", ["ai_model_id"])
    op.create_index("ix_projects_owner_updated", "projects", ["owner_id", "updated_at"])

    op.create_table(
        "project_skills",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("skill_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("skills.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "skill_id"),
    )
    op.create_table(
        "project_tools",
        sa.Column("project_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tool_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tools.id", ondelete="RESTRICT"), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "tool_id"),
    )

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
    skills = sa.table(
        "skills",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("instruction", sa.Text),
        sa.column("is_enabled", sa.Boolean),
    )
    tools = sa.table(
        "tools",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("slug", sa.String),
        sa.column("name", sa.String),
        sa.column("description", sa.String),
        sa.column("is_enabled", sa.Boolean),
    )
    op.bulk_insert(ai_models, MODELS)
    op.bulk_insert(skills, SKILLS)
    op.bulk_insert(tools, TOOLS)


def downgrade() -> None:
    op.drop_table("project_tools")
    op.drop_table("project_skills")
    op.drop_index("ix_projects_owner_updated", table_name="projects")
    op.drop_index("ix_projects_ai_model_id", table_name="projects")
    op.drop_index("ix_projects_owner_id", table_name="projects")
    op.drop_table("projects")
    op.drop_index("ix_tools_slug", table_name="tools")
    op.drop_table("tools")
    op.drop_index("ix_skills_slug", table_name="skills")
    op.drop_table("skills")
    op.drop_index("ix_ai_models_provider", table_name="ai_models")
    op.drop_index("ix_ai_models_key", table_name="ai_models")
    op.drop_table("ai_models")
