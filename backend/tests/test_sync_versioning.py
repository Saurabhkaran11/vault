"""Last-write-wins versioning on the sync upserts.

Every mirrored row carries the client's clock (`updated_at`, ms since
epoch). A replay whose clock is strictly behind the stored row's lost the
race and must not clobber newer state: the server answers 200 with the
stored row and `stale: true`, so the retry queue drains without wedging
and without corrupting. A clock of 0 is a client from before stamping —
those keep the old always-apply behavior. /sync/import stays an explicit
replace-everything, but must carry the clocks through.
"""

import pytest

pytestmark = pytest.mark.asyncio


def _item(pfx, **kw):
    body = {"client_id": f"{pfx}-1", "type": "note", "title": "v1",
            "added_on": "2026-08-28", "deleted_on": None}
    body.update(kw)
    return body


def _task(pfx, **kw):
    body = {"id": f"{pfx}-t1", "text": "v1", "created_on": "2026-08-28"}
    body.update(kw)
    return body


# ---------- items ----------

async def test_fresh_item_stores_its_clock(client, pfx):
    r = await client.post("/items/upsert", json=_item(pfx, updated_at=1000))
    assert r.status_code == 200
    assert r.json()["updated_at"] == 1000
    assert r.json()["stale"] is False


async def test_newer_item_write_wins(client, pfx):
    await client.post("/items/upsert", json=_item(pfx, updated_at=1000))
    r = await client.post("/items/upsert", json=_item(pfx, title="v2", updated_at=2000))
    assert r.json()["stale"] is False
    assert r.json()["title"] == "v2"
    assert r.json()["updated_at"] == 2000


async def test_equal_item_clock_still_applies(client, pfx):
    # Equal is NOT stale — a same-instant retry of the same write must stay
    # idempotent, not bounce.
    await client.post("/items/upsert", json=_item(pfx, updated_at=1000))
    r = await client.post("/items/upsert", json=_item(pfx, title="v2", updated_at=1000))
    assert r.json()["stale"] is False
    assert r.json()["title"] == "v2"


async def test_older_item_write_is_refused_as_stale(client, pfx):
    await client.post("/items/upsert", json=_item(pfx, title="new", updated_at=2000))
    r = await client.post("/items/upsert", json=_item(pfx, title="old", updated_at=1500))
    assert r.status_code == 200
    assert r.json()["stale"] is True
    assert r.json()["title"] == "new", "a stale write must return the stored row"
    assert r.json()["updated_at"] == 2000

    items = (await client.get("/items")).json()
    assert [i["title"] for i in items] == ["new"], "the stored row must be untouched"


async def test_unstamped_item_write_always_applies(client, pfx):
    # updated_at omitted → 0: a client that predates versioning must keep
    # winning, or every mirror breaks before the frontend ships stamps.
    await client.post("/items/upsert", json=_item(pfx, title="new", updated_at=2000))
    r = await client.post("/items/upsert", json=_item(pfx, title="legacy"))
    assert r.json()["stale"] is False
    assert r.json()["title"] == "legacy"


# ---------- todos ----------

async def test_fresh_task_stores_its_clock(client, pfx):
    r = await client.post("/todos", json=_task(pfx, updated_at=1000))
    assert r.status_code == 201
    assert r.json()["updated_at"] == 1000
    assert r.json()["stale"] is False


async def test_newer_task_write_wins(client, pfx):
    await client.post("/todos", json=_task(pfx, updated_at=1000))
    r = await client.post("/todos", json=_task(pfx, text="v2", updated_at=2000))
    assert r.json()["stale"] is False
    assert r.json()["text"] == "v2"
    assert r.json()["updated_at"] == 2000


async def test_older_task_write_is_refused_as_stale(client, pfx):
    await client.post("/todos", json=_task(pfx, text="new", updated_at=2000))
    r = await client.post("/todos", json=_task(pfx, text="old", updated_at=1500))
    assert r.status_code == 200
    assert r.json()["stale"] is True
    assert r.json()["text"] == "new"
    assert r.json()["updated_at"] == 2000

    tasks = (await client.get("/todos")).json()
    assert [t["text"] for t in tasks] == ["new"]


async def test_stale_task_write_does_not_complete_it(client, pfx):
    # The done→completed event path must not fire off a rejected write.
    await client.post("/todos", json=_task(pfx, updated_at=2000))
    r = await client.post("/todos", json=_task(pfx, done=True, updated_at=1500))
    assert r.json()["stale"] is True
    assert (await client.get("/todos")).json()[0]["done"] is False


async def test_unstamped_task_write_always_applies(client, pfx):
    await client.post("/todos", json=_task(pfx, text="new", updated_at=2000))
    r = await client.post("/todos", json=_task(pfx, text="legacy"))
    assert r.json()["stale"] is False
    assert r.json()["text"] == "legacy"


# ---------- whole-vault import ----------

async def test_import_carries_the_clock_and_still_overwrites(client, pfx):
    snapshot = {
        "items": [{"id": f"{pfx}-i1", "type": "note", "title": "v1",
                   "date": "2026-08-28", "updated_at": 5000}],
        "todos": {"tasks": [{"id": f"{pfx}-t1", "text": "v1",
                             "created": "2026-08-28", "updated_at": 5000}]},
    }
    assert (await client.post("/sync/import", json=snapshot)).status_code == 200
    assert (await client.get("/items")).json()[0]["updated_at"] == 5000
    assert (await client.get("/todos")).json()[0]["updated_at"] == 5000

    # Import is an explicit "replace everything": an OLDER snapshot still
    # wins, and its clock is written — not zeroed, not ignored.
    snapshot["items"][0].update(title="v0", updated_at=1000)
    snapshot["todos"]["tasks"][0].update(text="v0", updated_at=1000)
    assert (await client.post("/sync/import", json=snapshot)).status_code == 200
    items = (await client.get("/items")).json()
    tasks = (await client.get("/todos")).json()
    assert (items[0]["title"], items[0]["updated_at"]) == ("v0", 1000)
    assert (tasks[0]["text"], tasks[0]["updated_at"]) == ("v0", 1000)
