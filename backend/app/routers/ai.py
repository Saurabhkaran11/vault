"""pgvector RAG: embed items, retrieve by cosine similarity, assemble the
cited prompt. v0 returns sources + prompt (the frontend still calls its
own model with the user's key); phase 3 completes server-side via the
key vault so keys never touch the browser at all.

Embeddings provider: any OpenAI-compatible /embeddings endpoint
(EMBEDDINGS_URL) — Ollama, Together, OpenAI. Without one configured, a
deterministic hashing embedder keeps dev/test runs self-contained
(clearly not semantic; fine for wiring, swap for real vectors)."""

import hashlib
import math

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user_id
from ..events import enqueue
from ..models import Embedding, Item
from ..schemas import AskIn, AskOut, AskSource

router = APIRouter(prefix="/ai", tags=["ai"])


def _hash_embed(text: str, dim: int) -> list[float]:
    vec = [0.0] * dim
    for token in text.lower().split():
        h = int.from_bytes(hashlib.sha1(token.encode()).digest()[:4], "big")
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def embed_texts(texts: list[str]) -> list[list[float]]:
    if settings.embeddings_url:
        headers = {"Content-Type": "application/json"}
        if settings.embeddings_api_key:
            headers["Authorization"] = f"Bearer {settings.embeddings_api_key}"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{settings.embeddings_url.rstrip('/')}/embeddings",
                                  json={"model": settings.embeddings_model, "input": texts}, headers=headers)
            r.raise_for_status()
            return [d["embedding"][: settings.embedding_dim] for d in r.json()["data"]]
    return [_hash_embed(t, settings.embedding_dim) for t in texts]


def item_chunks(item: Item) -> list[str]:
    parts = [f"{item.title}. {item.meta}. tags: {' '.join(item.tags or [])}"]
    text = " ".join(
        (b.get("text") or "") + " " + (b.get("title") or "")
        for b in (item.blocks or []) if isinstance(b, dict)
    ).strip()
    for i in range(0, len(text), 800):
        parts.append(text[i : i + 800])
    return [p for p in parts if p.strip(" .")]


async def index_item(session: AsyncSession, item: Item):
    await session.execute(delete(Embedding).where(Embedding.item_id == item.id))
    chunks = item_chunks(item)
    if chunks:
        vectors = await embed_texts(chunks)
        for chunk, vec in zip(chunks, vectors):
            session.add(Embedding(user_id=item.user_id, item_id=item.id, chunk=chunk,
                                  model=settings.embeddings_model, vector=vec))


@router.post("/reindex")
async def reindex(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Queue every item for (re)embedding — used after bulk import."""
    ids = (await session.execute(select(Item.id).where(Item.user_id == user, Item.deleted_on.is_(None)))).scalars().all()
    queued = 0
    for iid in ids:
        if await enqueue("embed_item", iid):
            queued += 1
    if queued == 0:  # no Redis (dev): index inline so the feature still works
        items = (await session.execute(select(Item).where(Item.id.in_(ids)))).scalars().all()
        for it in items:
            await index_item(session, it)
        await session.commit()
    return {"items": len(ids), "queued": queued, "inline": queued == 0}


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    qvec = (await embed_texts([body.question]))[0]
    dist = Embedding.vector.cosine_distance(qvec)
    rows = (await session.execute(
        select(Embedding, Item, dist.label("d"))
        .join(Item, Item.id == Embedding.item_id)
        .where(Embedding.user_id == user, Item.deleted_on.is_(None))
        .order_by(dist)
        .limit(body.k)
    )).all()
    sources = [AskSource(item_id=item.id, title=item.title, type=item.type,
                         score=round(1 - float(d), 4), chunk=emb.chunk[:400])
               for emb, item, d in rows]
    numbered = "\n".join(f"[{i+1}] ({s.type}) {s.title}: {s.chunk}" for i, s in enumerate(sources))
    prompt = (
        "Answer using ONLY these sources from the user's vault; cite like [1].\n\n"
        f"SOURCES:\n{numbered}\n\nQUESTION: {body.question}"
    )
    return AskOut(sources=sources, prompt=prompt)
