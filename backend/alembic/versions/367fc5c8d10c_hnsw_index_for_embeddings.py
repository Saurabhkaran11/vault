"""hnsw index for embeddings

Revision ID: 367fc5c8d10c
Revises: ee6d22713933
Create Date: 2026-08-19 14:53:51.514485

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import pgvector.sqlalchemy   # autogenerate emits Vector columns but never their import


# revision identifiers, used by Alembic.
revision: str = '367fc5c8d10c'
down_revision: Union[str, Sequence[str], None] = 'ee6d22713933'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Without an index, every Ask-your-Vault query is a sequential scan over
    # the whole embeddings table — fine at 20 rows, unusable at 50k. HNSW
    # gives approximate nearest-neighbour lookups in log time.
    #
    # vector_cosine_ops must match the query operator: routers/ai.py orders
    # by cosine_distance, and an index built for a different operator class
    # is silently ignored by the planner.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_embeddings_vector_hnsw "
        "ON embeddings USING hnsw (vector vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )
    # RAG always filters to one user before ranking, so this composite keeps
    # that pre-filter cheap as the table grows.
    op.execute("CREATE INDEX IF NOT EXISTS ix_embeddings_user_item ON embeddings (user_id, item_id)")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_embeddings_user_item")
    op.execute("DROP INDEX IF EXISTS ix_embeddings_vector_hnsw")
