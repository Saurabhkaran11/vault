from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import settings
from .db import engine
from .routers import ai, boards, finance, items, sync, tags, todos


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Schema is owned by Alembic (`alembic upgrade head`), never by the app.

    Creating tables at boot would let two app instances race each other on
    startup and would silently paper over a missed migration in production.
    Failing loudly here instead is the point: if the schema is behind, the
    deploy should stop, not improvise."""
    async with engine.connect() as conn:
        current = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
    if not current:
        raise RuntimeError("Database has no Alembic revision — run `alembic upgrade head` before starting the API.")
    yield


app = FastAPI(title="Vault API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,   # CORS_ORIGINS env var in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def cap_body_size(request, call_next):
    """Reject oversized bodies before they are parsed. Content-Length is a
    client-supplied claim, so this is a cheap first gate, not a guarantee —
    the real ceiling belongs at the ingress/load balancer."""
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_body_bytes:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=413, content={"detail": f"Body exceeds {settings.max_body_bytes} bytes"})
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled(request, exc):
    """Unhandled errors must still produce a JSON response INSIDE the
    middleware stack — Starlette's bare 500 fallback skips CORSMiddleware,
    so browsers see an unreadable response and report 'Failed to fetch'
    instead of the real error."""
    from fastapi.responses import JSONResponse

    return JSONResponse(status_code=500, content={"detail": f"{type(exc).__name__}: {str(exc)[:300]}"})

for r in (items.router, todos.router, boards.router, finance.router, tags.router, ai.router, sync.router):
    app.include_router(r)


@app.get("/health")
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"ok": True}
