from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..models import CustomTag, Item

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("")
async def directory(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    """The Tags view: every tag with per-section counts, plus standalone
    custom tags that nothing carries yet."""
    items = (await session.execute(select(Item).where(Item.user_id == user, Item.deleted_on.is_(None)))).scalars().all()
    counts: dict[str, dict] = {}
    for it in items:
        for t in it.tags or []:
            entry = counts.setdefault(t, {"total": 0, "by_type": {}})
            entry["total"] += 1
            entry["by_type"][it.type] = entry["by_type"].get(it.type, 0) + 1
    custom = (await session.execute(select(CustomTag).where(CustomTag.user_id == user))).scalars().all()
    for c in custom:
        counts.setdefault(c.tag, {"total": 0, "by_type": {}, "custom": True})
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]["total"]))


@router.post("", status_code=201)
async def create_tag(tag: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    t = tag.strip().lower().lstrip("#").replace(" ", "-")[:40]
    exists = (await session.execute(select(CustomTag).where(CustomTag.user_id == user, CustomTag.tag == t))).scalar_one_or_none()
    if not exists and t:
        session.add(CustomTag(user_id=user, tag=t))
        await session.commit()
    return {"tag": t}


@router.delete("/{tag}")
async def remove_custom(tag: str, session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    rows = (await session.execute(select(CustomTag).where(CustomTag.user_id == user, CustomTag.tag == tag))).scalars().all()
    for r in rows:
        await session.delete(r)
    await session.commit()
    return {"ok": True}
