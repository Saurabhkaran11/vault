"""Per-identity rate limiting, backed by Redis.

Deliberately a fixed window rather than a token bucket: the goal is to stop
a runaway client or a scraper, not to shape traffic precisely. One counter
per identity per minute, expired by Redis itself, so there is nothing to
clean up and no memory to leak.

Redis is shared by every API replica, which is why the counter lives there
rather than in process memory — in-process counters would let N replicas
serve N times the limit. If Redis is unreachable the limiter fails OPEN:
losing rate limiting is a smaller failure than refusing every request.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from .config import settings

log = logging.getLogger("vault.ratelimit")

_redis: Redis | None = None

# Health and docs must stay reachable for probes and humans even when a
# caller is being throttled.
EXEMPT_PATHS = {"/health", "/health/live", "/health/ready", "/docs", "/openapi.json", "/redoc"}


async def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


def _identity(request: Request) -> str:
    """Who to charge. The verified subject when we have one, the claimed
    header in dev, and the peer address as a last resort."""
    auth = request.headers.get("authorization", "")
    if auth:
        # Charge the token itself rather than parsing it here — the limiter
        # runs before auth, and a token maps 1:1 to an identity anyway.
        return f"tok:{hash(auth) & 0xFFFFFFFF:08x}"
    uid = request.headers.get("x-user-id")
    if uid:
        return f"uid:{uid}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


def class_limits(path: str) -> list[tuple[str, int, int, str]]:
    """Extra buckets for endpoints that cost money, as
    (bucket, limit, window_seconds, human description). Pure so it's unit-testable."""
    out = []
    if path == "/ai/reindex":
        if settings.reindex_rate_limit_per_minute > 0:
            out.append(("rix", settings.reindex_rate_limit_per_minute, 60,
                        f"{settings.reindex_rate_limit_per_minute} reindexes/minute"))
    elif path in ("/ai/ask", "/ai/complete"):
        if settings.ai_rate_limit_per_minute > 0:
            out.append(("aim", settings.ai_rate_limit_per_minute, 60,
                        f"{settings.ai_rate_limit_per_minute} AI requests/minute"))
        if settings.ai_rate_limit_per_day > 0:
            out.append(("aid", settings.ai_rate_limit_per_day, 86400,
                        f"{settings.ai_rate_limit_per_day} AI requests/day"))
    elif path == "/files/upload-url":
        if settings.upload_rate_limit_per_minute > 0:
            out.append(("up", settings.upload_rate_limit_per_minute, 60,
                        f"{settings.upload_rate_limit_per_minute} uploads/minute"))
    return out


async def rate_limit(request: Request, call_next):
    limit = settings.rate_limit_per_minute
    path = request.url.path
    extras = class_limits(path)
    if (limit <= 0 and not extras) or path in EXEMPT_PATHS:
        return await call_next(request)

    now = __import__("time").time()
    ident = _identity(request)
    checks = []          # (redis key, limit, ttl, retry_after, description)
    if limit > 0:
        checks.append((f"rl:{ident}:{int(now // 60)}", limit, 90, 60,
                       f"{limit} requests/minute"))
    for bucket, blimit, window, desc in extras:
        retry = window - int(now % window)          # seconds until the window rolls
        checks.append((f"rl:{bucket}:{ident}:{int(now // window)}", blimit,
                       window + 60, retry, desc))

    try:
        redis = await get_redis()
        pipe = redis.pipeline()
        for key, _, ttl, _, _ in checks:
            pipe.incr(key)
            pipe.expire(key, ttl)
        results = await pipe.execute()
        counts = [int(results[i * 2]) for i in range(len(checks))]
    except Exception as exc:
        log.warning(f"Rate limiter unavailable, allowing request: {type(exc).__name__}: {exc}")
        return await call_next(request)

    for (key, blimit, _, retry, desc), count in zip(checks, counts):
        if count > blimit:
            return JSONResponse(
                status_code=429,
                content={"detail": f"Rate limit exceeded ({desc}). Retry shortly."},
                headers={"Retry-After": str(max(1, retry))},
            )
    response = await call_next(request)
    if limit > 0:
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - counts[0]))
    return response
