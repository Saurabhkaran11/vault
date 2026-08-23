"""Test fixtures.

Tests run against a REAL Postgres with pgvector, not SQLite: the schema uses
JSONB, a vector column and an HNSW index, so a SQLite stand-in would pass
while production broke. Each test gets its own schema-qualified user id
instead of a fresh database, which keeps the suite fast and still isolates
rows — every query in the app is already scoped by user_id.
"""

import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Point the app at the dev database before anything imports settings, and
# keep auth in dev mode so tests can act as any user by header.
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://vault:vault@localhost:5433/vault")
os.environ.setdefault("REDIS_URL", "redis://localhost:6380")
os.environ.setdefault("AUTH_MODE", "dev")
os.environ.setdefault("RATE_LIMIT_PER_MINUTE", "0")   # never throttle the suite

from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import (  # noqa: E402
    Bill, Board, BoardColumn, Budget, CalendarAccount, Card, CustomTag,
    Embedding, Event, Expense, Goal, Income, Item, PayMethod, Sprint, Task, User,
)
from sqlalchemy import delete, select  # noqa: E402


@pytest_asyncio.fixture(autouse=True)
async def _fresh_pool():
    """asyncpg binds pooled connections to the event loop that created them,
    and pytest-asyncio gives each test its own loop. Without disposing, the
    second test inherits connections belonging to a closed loop and dies with
    an opaque RuntimeError."""
    yield
    await engine.dispose()


@pytest.fixture
def pfx(user_id) -> str:
    """A per-test id prefix.

    Row ids are globally unique across accounts (the pre-launch schema wart
    tracked in docs/backend-architecture.md), so two tests that both invent a
    column called "c1" collide even as different users. Prefixing keeps tests
    independent of that — and of each other.
    """
    return user_id.replace("test-", "")


@pytest.fixture
def user_id() -> str:
    """A unique identity per test — the app's own tenant scoping is what
    isolates the data, so this doubles as a check that scoping works."""
    return f"test-{uuid.uuid4().hex[:12]}"


@pytest_asyncio.fixture
async def client(user_id):
    """An ASGI client that authenticates as `user_id` on every request."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                           headers={"X-User-Id": user_id}) as ac:
        yield ac
    await _purge(user_id)


@pytest_asyncio.fixture
async def other_client():
    """A second identity, for proving one account cannot touch another's rows."""
    uid = f"test-other-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                           headers={"X-User-Id": uid}) as ac:
        ac.vault_user_id = uid
        yield ac
    await _purge(uid)


async def _purge(uid: str) -> None:
    """Remove everything a test created, children first."""
    async with SessionLocal() as s:
        board_ids = (await s.execute(select(Board.id).where(Board.user_id == uid))).scalars().all()
        if board_ids:
            col_ids = (await s.execute(select(BoardColumn.id).where(BoardColumn.board_id.in_(board_ids)))).scalars().all()
            if col_ids:
                await s.execute(delete(Card).where(Card.column_id.in_(col_ids)))
            await s.execute(delete(BoardColumn).where(BoardColumn.board_id.in_(board_ids)))
            await s.execute(delete(Sprint).where(Sprint.board_id.in_(board_ids)))
        for model in (Board, Embedding, Item, Task, Expense, Bill, Income,
                      PayMethod, Budget, Goal, CustomTag, Event, CalendarAccount):
            await s.execute(delete(model).where(model.user_id == uid))
        await s.execute(delete(User).where(User.id == uid))
        await s.commit()
