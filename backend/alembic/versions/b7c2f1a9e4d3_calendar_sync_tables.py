"""calendar sync tables (calendar_accounts, calendar_events)

Revision ID: b7c2f1a9e4d3
Revises: a3b3a928718b
Create Date: 2026-08-23 00:20:00.000000

Foundation for live calendar sync (bug-list #4; see docs/calendar-sync.md).
Adds the two tables only — no behaviour changes until a Google OAuth client
is configured.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c2f1a9e4d3'
down_revision: Union[str, Sequence[str], None] = 'a3b3a928718b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'calendar_accounts',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('user_id', sa.String(length=64), nullable=False),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('external_email', sa.String(length=255), nullable=True),
        sa.Column('access_token', sa.Text(), nullable=True),
        sa.Column('refresh_token', sa.Text(), nullable=True),
        sa.Column('token_expiry', sa.DateTime(timezone=True), nullable=True),
        sa.Column('caldav_url', sa.Text(), nullable=True),
        sa.Column('sync_token', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_calendar_accounts_user_id'), 'calendar_accounts', ['user_id'])
    op.create_index(op.f('ix_calendar_accounts_provider'), 'calendar_accounts', ['provider'])

    op.create_table(
        'calendar_events',
        sa.Column('id', sa.String(length=64), nullable=False),
        sa.Column('account_id', sa.String(length=64), nullable=False),
        sa.Column('external_id', sa.String(length=255), nullable=True),
        sa.Column('etag', sa.String(length=255), nullable=True),
        sa.Column('source', sa.String(length=10), nullable=False),
        sa.Column('vault_ref', sa.String(length=64), nullable=True),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('all_day', sa.Boolean(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['calendar_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_calendar_events_account_id'), 'calendar_events', ['account_id'])
    op.create_index(op.f('ix_calendar_events_vault_ref'), 'calendar_events', ['vault_ref'])
    op.create_index('ix_calendar_events_account_external', 'calendar_events',
                    ['account_id', 'external_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_calendar_events_account_external', table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_vault_ref'), table_name='calendar_events')
    op.drop_index(op.f('ix_calendar_events_account_id'), table_name='calendar_events')
    op.drop_table('calendar_events')
    op.drop_index(op.f('ix_calendar_accounts_provider'), table_name='calendar_accounts')
    op.drop_index(op.f('ix_calendar_accounts_user_id'), table_name='calendar_accounts')
    op.drop_table('calendar_accounts')
