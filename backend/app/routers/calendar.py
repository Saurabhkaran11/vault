"""Calendar sync — Phase 1 foundation (bug-list #4; see docs/calendar-sync.md).

What is live and tested: connection status, listing and disconnecting
accounts, and reading mirrored events — all scoped to the caller. What waits
on a real Google OAuth client (and so is inert until configured): the consent
redirect, the callback token exchange, and the periodic pull. Those are
guarded by `google_configured()` and return 503 with a clear message until
the client id/secret/redirect and a token-encryption key are set.

Refresh tokens are encrypted at rest with Fernet — the plaintext never
touches the database. Without `calendar_token_key` the callback refuses to
store a token rather than persist it in the clear.
"""

import json
import uuid
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_session
from ..deps import current_user_id
from ..models import CalendarAccount, CalendarEvent


def new_id() -> str:
    return uuid.uuid4().hex

router = APIRouter(prefix="/calendar", tags=["calendar"])

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo"
# Phase 1 is read-only: the narrowest scope that still shows external events,
# which is also the fastest to get through Google verification.
GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.readonly"]


def google_configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret
                and settings.google_redirect_uri)


def _fernet():
    """Fernet built from calendar_token_key. Raised as 503, not 500: a missing
    key is a deployment gap the operator fixes, not a bug."""
    if not settings.calendar_token_key:
        raise HTTPException(503, "Calendar token encryption key is not configured.")
    from cryptography.fernet import Fernet
    return Fernet(settings.calendar_token_key.encode())


def _encrypt(token: str | None) -> str | None:
    return _fernet().encrypt(token.encode()).decode() if token else None


def _decrypt(token: str | None) -> str | None:
    return _fernet().decrypt(token.encode()).decode() if token else None


def google_auth_url(client_id: str, redirect_uri: str, state: str) -> str:
    """The consent URL to send the user to. Pure function so it can be tested
    without a live client. access_type=offline + prompt=consent are what make
    Google return a refresh token (it omits one on re-consent otherwise)."""
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GOOGLE_SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"


def _require_google():
    if not google_configured():
        raise HTTPException(503, "Google Calendar sync is not configured on this server.")


@router.get("/status")
async def status(session: AsyncSession = Depends(get_session), user: str = Depends(current_user_id)):
    n = len((await session.execute(
        select(CalendarAccount.id).where(CalendarAccount.user_id == user))).scalars().all())
    return {
        "google_configured": google_configured(),
        "token_encryption_configured": bool(settings.calendar_token_key),
        "connected_accounts": n,
    }


@router.get("/google/authorize")
async def google_authorize(request: Request, user: str = Depends(current_user_id)):
    """Start the Google consent flow. The callback arrives as a browser
    redirect with no bearer token, so the caller's identity AND the origin to
    return them to ride along in `state` — encrypted, so neither can be forged
    or read in transit. Carrying the origin means the callback lands back on
    whatever front end started it (production or a preview URL), not a guess."""
    _require_google()
    origin = request.headers.get("origin") or ""
    if not origin:
        ref = request.headers.get("referer") or ""
        p = urlparse(ref)
        origin = f"{p.scheme}://{p.netloc}" if p.scheme and p.netloc else ""
    state = _fernet().encrypt(json.dumps({"u": user, "o": origin}).encode()).decode()
    return {"url": google_auth_url(settings.google_client_id, settings.google_redirect_uri, state)}


@router.get("/google/callback")
async def google_callback(code: str | None = None, state: str | None = None,
                          error: str | None = None,
                          session: AsyncSession = Depends(get_session)):
    """Exchange the authorization code for tokens and store the connection.

    Authenticated by the encrypted `state` rather than a bearer token, because
    Google redirects the browser here directly. Not covered by the test suite:
    it requires a live Google client and a real consent round-trip.
    """
    _require_google()
    if error:
        raise HTTPException(400, f"Google returned an error: {error}")
    if not code or not state:
        raise HTTPException(400, "Missing code or state.")
    try:
        data = json.loads(_fernet().decrypt(state.encode()).decode())
        user, dest = data["u"], (data.get("o") or "")
    except Exception:
        raise HTTPException(400, "Invalid state.")

    async with httpx.AsyncClient(timeout=15) as http:
        tok = await http.post(GOOGLE_TOKEN_ENDPOINT, data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": settings.google_redirect_uri,
            "grant_type": "authorization_code",
        })
        if tok.status_code != 200:
            raise HTTPException(502, "Google token exchange failed.")
        payload = tok.json()
        access = payload.get("access_token")
        info = await http.get(GOOGLE_USERINFO, headers={"Authorization": f"Bearer {access}"})
        email = info.json().get("email") if info.status_code == 200 else None

    existing = (await session.execute(select(CalendarAccount).where(
        CalendarAccount.user_id == user,
        CalendarAccount.provider == "google",
        CalendarAccount.external_email == email))).scalar_one_or_none()
    acct = existing or CalendarAccount(id=new_id(), user_id=user, provider="google")
    acct.external_email = email
    acct.access_token = _encrypt(access)
    # Google omits the refresh token on re-consent; keep the one we have.
    if payload.get("refresh_token"):
        acct.refresh_token = _encrypt(payload["refresh_token"])
    if not existing:
        session.add(acct)
    await session.commit()

    # Back to the front end that started the flow (carried in state); fall back
    # to the first non-wildcard configured origin if it wasn't captured.
    if not dest:
        dest = next((o.strip() for o in settings.cors_origins.split(",")
                     if o.strip() and "*" not in o and o.strip().startswith("http")), "")
    return RedirectResponse(f"{dest.rstrip('/')}/?calendar=connected")


@router.get("/accounts")
async def list_accounts(session: AsyncSession = Depends(get_session),
                        user: str = Depends(current_user_id)):
    """Connected accounts, tokens deliberately omitted."""
    rows = (await session.execute(select(CalendarAccount).where(
        CalendarAccount.user_id == user))).scalars().all()
    return [{
        "id": a.id, "provider": a.provider, "external_email": a.external_email,
        "connected_at": a.created_at.isoformat() if a.created_at else None,
    } for a in rows]


@router.delete("/accounts/{account_id}")
async def disconnect(account_id: str, session: AsyncSession = Depends(get_session),
                     user: str = Depends(current_user_id)):
    """Disconnect and purge — tokens and mirrored events go with it (cascade).
    Idempotent: deleting an already-gone account still returns ok, so a
    replayed request never wedges."""
    acct = (await session.execute(select(CalendarAccount).where(
        CalendarAccount.id == account_id,
        CalendarAccount.user_id == user))).scalar_one_or_none()
    if acct:
        await session.delete(acct)
        await session.commit()
    return {"ok": True}


@router.get("/events")
async def list_events(session: AsyncSession = Depends(get_session),
                      user: str = Depends(current_user_id)):
    """Events mirrored from the user's connected calendars. Empty until a
    pull has run (which needs a configured, connected Google account)."""
    account_ids = (await session.execute(select(CalendarAccount.id).where(
        CalendarAccount.user_id == user))).scalars().all()
    if not account_ids:
        return []
    rows = (await session.execute(select(CalendarEvent).where(
        CalendarEvent.account_id.in_(account_ids)))).scalars().all()
    return [{
        "id": e.id, "title": e.title, "source": e.source,
        "starts_at": e.starts_at.isoformat() if e.starts_at else None,
        "ends_at": e.ends_at.isoformat() if e.ends_at else None,
        "all_day": e.all_day, "vault_ref": e.vault_ref,
    } for e in rows]
