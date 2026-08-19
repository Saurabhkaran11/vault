"""Auth configuration safety, error hygiene, and the operational guards."""

import pytest

from app.auth import AuthConfigError, assert_safe_auth_config
from app.config import Settings




def _settings(**kw):
    return Settings(_env_file=None, **kw)


def test_dev_auth_is_refused_on_a_public_origin(monkeypatch):
    """The interlock that stops an unauthenticated backend reaching the
    internet because someone forgot an environment variable."""
    import app.auth as auth
    monkeypatch.setattr(auth, "settings", _settings(
        auth_mode="dev", cors_origins="https://vault.example.com"))

    with pytest.raises(AuthConfigError, match="refusing to start"):
        assert_safe_auth_config()


def test_dev_auth_is_allowed_for_local_origins(monkeypatch):
    import app.auth as auth
    monkeypatch.setattr(auth, "settings", _settings(
        auth_mode="dev", cors_origins="http://localhost:3100,http://127.0.0.1:3100"))
    assert_safe_auth_config()   # must not raise


def test_jwt_mode_requires_issuer_and_jwks(monkeypatch):
    import app.auth as auth
    monkeypatch.setattr(auth, "settings", _settings(auth_mode="jwt"))
    with pytest.raises(AuthConfigError, match="JWT_ISSUER"):
        assert_safe_auth_config()


def test_unknown_auth_mode_is_rejected(monkeypatch):
    import app.auth as auth
    monkeypatch.setattr(auth, "settings", _settings(auth_mode="off"))
    with pytest.raises(AuthConfigError, match="must be 'dev' or 'jwt'"):
        assert_safe_auth_config()


@pytest.mark.asyncio
async def test_oversized_body_is_rejected(client):
    from app.config import settings
    payload = {"id": "big", "desc": "x" * (settings.max_body_bytes + 1000),
               "amount_cents": 1, "cat": "Food", "spent_on": "2026-08-19"}
    assert (await client.post("/finance/expenses", json=payload)).status_code == 413


@pytest.mark.asyncio
async def test_every_response_is_correlatable(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.headers.get("X-Request-Id"), "every response needs an id to trace in logs"


@pytest.mark.asyncio
async def test_unhandled_errors_leak_nothing_to_the_caller():
    """A 500 must be traceable by id without handing the caller a stack
    trace, SQL fragment or column name.

    The route is added to a throwaway app so a deliberate crash never
    depends on breaking a real endpoint.
    """
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.observability import request_context, unhandled_exception_handler

    crash_app = FastAPI()
    crash_app.middleware("http")(request_context)
    crash_app.add_exception_handler(Exception, unhandled_exception_handler)

    @crash_app.get("/boom")
    async def boom():
        raise RuntimeError("relation vault_internal.credentials does not exist")

    transport = ASGITransport(app=crash_app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/boom")

    assert r.status_code == 500
    body = r.json()
    assert body["detail"] == "Internal server error"
    assert body["request_id"], "the caller needs an id to quote in a support ticket"
    # The parts an attacker would mine must not appear anywhere in the reply.
    assert "credentials" not in r.text
    assert "RuntimeError" not in r.text
    assert "Traceback" not in r.text


@pytest.mark.asyncio
async def test_readiness_reports_each_dependency(client):
    body = (await client.get("/health/ready")).json()
    assert body["checks"]["database"] == "ok"
    assert body["checks"]["redis"] == "ok"


@pytest.mark.asyncio
async def test_liveness_has_no_dependencies(client):
    """Liveness must not fail when Postgres is down, or the orchestrator
    will kill healthy processes during a database blip."""
    assert (await client.get("/health/live")).json() == {"ok": True}


@pytest.mark.asyncio
async def test_access_log_line_carries_the_request_id(client, caplog):
    """The access log must be joinable to the response header, or a user
    quoting their request id gives you nothing to search for."""
    import logging

    from app.observability import request_id_ctx

    seen = {}

    class Capture(logging.Handler):
        def emit(self, record):
            seen[record.getMessage()] = request_id_ctx.get()

    vault_log = logging.getLogger("vault")
    # httpx's ASGITransport does not run lifespan, so configure_logging()
    # never fired — set the level the app would have set at boot.
    previous = vault_log.level
    vault_log.setLevel(logging.INFO)
    handler = Capture()
    vault_log.addHandler(handler)
    try:
        r = await client.get("/health")
    finally:
        vault_log.removeHandler(handler)
        vault_log.setLevel(previous)

    rid = r.headers["X-Request-Id"]
    access_lines = [msg for msg in seen if "/health" in msg]
    assert access_lines, "the request should have produced an access log line"
    assert seen[access_lines[0]] == rid, "log line and response header must share the id"


@pytest.mark.asyncio
async def test_boot_guard_explains_itself_on_a_fresh_database(monkeypatch):
    """A database that has never been migrated is the COMMON first-run case,
    and the operator needs one instruction, not a driver traceback.

    Regression guard: querying alembic_version directly raises asyncpg's
    UndefinedTableError when the table is absent, which buried the message.
    """
    import app.main as main
    from sqlalchemy import text

    class FakeResult:
        def __init__(self, value): self._value = value
        def scalar_one(self): return self._value
        def scalar_one_or_none(self): return self._value

    class FakeConn:
        async def execute(self, stmt):
            sql = str(stmt)
            if "to_regclass" in sql:
                return FakeResult(None)          # table does not exist
            raise AssertionError("must not query alembic_version when it is absent")
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

    class FakeEngine:
        def connect(self): return FakeConn()
        async def dispose(self): pass

    monkeypatch.setattr(main, "engine", FakeEngine())
    monkeypatch.setattr(main, "assert_safe_auth_config", lambda: None)

    with pytest.raises(RuntimeError, match="alembic upgrade head"):
        async with main.lifespan(main.app):
            pass
