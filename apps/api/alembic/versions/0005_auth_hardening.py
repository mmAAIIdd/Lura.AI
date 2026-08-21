"""Add account security state and OAuth linking constraint.

Revision ID: 0005_auth_hardening
Revises: 0004_product_context
Create Date: 2026-08-14
"""

import sqlalchemy as sa

from alembic import op

revision = "0005_auth_hardening"
down_revision = "0004_product_context"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("password_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "failed_login_attempts",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.add_column(
        "users",
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE users SET password_updated_at = created_at WHERE password_hash IS NOT NULL"
    )
    op.create_index("ix_users_locked_until", "users", ["locked_until"])
    op.create_unique_constraint(
        "uq_oauth_accounts_user_provider",
        "oauth_accounts",
        ["user_id", "provider"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_oauth_accounts_user_provider",
        "oauth_accounts",
        type_="unique",
    )
    op.drop_index("ix_users_locked_until", table_name="users")
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_login_attempts")
    op.drop_column("users", "last_login_at")
    op.drop_column("users", "password_updated_at")
