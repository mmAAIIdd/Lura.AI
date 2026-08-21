"""Remove credentials set before email ownership is proven.

Revision ID: 0006_secure_registration
Revises: 0005_auth_hardening
Create Date: 2026-08-14

The identifier stays within the 32-character alembic_version column.
"""

from alembic import op

revision = "0006_secure_registration"
down_revision = "0005_auth_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
        SET password_hash = NULL,
            password_updated_at = NULL,
            failed_login_attempts = 0,
            locked_until = NULL
        WHERE status = 'pending_verification'
        """
    )


def downgrade() -> None:
    # Удалённые до подтверждения email секреты намеренно не восстанавливаются.
    pass
