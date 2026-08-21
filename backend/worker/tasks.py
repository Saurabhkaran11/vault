"""ARQ worker — the event bus consumer.

Jobs:
  · embed_item(item_id)  — (re)index one item for pgvector RAG
  · extract_item(item_id) — read an uploaded document's text, then reindex
  · daily_digest()       — cron 08:00: due/overdue summary per user → Event
                           (phase 4 fans out to email/Slack/push)
  · drain_outbox()       — cron every minute: mark processed, deliver
"""

import asyncio
from datetime import date, datetime, timezone

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

import sys, pathlib
sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from app.config import settings           # noqa: E402
from app.db import SessionLocal           # noqa: E402
from app.models import Bill, Event, Item, Task  # noqa: E402
from app.extract import Unsupported, extract_text  # noqa: E402
from app.routers.ai import index_item     # noqa: E402


async def extract_item(ctx, item_id: int):
    """Read an uploaded document so its CONTENTS become searchable.

    Runs in the worker because parsing is CPU-bound and a large PDF would
    otherwise hold an API request open for seconds. Always records a result —
    text on success, `extract_error` on failure — so the difference between
    "not processed yet" and "processed, nothing readable" stays visible
    instead of both looking like an empty document.
    """
    from app.storage import get_object_bytes, storage_enabled

    async with SessionLocal() as session:
        item = await session.get(Item, item_id)
        if not item or item.deleted_on is not None:
            return "gone"
        key = (item.file_meta or {}).get("s3_key")
        if not key:
            return "no stored file"          # local-only upload; nothing to read
        if not storage_enabled():
            return "storage not configured"

        try:
            data = await asyncio.to_thread(get_object_bytes, key)
            item.extracted_text = extract_text(
                data,
                filename=(item.file_meta or {}).get("name", ""),
                content_type=(item.file_meta or {}).get("type", ""),
            )
            item.extract_error = None
            result = f"extracted {len(item.extracted_text)} chars"
        except Unsupported as exc:
            item.extracted_text = None
            item.extract_error = str(exc)
            result = f"unsupported: {exc}"
        except Exception as exc:
            item.extracted_text = None
            item.extract_error = f"{type(exc).__name__}: {exc}"
            result = f"failed: {result_safe(exc)}"

        item.extracted_at = datetime.now(timezone.utc)
        # Re-index in the same transaction: the new text is only useful once
        # it has been embedded, and leaving that to a separate job would make
        # a document briefly present but unsearchable.
        await index_item(session, item)
        await session.commit()
        return result


def result_safe(exc: Exception) -> str:
    return f"{type(exc).__name__}"


async def embed_item(ctx, item_id: int):
    async with SessionLocal() as session:
        item = await session.get(Item, item_id)
        if item and item.deleted_on is None:
            await index_item(session, item)
            await session.commit()
            return f"indexed item {item_id}"
    return f"skipped {item_id}"


async def daily_digest(ctx):
    t0 = date.today()
    async with SessionLocal() as session:
        tasks = (await session.execute(select(Task).where(Task.done == False))).scalars().all()  # noqa: E712
        bills = (await session.execute(select(Bill).where(Bill.paid == False))).scalars().all()  # noqa: E712
        per_user: dict[str, dict] = {}
        for t in tasks:
            u = per_user.setdefault(t.user_id, {"overdue": 0, "due_today": 0, "bills": 0})
            if t.due and t.due < t0:
                u["overdue"] += 1
            elif t.due == t0:
                u["due_today"] += 1
        for b in bills:
            u = per_user.setdefault(b.user_id, {"overdue": 0, "due_today": 0, "bills": 0})
            if b.due <= t0:
                u["bills"] += 1
        for uid, payload in per_user.items():
            if any(payload.values()):
                session.add(Event(user_id=uid, kind="digest.daily", payload=payload))
        await session.commit()
        return f"digests for {len(per_user)} users"


async def drain_outbox(ctx):
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Event).where(Event.processed_at.is_(None)).limit(200)
        )).scalars().all()
        for ev in rows:
            # phase 4: switch on ev.kind → SES email / Slack webhook / web push
            ev.processed_at = datetime.now(timezone.utc)
        await session.commit()
        return f"processed {len(rows)} events"


class WorkerSettings:
    functions = [embed_item, extract_item, daily_digest, drain_outbox]
    cron_jobs = [
        cron(daily_digest, hour=8, minute=0),
        cron(drain_outbox, minute=set(range(0, 60))),
    ]
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
