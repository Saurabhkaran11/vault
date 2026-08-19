"""Event outbox + Redis enqueue. Writes are transactional with business
data (same DB session); the ARQ worker drains and fans out. If Redis is
briefly down, events wait in the table — nothing is lost."""

from sqlalchemy.ext.asyncio import AsyncSession

from .models import Event

try:
    from arq import create_pool
    from arq.connections import RedisSettings
    from .config import settings

    _redis_settings = RedisSettings.from_dsn(settings.redis_url)
except Exception:  # pragma: no cover
    _redis_settings = None

_pool = None


async def emit(session: AsyncSession, user_id: str, kind: str, payload: dict | None = None):
    session.add(Event(user_id=user_id, kind=kind, payload=payload or {}))


async def enqueue(job: str, *args):
    """Fire-and-forget job push; API keeps working if Redis is absent."""
    global _pool
    if _redis_settings is None:
        return False
    try:
        if _pool is None:
            _pool = await create_pool(_redis_settings)
        await _pool.enqueue_job(job, *args)
        return True
    except Exception:
        return False
