from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from .auth import assert_safe_auth_config
from .config import settings
from .db import engine
from .observability import configure_logging, log, request_context, unhandled_exception_handler
from .ratelimit import close_redis, get_redis, rate_limit
from .routers import ai, boards, files, finance, items, sync, tags, todos


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Schema is owned by Alembic (`alembic upgrade head`), never by the app.

    Creating tables at boot would let two app instances race each other on
    startup and would silently paper over a missed migration in production.
    Failing loudly here instead is the point: if the schema is behind, or the
    auth configuration is unsafe, the deploy should stop, not improvise.
    """
    configure_logging(settings.log_level)
    assert_safe_auth_config()

    # to_regclass returns NULL instead of raising when the table is absent.
    # A plain SELECT would throw asyncpg's UndefinedTableError on a fresh
    # database — which is the *common* case — burying the one instruction
    # the operator actually needs under a driver traceback.
    async with engine.connect() as conn:
        has_table = (await conn.execute(text("SELECT to_regclass('public.alembic_version')"))).scalar_one()
        current = (
            (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
            if has_table else None
        )
    if not current:
        raise RuntimeError(
            "Database has no Alembic revision — run `alembic upgrade head` before starting the API."
        )
    log.info(f"Vault API ready (schema {current}, auth={settings.auth_mode})")
    yield
    await close_redis()
    await engine.dispose()


app = FastAPI(title="Vault API", version="0.2.0", lifespan=lifespan)

# Middleware runs bottom-up, so registration order matters: the body cap is
# registered first and therefore runs innermost, the request context last and
# therefore outermost. Net effect per request: correlate/time → throttle →
# size-check → route, so the cheapest rejections happen before real work and
# every rejection still gets logged with its request id.
@app.middleware("http")
async def _cap_body_size(request, call_next):
    """Reject oversized bodies before they are parsed. Content-Length is a
    client-supplied claim, so this is a cheap first gate, not a guarantee —
    the real ceiling belongs at the ingress/load balancer."""
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_body_bytes:
        return JSONResponse(status_code=413, content={"detail": f"Body exceeds {settings.max_body_bytes} bytes"})
    return await call_next(request)


app.middleware("http")(rate_limit)
app.middleware("http")(request_context)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,   # CORS_ORIGINS env var in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # A browser cannot read a response header unless it is exposed. Without
    # X-Total-Count here, the frontend's paging loop sees `null`, assumes one
    # page is the whole set, and a restore silently truncates the vault.
    expose_headers=["X-Request-Id", "X-Total-Count", "X-Page-Limit", "X-Page-Offset"],
)

# Unhandled errors are logged in full and answered generically — see
# observability.unhandled_exception_handler for why this must return rather
# than re-raise.
app.add_exception_handler(Exception, unhandled_exception_handler)

for r in (items.router, todos.router, boards.router, finance.router,
          tags.router, ai.router, sync.router, files.router):
    app.include_router(r)


@app.get("/health/live")
async def live():
    """Liveness: is the process up? Deliberately dependency-free — a failing
    database must not cause the orchestrator to kill and restart the API."""
    return {"ok": True}


@app.get("/health/ready")
async def ready():
    """Readiness: can this instance actually serve? Checks both backing
    services, and reports which one is down instead of a bare failure."""
    checks: dict[str, str] = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {type(exc).__name__}"
    try:
        await (await get_redis()).ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {type(exc).__name__}"

    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(status_code=200 if healthy else 503, content={"ok": healthy, "checks": checks})


@app.get("/health")
async def health():
    """Kept for the frontend's reachability probe, which predates the
    live/ready split and only asks 'can I talk to the backend'."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"ok": True}
