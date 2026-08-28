"""client lww clock on items and tasks

Revision ID: c41be7f0a9d2
Revises: b7c2f1a9e4d3
Create Date: 2026-08-28 10:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c41be7f0a9d2'
down_revision: Union[str, Sequence[str], None] = 'b7c2f1a9e4d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # `updated_at` on the two mirrored tables stops being the server's write
    # time and becomes the client's last-write-wins clock (ms since epoch).
    # Existing rows reset to 0 = "unstamped": converting the old server times
    # instead could out-rank a client whose wall clock runs behind, silently
    # rejecting real edits. The old now() default must be dropped BEFORE the
    # type change — Postgres refuses to cast it to bigint.
    for table in ("items", "tasks"):
        op.alter_column(table, "updated_at", server_default=None,
                        existing_type=sa.DateTime(timezone=True), existing_nullable=False)
        op.alter_column(table, "updated_at",
                        existing_type=sa.DateTime(timezone=True),
                        type_=sa.BigInteger(),
                        existing_nullable=False,
                        server_default=sa.text("0"),
                        postgresql_using="0")


def downgrade() -> None:
    """Downgrade schema."""
    # The client clocks are not server timestamps, so nothing meaningful can
    # be restored — rows come back stamped now(), matching the mixin default.
    for table in ("tasks", "items"):
        op.alter_column(table, "updated_at", server_default=None,
                        existing_type=sa.BigInteger(), existing_nullable=False)
        op.alter_column(table, "updated_at",
                        existing_type=sa.BigInteger(),
                        type_=sa.DateTime(timezone=True),
                        existing_nullable=False,
                        server_default=sa.text("now()"),
                        postgresql_using="now()")
