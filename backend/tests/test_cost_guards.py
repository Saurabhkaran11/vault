"""The guards that keep one user from running up the bill.

Two mechanisms: per-class rate limits on the endpoints that cost money
(AI calls, reindex, upload signing), and a per-account storage quota checked
before an upload URL is ever signed. The limiter needs Redis in production;
here a tiny in-process fake makes the 429 path deterministic.
"""

import pytest

import app.ratelimit as rl
from app.ratelimit import class_limits

pytestmark = pytest.mark.asyncio


# ---------- the pure classifier ----------

def test_ai_endpoints_get_minute_and_day_buckets(monkeypatch):
    monkeypatch.setattr(rl.settings, "ai_rate_limit_per_minute", 20)
    monkeypatch.setattr(rl.settings, "ai_rate_limit_per_day", 400)
    for path in ("/ai/ask", "/ai/complete"):
        buckets = [b for b, *_ in class_limits(path)]
        assert buckets == ["aim", "aid"]


def test_reindex_and_uploads_have_their_own_buckets():
    assert [b for b, *_ in class_limits("/ai/reindex")] == ["rix"]
    assert [b for b, *_ in class_limits("/files/upload-url")] == ["up"]


def test_ordinary_paths_carry_no_extra_buckets():
    assert class_limits("/items") == []
    assert class_limits("/todos") == []


def test_a_zeroed_limit_disables_its_bucket(monkeypatch):
    monkeypatch.setattr(rl.settings, "ai_rate_limit_per_day", 0)
    assert [b for b, *_ in class_limits("/ai/ask")] == ["aim"]


# ---------- enforcement through the middleware, with a fake Redis ----------

class _FakePipe:
    def __init__(self, store):
        self.store, self.ops = store, []

    def incr(self, key):
        self.ops.append(("incr", key))

    def expire(self, key, ttl):
        self.ops.append(("expire", key))

    async def execute(self):
        out = []
        for op, key in self.ops:
            if op == "incr":
                self.store[key] = self.store.get(key, 0) + 1
                out.append(self.store[key])
            else:
                out.append(True)
        return out


class _FakeRedis:
    def __init__(self):
        self.store = {}

    def pipeline(self):
        return _FakePipe(self.store)


@pytest.fixture
def fake_redis(monkeypatch):
    fake = _FakeRedis()

    async def _get():
        return fake

    monkeypatch.setattr(rl, "get_redis", _get)
    return fake


async def test_upload_url_hits_429_after_its_burst(monkeypatch, fake_redis, client, pfx):
    """The 3rd signing request in a minute is refused — before that, the
    handler's own answer (503, no bucket in CI) passes through untouched."""
    monkeypatch.setattr(rl.settings, "upload_rate_limit_per_minute", 2)
    body = {"client_id": f"{pfx}-1", "filename": "a.pdf", "size": 10}
    assert (await client.post("/files/upload-url", json=body)).status_code == 503
    assert (await client.post("/files/upload-url", json=body)).status_code == 503
    r = await client.post("/files/upload-url", json=body)
    assert r.status_code == 429
    assert "uploads/minute" in r.json()["detail"]
    assert int(r.headers["Retry-After"]) >= 1


async def test_ai_daily_ceiling_reports_the_daily_window(monkeypatch, fake_redis, client):
    """With the minute bucket wide open, the day bucket still stops the run —
    and the Retry-After speaks in day-window terms, not '60'."""
    monkeypatch.setattr(rl.settings, "ai_rate_limit_per_minute", 100)
    monkeypatch.setattr(rl.settings, "ai_rate_limit_per_day", 1)
    assert (await client.post("/ai/complete", json={"prompt": "hi"})).status_code != 429
    r = await client.post("/ai/complete", json={"prompt": "hi"})
    assert r.status_code == 429
    assert "AI requests/day" in r.json()["detail"]
    assert int(r.headers["Retry-After"]) > 60


async def test_other_traffic_is_untouched_by_class_limits(monkeypatch, fake_redis, client):
    monkeypatch.setattr(rl.settings, "upload_rate_limit_per_minute", 1)
    for _ in range(3):
        assert (await client.get("/items")).status_code == 200


# ---------- the storage quota ----------

async def test_upload_is_refused_once_the_account_is_full(monkeypatch, client, pfx):
    """A user at the cap gets a clear 413 naming their usage — before any
    signing happens, so it holds with or without a bucket configured."""
    from app.routers import files as files_router
    monkeypatch.setattr(files_router, "used_storage_bytes", _stub_used(150 * 1024 * 1024))
    import app.config as config
    monkeypatch.setattr(config.settings, "max_user_storage_mb", 100)

    r = await client.post("/files/upload-url", json={
        "client_id": f"{pfx}-1", "filename": "big.pdf", "size": 1024})
    assert r.status_code == 413
    assert "150 MB" in r.json()["detail"] and "100 MB" in r.json()["detail"]


async def test_upload_counts_the_incoming_file_against_the_cap(monkeypatch, client, pfx):
    from app.routers import files as files_router
    monkeypatch.setattr(files_router, "used_storage_bytes", _stub_used(90 * 1024 * 1024))
    import app.config as config
    monkeypatch.setattr(config.settings, "max_user_storage_mb", 100)

    # 90 used + 20 declared > 100 → refused even though "used" is under cap
    r = await client.post("/files/upload-url", json={
        "client_id": f"{pfx}-1", "filename": "big.pdf", "size": 20 * 1024 * 1024})
    assert r.status_code == 413

    # a small file still fits → the quota lets it through to the next check
    r = await client.post("/files/upload-url", json={
        "client_id": f"{pfx}-1", "filename": "small.pdf", "size": 1024})
    assert r.status_code == 503        # no bucket in CI — quota passed


async def test_quota_zero_disables_the_check(monkeypatch, client, pfx):
    import app.config as config
    monkeypatch.setattr(config.settings, "max_user_storage_mb", 0)
    r = await client.post("/files/upload-url", json={
        "client_id": f"{pfx}-1", "filename": "a.pdf", "size": 10})
    assert r.status_code == 503        # straight to the storage-off answer


def _stub_used(n):
    async def _used(session, user):
        return n
    return _used
