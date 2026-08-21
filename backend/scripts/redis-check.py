#!/usr/bin/env python3
"""Check a Redis URL before pasting it into a host.

Upstash presents several values and only one of them works here. The REST
pair (UPSTASH_REDIS_REST_URL / _TOKEN) is a different API entirely and can
never connect; the endpoint alone has no scheme; and the redis-cli snippet
shows redis:// where Upstash actually requires TLS.

Usage:
    python scripts/redis-check.py 'rediss://default:PASSWORD@host.upstash.io:6379'
    python scripts/redis-check.py            # reads REDIS_URL from .env
"""

import asyncio
import sys
from urllib.parse import urlparse


def explain(url: str) -> str | None:
    """Return a specific complaint, or None if the shape looks right."""
    if not url:
        return "empty — nothing to test"
    if url.startswith(("http://", "https://")):
        return ("this is the REST endpoint (UPSTASH_REDIS_REST_URL). "
                "You want the Redis-protocol URL: rediss://default:PASSWORD@host:6379")
    u = urlparse(url)
    if u.scheme not in ("redis", "rediss", "unix"):
        return (f"no Redis scheme (found {u.scheme or 'none'}). "
                "It must start with rediss:// — two s, for TLS")
    if u.scheme == "redis" and "upstash.io" in (u.hostname or ""):
        return "Upstash requires TLS — change redis:// to rediss://"
    if not u.hostname:
        return "no host — the URL looks truncated"
    remote = u.hostname not in ("localhost", "127.0.0.1", "::1")
    if remote and not u.password:
        return "no password — expected rediss://default:PASSWORD@host:6379"
    if remote and not u.port:
        return "no port — Upstash uses :6379"
    return None


async def probe(url: str) -> int:
    from redis.asyncio import Redis

    u = urlparse(url)
    print(f"  scheme: {u.scheme}  host: {u.hostname}  port: {u.port}")
    r = Redis.from_url(url, decode_responses=True, socket_connect_timeout=12)
    try:
        await r.set("vault:check", "ok", ex=30)
        got = await r.get("vault:check")
        await r.delete("vault:check")
        print(f"  ✓ connected — round-trip {got!r}")
        return 0
    except Exception as e:
        print(f"  ✗ {type(e).__name__}: {str(e)[:140]}")
        return 1
    finally:
        await r.aclose()


if __name__ == "__main__":
    if len(sys.argv) > 1:
        url = sys.argv[1].strip()
    else:
        sys.path.insert(0, ".")
        from app.config import settings
        url = settings.redis_url
        print("  (no URL given — using REDIS_URL from .env)")

    problem = explain(url)
    if problem:
        print(f"  ✗ {problem}")
        raise SystemExit(1)
    raise SystemExit(asyncio.run(probe(url)))
