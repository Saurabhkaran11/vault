"""File storage brokering.

A presigned URL is a bearer credential: whoever holds it can read the object
until it expires, regardless of who they are. So the only thing standing
between one account and another's documents is the ownership check before
signing — which is what most of this file tests.

No bucket is configured in CI, so the disabled path is exercised for real.
The signing paths use a stubbed storage layer rather than a live S3.
"""

import pytest

pytestmark = pytest.mark.asyncio


async def test_status_reports_disabled_without_a_bucket(client):
    """The frontend asks this before offering an upload so it can fall back
    to browser storage with an honest message."""
    assert (await client.get("/files/status")).json() == {"enabled": False}


async def test_upload_url_explains_itself_when_storage_is_off(client, pfx):
    r = await client.post("/files/upload-url", json={
        "client_id": f"{pfx}-1", "filename": "a.pdf", "content_type": "application/pdf"})
    assert r.status_code == 503
    # The operator needs the variable name, not a stack trace.
    assert "S3_BUCKET" in r.json()["detail"]


async def test_keys_are_namespaced_per_user(monkeypatch, client, pfx):
    """`u/{user}/{item}/{file}` puts the account first so a bucket policy can
    scope by prefix and two accounts cannot collide by construction."""
    import app.storage as storage

    monkeypatch.setattr(storage.settings, "s3_bucket", "test-bucket")
    monkeypatch.setattr(storage, "_client", lambda: _FakeS3())

    r = await client.post("/files/upload-url", json={
        "client_id": "item-42", "filename": "report.pdf", "content_type": "application/pdf"})
    assert r.status_code == 200
    key = r.json()["key"]
    uid = client.headers["X-User-Id"]
    assert key == f"u/{uid}/item-42/report.pdf"


async def test_filenames_are_sanitised(monkeypatch, client):
    """A traversal attempt must not escape the user's prefix."""
    import app.storage as storage

    monkeypatch.setattr(storage.settings, "s3_bucket", "test-bucket")
    monkeypatch.setattr(storage, "_client", lambda: _FakeS3())

    r = await client.post("/files/upload-url", json={
        "client_id": "x", "filename": "../../../etc/passwd", "content_type": "text/plain"})
    key = r.json()["key"]
    uid = client.headers["X-User-Id"]

    # The property that matters is containment, not the absence of dots: an
    # S3 keyspace is flat, so ".." only traverses when separators survive.
    # Every separator in the filename must be neutralised, leaving exactly
    # the three the key format itself defines.
    assert key.startswith(f"u/{uid}/x/")
    assert key.count("/") == 3, f"filename introduced extra path segments: {key}"
    assert "/etc/" not in key


async def test_cannot_get_a_download_url_for_another_users_key(client, other_client):
    """The whole security model in one test."""
    victim = other_client.headers["X-User-Id"]
    stolen = f"u/{victim}/secret-item/salary.pdf"
    r = await client.get(f"/files/download-url?key={stolen}")
    # 404 rather than 403 — a different answer would confirm the key exists.
    assert r.status_code == 404


async def test_download_url_refuses_a_key_no_item_claims(monkeypatch, client):
    """Owning the prefix is not enough: some item of yours must actually
    reference the key, or a deleted file's URL would still be signable."""
    import app.storage as storage

    monkeypatch.setattr(storage.settings, "s3_bucket", "test-bucket")
    monkeypatch.setattr(storage, "_client", lambda: _FakeS3())

    uid = client.headers["X-User-Id"]
    r = await client.get(f"/files/download-url?key=u/{uid}/never-created/ghost.pdf")
    assert r.status_code == 404


async def test_download_url_is_signed_once_the_item_carries_the_key(monkeypatch, client, pfx):
    import app.storage as storage

    monkeypatch.setattr(storage.settings, "s3_bucket", "test-bucket")
    monkeypatch.setattr(storage, "_client", lambda: _FakeS3())

    uid = client.headers["X-User-Id"]
    key = f"u/{uid}/{pfx}-doc/report.pdf"
    await client.post("/items/upsert", json={
        "client_id": f"{pfx}-doc", "type": "doc", "title": "Report",
        "status": "Inbox", "tags": [], "added_on": "2026-08-19", "deleted_on": None,
        "file_meta": {"name": "report.pdf", "type": "application/pdf", "size": 10, "s3_key": key},
    })

    r = await client.get(f"/files/download-url?key={key}")
    assert r.status_code == 200
    assert r.json()["url"].startswith("https://signed.example/")


async def test_delete_is_idempotent_and_scoped(client, other_client):
    uid = client.headers["X-User-Id"]
    mine = f"u/{uid}/item/a.pdf"
    # Replayed deletes must succeed or the frontend's ordered retry queue wedges.
    assert (await client.delete(f"/files?key={mine}")).status_code == 200
    assert (await client.delete(f"/files?key={mine}")).status_code == 200

    victim = other_client.headers["X-User-Id"]
    r = await client.delete(f"/files?key=u/{victim}/item/a.pdf")
    assert r.json() == {"ok": True, "deleted": False}, "must not delete another account's object"


class _FakeS3:
    """Stands in for boto3 — the contract we depend on is two methods."""

    def generate_presigned_post(self, Bucket, Key, Fields=None, Conditions=None, ExpiresIn=None):
        return {"url": f"https://s3.example/{Bucket}", "fields": {**(Fields or {}), "key": Key}}

    def generate_presigned_url(self, op, Params=None, ExpiresIn=None):
        return f"https://signed.example/{Params.get('Key')}"
