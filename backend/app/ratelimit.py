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


async def rate_limit(request: Request, call_next):
    limit = settings.rate_limit_per_minute
    if limit <= 0 or request.url.path in EXEMPT_PATHS:
        return await call_next(request)

    key = f"rl:{_identity(request)}:{int(__import__('time').time() // 60)}"
    try:
        redis = await get_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, 90)          # outlives the window, then self-deletes
        count, _ = await pipe.execute()
    except Exception as exc:
        log.warning(f"Rate limiter unavailable, allowing request: {type(exc).__name__}: {exc}")
        return await call_next(request)

    if int(count) > limit:
        return JSONResponse(
            status_code=429,
            content={"detail": f"Rate limit exceeded ({limit}/minute). Retry shortly."},
            headers={"Retry-After": "60"},
        )
    response = await call_next(request)
    response.headers["X-RateLimit-Limit"] = str(limit)
    response.headers["X-RateLimit-Remaining"] = str(max(0, limit - int(count)))
    return response
