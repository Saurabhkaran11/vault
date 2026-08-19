from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models import User


async def current_user_id(
    session: AsyncSession = Depends(get_session),
    x_user_id: str | None = Header(default=None),
) -> str:
    """v0 auth seam: the demo user, or an explicit X-User-Id header.
    The Clerk phase replaces this dependency with JWT verification —
    nothing else in any router changes."""
    uid = x_user_id or settings.demo_user
    existing = await session.get(User, uid)
    if not existing:
        session.add(User(id=uid))
        await session.commit()
    return uid
