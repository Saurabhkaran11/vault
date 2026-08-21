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
from ..extract import chunk_text
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


def _task_prefix(kind: str) -> str:
    """Nomic's models are trained with task prefixes and lose accuracy without
    them — a document and a question about that document are embedded for
    different jobs, and saying which one this is measurably separates hits
    from near-misses. Measured on this vault: "how do I build a web API"
    returned an untitled spreadsheet unprefixed and the FastAPI architecture
    notes with the prefix.

    Only applied to models that ask for it. OpenAI's embeddings, for one,
    would treat the prefix as content and make results slightly worse.
    """
    if "nomic" not in (settings.embeddings_model or "").lower():
        return ""
    return "search_query: " if kind == "query" else "search_document: "


async def embed_texts(texts: list[str], kind: str = "document") -> list[list[float]]:
    if settings.embeddings_url:
        prefix = _task_prefix(kind)
        headers = {"Content-Type": "application/json"}
        if settings.embeddings_api_key:
            headers["Authorization"] = f"Bearer {settings.embeddings_api_key}"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{settings.embeddings_url.rstrip('/')}/embeddings",
                                  json={"model": settings.embeddings_model,
                                        "input": [prefix + t for t in texts]}, headers=headers)
            r.raise_for_status()
            return [d["embedding"][: settings.embedding_dim] for d in r.json()["data"]]
    return [_hash_embed(t, settings.embedding_dim) for t in texts]


# Provenance strings the app writes itself. They carry no information about
# what an item *is*, and because the same phrase repeats across dozens of
# items it actively pulls unrelated results together — an item whose only
# text is "Saved via quick drop" ends up a mediocre match for everything.
_BOILERPLATE_META = {
    "captured via quick add", "saved via quick drop", "saved via browser",
    "—", "-", "",
}

# Below this there is no signal left, only a filename or a stray word. Such
# an embedding lands near the centre of the space and outranks genuinely
# relevant documents on unrelated queries — measured: a near-empty item beat
# a rich FastAPI note on "what should I read next".
_MIN_CHUNK_CHARS = 12


def item_chunks(item: Item) -> list[str]:
    """Build the text that actually gets embedded.

    Retrieval quality is set here far more than by the choice of model: the
    embedder can only work with what it is handed.
    """
    meta = (item.meta or "").strip()
    if meta.lower() in _BOILERPLATE_META:
        meta = ""

    # The type is real signal a user searches with ("that video about…"),
    # and folder/alias are the user's own words for the thing.
    descriptors = [item.type, item.folder, item.alias]
    header = ". ".join(
        p for p in [item.title, meta, " ".join(item.tags or []), " ".join(d for d in descriptors if d)]
        if p and p.strip()
    )

    parts = [header]
    text = " ".join(
        (b.get("text") or "") + " " + (b.get("title") or "")
        for b in (item.blocks or []) if isinstance(b, dict)
    ).strip()
    for i in range(0, len(text), 800):
        parts.append(text[i : i + 800])

    # An uploaded document's own text — the difference between finding that a
    # PDF exists and being able to ask what is inside it. Chunked with overlap
    # so a fact spanning a boundary stays findable from either side.
    if item.extracted_text:
        parts.extend(chunk_text(item.extracted_text))

    # Drop anything with no content left — punctuation, empty tag lists, or a
    # title-less item, which would otherwise be indexed as ". . tags: ".
    return [p for p in parts if len(p.strip(" .:,-")) >= _MIN_CHUNK_CHARS]


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
    """Queue every item for (re)embedding — used after bulk import.

    Documents whose text has never been read are queued for extraction
    instead, which reindexes them once it finishes. That makes this the
    backfill for files uploaded before extraction existed, or while storage
    was switched off.
    """
    items = (await session.execute(
        select(Item).where(Item.user_id == user, Item.deleted_on.is_(None))
    )).scalars().all()
    ids = [i.id for i in items]
    queued = 0
    for it in items:
        needs_text = bool((it.file_meta or {}).get("s3_key")) and it.extracted_at is None
        if await enqueue("extract_item" if needs_text else "embed_item", it.id):
            queued += 1
    if queued == 0:  # no Redis (dev): index inline so the feature still works
        items = (await session.execute(select(Item).where(Item.id.in_(ids)))).scalars().all()
        for it in items:
            await index_item(session, it)
        await session.commit()
    return {"items": len(ids), "queued": queued, "inline": queued == 0}


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    # The question is a query, not a document — see _task_prefix.
    qvec = (await embed_texts([body.question], kind="query"))[0]
    dist = Embedding.vector.cosine_distance(qvec)
    stmt = (
        select(Embedding, Item, dist.label("d"))
        .join(Item, Item.id == Embedding.item_id)
        .where(Embedding.user_id == user, Item.deleted_on.is_(None))
    )
    # Scoping is applied INSIDE the ranked query rather than by filtering
    # results afterwards: post-filtering would search the whole vault, take
    # the best k, and then discard most of them — so asking about one document
    # would routinely come back empty.
    if body.item_ids:
        stmt = stmt.where(Item.id.in_(body.item_ids))
    if body.types:
        stmt = stmt.where(Item.type.in_(body.types))
    rows = (await session.execute(stmt.order_by(dist).limit(body.k))).all()
    sources = [AskSource(item_id=item.id, title=item.title, type=item.type,
                         score=round(1 - float(d), 4), chunk=emb.chunk[:400])
               for emb, item, d in rows]
    numbered = "\n".join(f"[{i+1}] ({s.type}) {s.title}: {s.chunk}" for i, s in enumerate(sources))
    prompt = (
        "Answer using ONLY these sources from the user's vault; cite like [1].\n\n"
        f"SOURCES:\n{numbered}\n\nQUESTION: {body.question}"
    )
    return AskOut(sources=sources, prompt=prompt)
