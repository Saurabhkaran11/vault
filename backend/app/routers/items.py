from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user_id
from ..pagination import Page, page_params, paginate
from ..events import emit, enqueue
from ..models import Item
from ..schemas import ItemIn, ItemOut


async def _queue_indexing(session: AsyncSession, item: Item) -> None:
    """Make the item searchable, reading its file first when there is one.

    Normally this hands the work to the ARQ worker. With INLINE_INDEXING on
    (no worker), it extracts + embeds right here instead — never letting an
    indexing hiccup fail the user's write. A stored document needs extraction
    BEFORE embedding, or its contents stay invisible; re-extraction is skipped
    once attempted, since the file is immutable under its key.
    """
    if settings.inline_indexing:
        from .ai import index_item_inline
        try:
            await index_item_inline(session, item)
            await session.commit()
        except Exception:  # noqa: BLE001 — indexing must never break the write
            await session.rollback()
        return
    needs_text = bool((item.file_meta or {}).get("s3_key")) and item.extracted_at is None
    await enqueue("extract_item" if needs_text else "embed_item", item.id)

router = APIRouter(prefix="/items", tags=["items"])


class ItemUpsert(ItemIn):
    """Mirror payload from useStore.js: ItemIn plus a REQUIRED client_id
    (the frontend's Date.now id, stringified) and the trash stamp, so a
    single idempotent endpoint carries create/edit/trash/restore state."""

    client_id: str
    deleted_on: date | None = None


@router.get("", response_model=list[ItemOut])
async def list_items(
    response: Response,
    type: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    page: Page = Depends(page_params),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(current_user_id),
):
    """Filters that SQL can express are pushed into the statement so paging
    is applied to the real result set. `tag` and `q` are still refined in
    Python (tags live in JSON, and `q` spans several columns), so those are
    narrowed before paging rather than after — otherwise page 2 of a search
    would skip rows that were filtered out of page 1."""
    stmt = select(Item).where(Item.user_id == user).order_by(Item.added_on.desc(), Item.id.desc())
    if type:
        stmt = stmt.where(Item.type == type)
    if not include_deleted:
        stmt = stmt.where(Item.deleted_on.is_(None))

    if tag or q:
        rows = (await session.execute(stmt)).scalars().all()
        if tag:
            rows = [r for r in rows if tag in (r.tags or [])]
        if q:
            needle = q.lower()
            rows = [r for r in rows if needle in f"{r.title} {r.meta} {' '.join(r.tags or [])}".lower()]
        response.headers["X-Total-Count"] = str(len(rows))
        return rows[page.offset:page.offset + page.limit]

    return await paginate(session, stmt, page, response)


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = Item(user_id=user, **body.model_dump())
    session.add(item)
    await emit(session, user, "item.created", {"type": body.type, "title": body.title})
    await session.commit()
    await session.refresh(item)
    await _queue_indexing(session, item)
    return item


@router.post("/upsert", response_model=ItemOut)
async def upsert_item(body: ItemUpsert, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """Idempotent write-through target for frontend mirrors: one row per
    (user_id, client_id) no matter how often the retry queue replays it."""
    data = body.model_dump()
    item = (
        (await session.execute(
            select(Item).where(Item.user_id == user, Item.client_id == body.client_id).order_by(Item.id)
        )).scalars().first()
    )
    if item:
        # LWW guard: an incoming clock strictly behind the stored one is a
        # replay that lost the race — keep the row, answer it with stale:true.
        # A 0 stamp is a client from before versioning; those must keep
        # applying unconditionally until every frontend ships stamps.
        if body.updated_at and body.updated_at < item.updated_at:
            out = ItemOut.model_validate(item)
            out.stale = True
            return out
        for k, v in data.items():
            setattr(item, k, v)
    else:
        item = Item(user_id=user, **data)
        session.add(item)
        await emit(session, user, "item.created", {"type": body.type, "title": body.title})
    await session.commit()
    await session.refresh(item)
    await _queue_indexing(session, item)
    return item


async def _owned_by_client(client_id: str, session: AsyncSession, user: str) -> Item:
    item = (
        (await session.execute(
            select(Item).where(Item.user_id == user, Item.client_id == client_id).order_by(Item.id)
        )).scalars().first()
    )
    if not item:
        raise HTTPException(404, "Item not found")
    return item


@router.post("/by-client/{client_id}/trash")
async def trash_by_client(client_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """30-day trash, addressed by the frontend's id."""
    item = await _owned_by_client(client_id, session, user)
    item.deleted_on = date.today()
    await session.commit()
    return {"ok": True, "purge_after": str(date.today() + timedelta(days=30))}


@router.post("/by-client/{client_id}/restore", response_model=ItemOut)
async def restore_by_client(client_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = await _owned_by_client(client_id, session, user)
    item.deleted_on = None
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/by-client/{client_id}")
async def hard_delete_by_client(client_id: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = await _owned_by_client(client_id, session, user)
    await session.delete(item)
    await session.commit()
    return {"ok": True}


async def _owned(item_id: int, session: AsyncSession, user: str) -> Item:
    item = await session.get(Item, item_id)
    if not item or item.user_id != user:
        raise HTTPException(404, "Item not found")
    return item


@router.put("/{item_id}", response_model=ItemOut)
async def update_item(item_id: int, body: ItemIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = await _owned(item_id, session, user)
    for k, v in body.model_dump().items():
        setattr(item, k, v)
    await session.commit()
    await session.refresh(item)
    await _queue_indexing(session, item)
    return item


@router.delete("/{item_id}")
async def soft_delete(item_id: int, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """30-day trash, same contract as the frontend."""
    item = await _owned(item_id, session, user)
    item.deleted_on = date.today()
    await session.commit()
    return {"ok": True, "purge_after": str(date.today() + timedelta(days=30))}


@router.post("/{item_id}/restore", response_model=ItemOut)
async def restore(item_id: int, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = await _owned(item_id, session, user)
    item.deleted_on = None
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/{item_id}/forever")
async def hard_delete(item_id: int, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = await _owned(item_id, session, user)
    await session.delete(item)
    await session.commit()
    return {"ok": True}
