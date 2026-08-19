from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..events import emit, enqueue
from ..models import Item
from ..schemas import ItemIn, ItemOut

router = APIRouter(prefix="/items", tags=["items"])


class ItemUpsert(ItemIn):
    """Mirror payload from useStore.js: ItemIn plus a REQUIRED client_id
    (the frontend's Date.now id, stringified) and the trash stamp, so a
    single idempotent endpoint carries create/edit/trash/restore state."""

    client_id: str
    deleted_on: date | None = None


@router.get("", response_model=list[ItemOut])
async def list_items(
    type: str | None = None,
    tag: str | None = None,
    q: str | None = None,
    include_deleted: bool = False,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(current_user_id),
):
    stmt = select(Item).where(Item.user_id == user).order_by(Item.added_on.desc(), Item.id.desc())
    if type:
        stmt = stmt.where(Item.type == type)
    rows = (await session.execute(stmt)).scalars().all()
    if not include_deleted:
        rows = [r for r in rows if r.deleted_on is None]
    if tag:
        rows = [r for r in rows if tag in (r.tags or [])]
    if q:
        needle = q.lower()
        rows = [r for r in rows if needle in f"{r.title} {r.meta} {' '.join(r.tags or [])}".lower()]
    return rows


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemIn, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    item = Item(user_id=user, **body.model_dump())
    session.add(item)
    await emit(session, user, "item.created", {"type": body.type, "title": body.title})
    await session.commit()
    await session.refresh(item)
    await enqueue("embed_item", item.id)   # keeps Ask-your-Vault fresh
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
        for k, v in data.items():
            setattr(item, k, v)
    else:
        item = Item(user_id=user, **data)
        session.add(item)
        await emit(session, user, "item.created", {"type": body.type, "title": body.title})
    await session.commit()
    await session.refresh(item)
    await enqueue("embed_item", item.id)   # keeps Ask-your-Vault fresh
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
    await enqueue("embed_item", item.id)
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
