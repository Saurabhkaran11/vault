"""Google Drive import — browse/search the user's Drive and pull a file's text
into the vault so it's searchable. Reuses the Google OAuth connection made for
calendar (same account row, same refreshed token). The backend only fetches
the content; the frontend creates the vault item, keeping the app local-first.
"""

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..deps import current_user_id
from ..models import CalendarAccount
from .calendar import _fresh_access_token, _require_google

router = APIRouter(prefix="/google/drive", tags=["google-drive"])

DRIVE_FILES = "https://www.googleapis.com/drive/v3/files"

# Google-native docs are exported to text; the mime we ask for per kind.
EXPORT_MIME = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
    "application/vnd.google-apps.presentation": "text/plain",
}
CLOUD_KIND = {
    "application/vnd.google-apps.document": "gdoc",
    "application/vnd.google-apps.spreadsheet": "gsheet",
    "application/vnd.google-apps.presentation": "gslides",
}
# What we let the user import (native docs + a couple of common binaries).
IMPORTABLE = list(EXPORT_MIME) + ["application/pdf", "text/plain"]


async def _google_account(session: AsyncSession, user: str) -> CalendarAccount:
    acct = (await session.execute(select(CalendarAccount).where(
        CalendarAccount.user_id == user, CalendarAccount.provider == "google"))).scalars().first()
    if not acct:
        raise HTTPException(400, "Connect your Google account first.")
    return acct


async def _token(session: AsyncSession, user: str) -> str:
    acct = await _google_account(session, user)
    token = await _fresh_access_token(session, acct)
    if not token:
        raise HTTPException(401, "Google access expired — reconnect your account.")
    return token


@router.get("/files")
async def list_files(q: str | None = None, session: AsyncSession = Depends(get_session),
                     user: str = Depends(current_user_id)):
    """The user's importable Drive files, newest first, optional name search."""
    _require_google()
    token = await _token(session, user)
    types = " or ".join(f"mimeType='{m}'" for m in IMPORTABLE)
    query = f"trashed=false and ({types})"
    if q:
        query += f" and name contains '{q.replace(chr(39), '')}'"
    async with httpx.AsyncClient(timeout=20) as http:
        r = await http.get(DRIVE_FILES, headers={"Authorization": f"Bearer {token}"}, params={
            "q": query, "pageSize": 25, "orderBy": "modifiedTime desc",
            "fields": "files(id,name,mimeType,modifiedTime,webViewLink)",
        })
    if r.status_code == 403:
        raise HTTPException(403, "Drive access not granted — reconnect Google to allow Drive.")
    if r.status_code != 200:
        raise HTTPException(502, "Couldn't list Drive files.")
    return r.json().get("files", [])


@router.post("/import")
async def import_file(body: dict = Body(...), session: AsyncSession = Depends(get_session),
                      user: str = Depends(current_user_id)):
    """Fetch one Drive file's text (export for native docs, download+extract for
    PDFs/txt). Returns the content for the frontend to save as a vault doc."""
    _require_google()
    file_id = (body or {}).get("file_id")
    if not file_id:
        raise HTTPException(400, "file_id is required.")
    token = await _token(session, user)
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as http:
        meta = await http.get(f"{DRIVE_FILES}/{file_id}", headers=headers,
                              params={"fields": "id,name,mimeType,webViewLink"})
        if meta.status_code != 200:
            raise HTTPException(404, "File not found or not accessible.")
        m = meta.json()
        mime, name, web = m.get("mimeType", ""), m.get("name", "Untitled"), m.get("webViewLink")

        text = ""
        if mime in EXPORT_MIME:
            exp = await http.get(f"{DRIVE_FILES}/{file_id}/export", headers=headers,
                                 params={"mimeType": EXPORT_MIME[mime]})
            if exp.status_code == 200:
                text = exp.text
        else:
            dl = await http.get(f"{DRIVE_FILES}/{file_id}", headers=headers, params={"alt": "media"})
            if dl.status_code == 200:
                from ..extract import Unsupported, extract_text
                try:
                    text = extract_text(dl.content, filename=name, content_type=mime)
                except Unsupported:
                    text = ""

    return {
        "title": name,
        "text": (text or "").strip(),
        "mime": mime,
        "file_id": file_id,
        "web_view_link": web,
        "cloud_kind": CLOUD_KIND.get(mime, "gdrive"),
    }


DOCS_API = "https://docs.googleapis.com/v1/documents"


@router.post("/write-doc")
async def write_doc(body: dict = Body(...), session: AsyncSession = Depends(get_session),
                    user: str = Depends(current_user_id)):
    """Write edited text back to a Google Doc (replace the body). Only works on
    Google Docs (not Sheets/PDFs). Needs the 'documents' scope — reconnect if
    the connection predates it."""
    _require_google()
    file_id, text = (body or {}).get("file_id"), (body or {}).get("text", "")
    if not file_id:
        raise HTTPException(400, "file_id is required.")
    token = await _token(session, user)
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30) as http:
        doc = await http.get(f"{DOCS_API}/{file_id}", headers=headers)
        if doc.status_code == 403:
            raise HTTPException(403, "Reconnect Google to allow editing Docs.")
        if doc.status_code != 200:
            raise HTTPException(404, "That isn't an editable Google Doc.")
        content = doc.json().get("body", {}).get("content", [])
        end = max([el.get("endIndex", 1) for el in content] + [1])
        # Replace all: delete everything but the final newline, then insert.
        requests = []
        if end > 2:
            requests.append({"deleteContentRange": {"range": {"startIndex": 1, "endIndex": end - 1}}})
        if text:
            requests.append({"insertText": {"location": {"index": 1}, "text": text}})
        if not requests:
            return {"ok": True, "updated": False}
        r = await http.post(f"{DOCS_API}/{file_id}:batchUpdate", headers=headers, json={"requests": requests})
        if r.status_code == 403:
            raise HTTPException(403, "Reconnect Google to allow editing Docs.")
        if r.status_code != 200:
            raise HTTPException(502, "Google rejected the update.")
    return {"ok": True, "updated": True}
