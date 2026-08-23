"""Calendar sync Phase 1 — the parts that don't need a live Google client.

The consent redirect, token exchange and pull need a real OAuth client and a
consent round-trip, so they aren't exercised here. Everything else — status,
the consent-URL builder, listing/deleting connections, reading events, and
that all of it is scoped to the caller — is.
"""

from urllib.parse import parse_qs, urlparse

import pytest

from app.db import SessionLocal
from app.models import CalendarAccount, CalendarEvent
from app.routers.calendar import google_auth_url

pytestmark = pytest.mark.asyncio


def test_google_auth_url_builds_a_valid_consent_url():
    url = google_auth_url("client-123", "https://api.example.com/calendar/google/callback", "STATE")
    parsed = urlparse(url)
    q = parse_qs(parsed.query)
    assert parsed.netloc == "accounts.google.com"
    assert q["client_id"] == ["client-123"]
    assert q["redirect_uri"] == ["https://api.example.com/calendar/google/callback"]
    assert q["response_type"] == ["code"]
    assert q["state"] == ["STATE"]
    # These two are what make Google return a refresh token.
    assert q["access_type"] == ["offline"]
    assert q["prompt"] == ["consent"]
    assert "calendar.readonly" in q["scope"][0]


async def test_status_defaults_to_unconfigured(client):
    r = await client.get("/calendar/status")
    assert r.status_code == 200
    body = r.json()
    # No Google client set in the test env.
    assert body["google_configured"] is False
    assert body["connected_accounts"] == 0


async def test_authorize_requires_configuration(client):
    # Without a configured client, starting the flow fails loud and clear.
    r = await client.get("/calendar/google/authorize")
    assert r.status_code == 503


async def test_accounts_and_events_start_empty(client):
    assert (await client.get("/calendar/accounts")).json() == []
    assert (await client.get("/calendar/events")).json() == []


async def test_connections_are_listed_scoped_and_deletable(client, other_client, user_id):
    # A calendar account is only ever created by the OAuth callback, so seed
    # one directly to exercise list/delete/events without a live Google.
    await client.get("/calendar/status")             # provisions the user row (FK target)
    await other_client.get("/calendar/status")
    other = other_client.vault_user_id

    async with SessionLocal() as s:
        mine = CalendarAccount(id=f"cal-{user_id}", user_id=user_id,
                               provider="google", external_email="me@example.com")
        s.add(mine)
        s.add(CalendarAccount(id=f"cal-{other}", user_id=other,
                              provider="google", external_email="them@example.com"))
        await s.flush()
        s.add(CalendarEvent(id=f"ev-{user_id}", account_id=mine.id, source="external",
                            title="Standup"))
        await s.commit()

    listed = (await client.get("/calendar/accounts")).json()
    assert [a["external_email"] for a in listed] == ["me@example.com"]  # scoped: not "them@"
    assert listed[0].get("access_token") is None                        # tokens never exposed

    events = (await client.get("/calendar/events")).json()
    assert [e["title"] for e in events] == ["Standup"]

    # Disconnect removes it (and cascades the event), and is idempotent.
    assert (await client.delete(f"/calendar/accounts/cal-{user_id}")).status_code == 200
    assert (await client.delete(f"/calendar/accounts/cal-{user_id}")).status_code == 200
    assert (await client.get("/calendar/accounts")).json() == []
    assert (await client.get("/calendar/events")).json() == []

    # The other account is untouched.
    assert len((await other_client.get("/calendar/accounts")).json()) == 1
