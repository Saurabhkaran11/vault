from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .db import Base, engine
from .routers import ai, boards, finance, items, sync, tags, todos


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)   # v0 bootstrap; Alembic takes over pre-launch
    yield


app = FastAPI(title="Vault API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3100", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
