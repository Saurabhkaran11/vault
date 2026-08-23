"""INLINE_INDEXING: the API embeds items in-request, so RAG works with no worker.

With the flag on, saving an item must leave embeddings behind immediately —
that's what lets a single-user deployment skip the paid background worker.
"""

import pytest
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Embedding

pytestmark = pytest.mark.asyncio


async def test_upsert_indexes_inline_when_enabled(client, pfx, monkeypatch):
    monkeypatch.setattr(settings, "inline_indexing", True)
    r = await client.post("/items/upsert", json={
        "client_id": f"{pfx}-inline", "type": "note", "title": "Inline indexing note",
        "meta": "notes about vector search", "status": "Inbox", "tags": ["rag"],
        "added_on": "2026-08-23", "deleted_on": None,
    })
    assert r.status_code in (200, 201)
    item_id = r.json()["id"]

    async with SessionLocal() as s:
        rows = (await s.execute(select(Embedding).where(Embedding.item_id == item_id))).scalars().all()
    assert rows, "inline indexing should embed the item in the request, without a worker"


async def test_upsert_does_not_index_inline_when_disabled(client, pfx):
    # Default (flag off): the API queues the work for a worker instead of
    # embedding in-request, so no embeddings appear synchronously.
    assert settings.inline_indexing is False
    r = await client.post("/items/upsert", json={
        "client_id": f"{pfx}-queued", "type": "note", "title": "Queued note",
        "meta": "m", "status": "Inbox", "tags": [], "added_on": "2026-08-23", "deleted_on": None,
    })
    item_id = r.json()["id"]
    async with SessionLocal() as s:
        rows = (await s.execute(select(Embedding).where(Embedding.item_id == item_id))).scalars().all()
    assert rows == []
