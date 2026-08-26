"""File upload/download brokering.

The API never touches file bytes — it signs URLs and the browser talks to
S3 directly. Every route checks that the key belongs to the caller before
signing anything, because a presigned URL is a bearer credential: once
issued it works for anyone holding it until it expires.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..models import Item
from ..storage import (
    StorageNotConfigured, delete_object, owns_key, presign_download,
    presign_upload, storage_enabled,
)

router = APIRouter(prefix="/files", tags=["files"])


class UploadRequest(BaseModel):
    client_id: str            # the item this file belongs to
    filename: str
    content_type: str = "application/octet-stream"
    size: int = 0             # declared bytes, for the account storage quota


def _fmt_mb(n: int) -> str:
    return f"{n / (1024 * 1024):.0f} MB"


async def used_storage_bytes(session: AsyncSession, user: str) -> int:
    """Total bytes this account holds in the bucket, from the file metadata
    stored on items — the same ledger the download path trusts."""
    rows = (await session.execute(
        select(Item.file_meta).where(Item.user_id == user, Item.file_meta.is_not(None))
    )).scalars().all()
    return sum(int((m or {}).get("size") or 0) for m in rows)


@router.get("/status")
async def status():
    """The frontend asks this before offering an upload, so it can degrade to
    browser-local storage with an honest message instead of failing later."""
    return {"enabled": storage_enabled()}


@router.post("/upload-url")
async def upload_url(body: UploadRequest, session: AsyncSession = Depends(get_session),
                     user: str = Depends(current_user_id)):
    """Quota first, then sign. The check runs before StorageNotConfigured so
    it is enforced (and testable) regardless of bucket configuration."""
    from ..config import settings
    cap = settings.max_user_storage_mb * 1024 * 1024
    if cap > 0:
        used = await used_storage_bytes(session, user)
        if used + max(body.size, 0) > cap:
            raise HTTPException(
                413,
                f"Storage limit reached — {_fmt_mb(used)} of {_fmt_mb(cap)} used. "
                "Delete some files (or their items) to free space.",
            )
    try:
        signed = presign_upload(user, body.client_id, body.filename, body.content_type)
    except StorageNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc
    return {"url": signed.url, "fields": signed.fields, "key": signed.key, "max_bytes": signed.max_bytes}


@router.get("/download-url")
async def download_url(key: str, session: AsyncSession = Depends(get_session),
                       user: str = Depends(current_user_id)):
    if not owns_key(user, key):
        # 404 rather than 403: a wrong answer here should not confirm that
        # someone else's key exists.
        raise HTTPException(404, "File not found")
    row = (await session.execute(
        select(Item).where(Item.user_id == user, Item.file_meta.is_not(None))
    )).scalars().all()
    meta = next((i.file_meta for i in row if (i.file_meta or {}).get("s3_key") == key), None)
    if meta is None:
        raise HTTPException(404, "File not found")
    try:
        return {"url": presign_download(key, meta.get("name"), meta.get("type"))}
    except StorageNotConfigured as exc:
        raise HTTPException(503, str(exc)) from exc


@router.delete("")
async def delete_file(key: str, user: str = Depends(current_user_id)):
    """Idempotent, like every other DELETE here, so a replayed mirror cannot
    wedge the retry queue."""
    if not owns_key(user, key):
        return {"ok": True, "deleted": False}
    if storage_enabled():
        delete_object(key)
    return {"ok": True, "deleted": True}
