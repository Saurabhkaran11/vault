"""File storage brokering.

Presigned URLs are bearer credentials — whoever holds one can use it until
it expires — so the interesting tests are about who can obtain one, and
about keys that try to escape their owner's prefix.
"""

import pytest

from app.storage import owns_key, safe_key



def test_key_is_scoped_to_the_user():
    key = safe_key("user_abc", "item-1", "resume.pdf")
    assert key == "u/user_abc/item-1/resume.pdf"
    assert owns_key("user_abc", key)
    assert not owns_key("user_xyz", key)


def test_traversal_in_a_filename_cannot_escape_the_prefix():
    """A filename is attacker-controlled input, and `../` in it would
    otherwise reach another account's objects."""
    key = safe_key("user_abc", "item-1", "../../user_xyz/secret.pdf")
    # The property is that the key cannot LEAVE its prefix. Literal dots
    # survive and are harmless — traversal needs a separator, and every
    # separator in the untrusted segment is rewritten.
    assert key.startswith("u/user_abc/item-1/")
    assert "../" not in key
    assert key.count("/") == 3, "the untrusted name must not introduce new path segments"
    assert not owns_key("user_xyz", key)


def test_a_crafted_user_id_cannot_widen_the_prefix():
    key = safe_key("user_abc/../user_xyz", "i", "f.pdf")
    assert key.startswith("u/user_abc")
    assert "/../" not in key


@pytest.mark.asyncio
async def test_status_reports_disabled_when_no_bucket(client):
    """With no bucket the frontend must be able to tell, so it can keep file
    bodies local and say so rather than failing at upload time."""
    r = await client.get("/files/status")
    assert r.status_code == 200
    assert r.json() == {"enabled": False}


@pytest.mark.asyncio
async def test_upload_url_is_503_not_500_when_storage_is_unconfigured(client):
    r = await client.post("/files/upload-url", json={
        "client_id": "i1", "filename": "a.pdf", "content_type": "application/pdf"})
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


@pytest.mark.asyncio
async def test_cannot_get_a_download_url_for_another_users_key(client):
    r = await client.get("/files/download-url", params={"key": "u/someone-else/i/secret.pdf"})
    assert r.status_code == 404, "must not confirm whether another account's file exists"


@pytest.mark.asyncio
async def test_deleting_another_users_key_is_a_no_op(client):
    r = await client.delete("/files", params={"key": "u/someone-else/i/secret.pdf"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "deleted": False}


def test_inline_types_are_limited():
    """Anything not on the inline list must download rather than render, so
    an uploaded .html cannot execute in the vault's own origin."""
    from app.storage import INLINE_TYPES
    assert "text/html" not in INLINE_TYPES
    assert "application/javascript" not in INLINE_TYPES
    assert "application/pdf" in INLINE_TYPES
