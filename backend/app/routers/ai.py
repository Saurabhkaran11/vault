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
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user_id
from ..events import enqueue
from ..extract import chunk_text
from ..models import Board, BoardColumn, Card, Embedding, Item, Task
from ..schemas import AskIn, AskOut, AskSource, CompleteIn, CompleteOut

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
        payload = {"model": settings.embeddings_model,
                   "input": [prefix + t for t in texts]}
        # NVIDIA NIM's embedding models reject a request without an input_type
        # ("query" for the question, "passage" for stored documents) and want an
        # explicit truncate policy. Other OpenAI-compatible providers (OpenAI,
        # nomic) would 400 on these extra fields, so only send them for NVIDIA.
        if "nvidia" in (settings.embeddings_url or "").lower():
            payload["input_type"] = "query" if kind == "query" else "passage"
            payload["truncate"] = "END"
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(f"{settings.embeddings_url.rstrip('/')}/embeddings",
                                  json=payload, headers=headers)
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


async def index_item_inline(session: AsyncSession, item: Item):
    """Extract an uploaded file's text (if it has one and hasn't been read) and
    then embed the item — all in the request. Used when INLINE_INDEXING is on
    so RAG works without a background worker. Mirrors the worker's extract_item
    + embed_item, minus the queue."""
    import asyncio
    from datetime import datetime, timezone

    needs_text = bool((item.file_meta or {}).get("s3_key")) and item.extracted_at is None
    if needs_text:
        from ..extract import Unsupported, extract_text
        from ..storage import get_object_bytes, storage_enabled
        if storage_enabled():
            meta = item.file_meta or {}
            try:
                data = await asyncio.to_thread(get_object_bytes, meta.get("s3_key"))
                item.extracted_text = extract_text(data, filename=meta.get("name", ""), content_type=meta.get("type", ""))
                item.extract_error = None
            except Unsupported as exc:
                item.extracted_text, item.extract_error = None, str(exc)
            except Exception as exc:  # noqa: BLE001 — record and move on; the item still embeds
                item.extracted_text, item.extract_error = None, f"{type(exc).__name__}: {exc}"
            item.extracted_at = datetime.now(timezone.utc)
    await index_item(session, item)


async def index_item(session: AsyncSession, item: Item):
    await session.execute(delete(Embedding).where(Embedding.item_id == item.id))
    chunks = item_chunks(item)
    if chunks:
        vectors = await embed_texts(chunks)
        for chunk, vec in zip(chunks, vectors):
            session.add(Embedding(user_id=item.user_id, item_id=item.id,
                                  source_type="item", source_ref=item.client_id,
                                  title=item.title, chunk=chunk,
                                  model=settings.embeddings_model, vector=vec))


async def index_tasks(session: AsyncSession, user: str) -> int:
    """To-dos, indexed as one chunk each.

    They were invisible to search: "what did I plan about the migration?" could
    not reach a to-do however plainly it said so. Each is short enough that
    chunking would only fragment it.
    """
    await session.execute(delete(Embedding).where(
        Embedding.user_id == user, Embedding.source_type == "task"))
    rows = (await session.execute(select(Task).where(Task.user_id == user))).scalars().all()
    texts, keep = [], []
    for t in rows:
        parts = [t.text, t.label or "", "done" if t.done else "to do"]
        if t.due:
            parts.append(f"due {t.due.isoformat()}")
        text = ". ".join(p for p in parts if p)
        if len(text.strip(" .")) >= _MIN_CHUNK_CHARS:
            texts.append(text); keep.append(t)
    if not texts:
        return 0
    for t, chunk, vec in zip(keep, texts, await embed_texts(texts)):
        session.add(Embedding(user_id=user, item_id=None, source_type="task",
                              source_ref=t.id, title=t.text[:120], chunk=chunk,
                              model=settings.embeddings_model, vector=vec))
    return len(texts)


async def index_cards(session: AsyncSession, user: str) -> int:
    """Kanban cards, with their board and column as context.

    A card's meaning depends on where it sits — "Ship auth" in Done is a
    different fact from the same words in Backlog — so the board and column
    names are part of the indexed text rather than dropped.
    """
    await session.execute(delete(Embedding).where(
        Embedding.user_id == user, Embedding.source_type == "card"))
    rows = (await session.execute(
        select(Card, BoardColumn, Board)
        .join(BoardColumn, BoardColumn.id == Card.column_id)
        .join(Board, Board.id == BoardColumn.board_id)
        .where(Board.user_id == user)
    )).all()
    texts, keep = [], []
    for card, col, board in rows:
        parts = [card.text, card.desc or "", " ".join(card.labels or []),
                 f"board {board.name}", f"column {col.title}"]
        text = ". ".join(p for p in parts if p and p.strip())
        if len(text.strip(" .")) >= _MIN_CHUNK_CHARS:
            texts.append(text); keep.append(card)
    if not texts:
        return 0
    for card, chunk, vec in zip(keep, texts, await embed_texts(texts)):
        session.add(Embedding(user_id=user, item_id=None, source_type="card",
                              source_ref=card.id, title=card.text[:120], chunk=chunk,
                              model=settings.embeddings_model, vector=vec))
    return len(texts)


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
    # INLINE_INDEXING (or no Redis at all): do the work here rather than queue
    # jobs a worker would have to pick up.
    if not settings.inline_indexing:
        for it in items:
            needs_text = bool((it.file_meta or {}).get("s3_key")) and it.extracted_at is None
            if await enqueue("extract_item" if needs_text else "embed_item", it.id):
                queued += 1
    if queued == 0:
        for it in items:
            await index_item_inline(session, it)
        await session.commit()
    # To-dos and cards are small and embed in one batch each, so they are done
    # inline rather than queued — waiting on a worker to make a to-do
    # searchable would be a strange thing to explain.
    tasks_n = await index_tasks(session, user)
    cards_n = await index_cards(session, user)
    await session.commit()
    return {"items": len(ids), "queued": queued, "inline": queued == 0,
            "tasks": tasks_n, "cards": cards_n}


@router.post("/ask", response_model=AskOut)
async def ask(body: AskIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    # The question is a query, not a document — see _task_prefix.
    qvec = (await embed_texts([body.question], kind="query"))[0]
    dist = Embedding.vector.cosine_distance(qvec)
    # LEFT join: to-dos and cards have no item row, and an inner join would
    # silently drop every one of them from results.
    stmt = (
        select(Embedding, Item, dist.label("d"))
        .outerjoin(Item, Item.id == Embedding.item_id)
        .where(
            Embedding.user_id == user,
            or_(Embedding.item_id.is_(None), Item.deleted_on.is_(None)),
        )
    )
    # Scoping is applied INSIDE the ranked query rather than by filtering
    # results afterwards: post-filtering would search the whole vault, take
    # the best k, and then discard most of them — so asking about one document
    # would routinely come back empty.
    if body.item_ids:
        stmt = stmt.where(Item.id.in_(body.item_ids))
    if body.types:
        # `types` spans two different columns: item kinds live on the item row,
        # while to-dos and cards have no item row and are identified by
        # source_type. Filtering only on Item.type silently returned nothing
        # for "task" and "card", because Item.type is NULL for them and
        # NULL IN (...) is never true.
        stmt = stmt.where(or_(
            Item.type.in_(body.types),
            Embedding.source_type.in_(body.types),
        ))
    rows = (await session.execute(stmt.order_by(dist).limit(body.k))).all()
    sources = [AskSource(item_id=item.id if item else 0,
                         client_id=item.client_id if item else emb.source_ref,
                         title=(item.title if item else emb.title) or "(untitled)",
                         type=item.type if item else emb.source_type,
                         score=round(1 - float(d), 4), chunk=emb.chunk[:400])
               for emb, item, d in rows]
    numbered = "\n".join(f"[{i+1}] ({s.type}) {s.title}: {s.chunk}" for i, s in enumerate(sources))
    prompt = (
        "Answer using ONLY these sources from the user's vault; cite like [1].\n\n"
        f"SOURCES:\n{numbered}\n\nQUESTION: {body.question}"
    )
    return AskOut(sources=sources, prompt=prompt)


@router.get("/status")
async def ai_status():
    """Whether the server can generate answers itself.

    The frontend asks before offering server-side completion, so it can fall
    back to the browser's own key rather than failing at the moment someone
    presses Ask."""
    return {
        "server_completion": bool(settings.chat_url and settings.chat_model),
        "model": settings.chat_model if settings.chat_url else None,
    }


@router.post("/complete", response_model=CompleteOut)
async def complete(body: CompleteIn, user: str = Depends(current_user_id)):
    """Generate an answer using the server's provider and the server's key.

    This exists because the browser cannot reach every provider. NVIDIA NIM,
    for one, returns no `access-control-allow-origin`, so a browser request is
    blocked before it is ever sent — no key makes that work. Server to server
    has no such restriction, which means ANY OpenAI-compatible provider
    becomes usable, including the hundred-odd open models NIM hosts.

    The second reason is arguably better: the key stays here. Browser-held
    keys sit in localStorage on every device a user signs in from.
    """
    if not (settings.chat_url and settings.chat_model):
        raise HTTPException(503, "Server-side AI is not configured — set CHAT_URL and CHAT_MODEL.")

    headers = {"Content-Type": "application/json"}
    if settings.chat_api_key:
        headers["Authorization"] = f"Bearer {settings.chat_api_key}"

    payload = {
        "model": settings.chat_model,
        "max_tokens": min(body.max_tokens or settings.chat_max_tokens, settings.chat_max_tokens),
        "messages": [m.model_dump() for m in body.messages],
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{settings.chat_url.rstrip('/')}/chat/completions",
                                  json=payload, headers=headers)
    except httpx.RequestError as exc:
        raise HTTPException(502, f"Could not reach the model provider: {type(exc).__name__}") from exc

    if r.status_code >= 400:
        # Surface the provider's status so a bad key reads as a bad key, but
        # not its body — that can echo the prompt, and the prompt is the
        # user's vault.
        raise HTTPException(502, f"Model provider returned {r.status_code}.")

    data = r.json()
    try:
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise HTTPException(502, "Model provider returned an unexpected response shape.") from exc

    # Reasoning models wrap their scratchpad in <think>…</think>; it is not
    # part of the answer and reads as the model talking to itself.
    import re
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    return CompleteOut(text=text, model=settings.chat_model)
