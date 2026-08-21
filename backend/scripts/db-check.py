#!/usr/bin/env python3
"""Find out WHICH layer of a Postgres connection is failing.

A driver traceback tells you it broke, not where. This walks the layers in
order — DNS, TCP, TLS, authentication, database, extensions — and stops at the
first failure with the specific thing to fix.

Usage:  python scripts/db-check.py 'postgresql+asyncpg://…'
"""

import asyncio
import socket
import ssl
import sys
from urllib.parse import parse_qsl, urlparse


def main(raw: str) -> int:
    u = urlparse(raw.strip().strip('"').strip("'"))
    host, port = u.hostname, u.port or 5432
    params = dict(parse_qsl(u.query))

    print(f"\n  host: {host}\n  port: {port}\n  ssl : {params.get('ssl', '(not set)')}\n")
    if not host:
        print("  ✗ No host — is the URL complete and quoted?")
        return 1
    if "-pooler." in host:
        print("  ⚠ Pooled endpoint: remove '-pooler' from the hostname.\n")

    # 1 — DNS
    try:
        addrs = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        print(f"  ✓ DNS      resolves to {addrs[0][4][0]}")
    except socket.gaierror as e:
        print(f"  ✗ DNS      cannot resolve '{host}' — check for a typo ({e})")
        return 1

    # 2 — TCP
    try:
        with socket.create_connection((host, port), timeout=10):
            print(f"  ✓ TCP      port {port} is open")
    except OSError as e:
        print(f"  ✗ TCP      cannot reach {host}:{port} — firewall, VPN or wrong port ({e})")
        return 1

    # 3 — TLS, only when the URL asks for it. A local Postgres legitimately
    #     answers 'N' here and that is not a fault.
    wants_tls = params.get("ssl", "").lower() not in ("", "disable", "false")
    if not wants_tls:
        print("  – TLS      not requested (ssl not set) — skipping")
    else:
      try:
        ctx = ssl.create_default_context()
        with socket.create_connection((host, port), timeout=10) as sock:
            sock.sendall(b"\x00\x00\x00\x08\x04\xd2\x16\x2f")   # SSLRequest
            reply = sock.recv(1)
            if reply != b"S":
                print(f"  ✗ TLS      server refused TLS (replied {reply!r})")
                print("             The URL asks for ssl=require but this server has no TLS.")
                return 1
            with ctx.wrap_socket(sock, server_hostname=host) as tls:
                print(f"  ✓ TLS      handshake OK ({tls.version()})")
      except ssl.SSLError as e:
        print(f"  ✗ TLS      handshake failed — {e}")
        return 1
      except OSError as e:
        print(f"  ✗ TLS      reset during handshake — {e}")
        print("             Most often: the Neon project is suspended and still")
        print("             waking (retry in ~10s), or the hostname is not a real")
        print("             endpoint. Reset here is the server hanging up, not auth.")
        return 1

    # 4 — auth + database + extension
    async def probe():
        from sqlalchemy.ext.asyncio import create_async_engine
        from sqlalchemy import text
        engine = create_async_engine(raw, pool_pre_ping=True)
        try:
            async with engine.connect() as c:
                v = (await c.execute(text("SELECT version()"))).scalar_one()
                print(f"  ✓ AUTH     connected — {v.split(',')[0]}")
                ext = (await c.execute(
                    text("SELECT extversion FROM pg_extension WHERE extname='vector'")
                )).scalar_one_or_none()
                if ext:
                    print(f"  ✓ pgvector installed (v{ext})")
                else:
                    print("  ✗ pgvector MISSING — run: CREATE EXTENSION vector;")
                    return 1
            return 0
        finally:
            await engine.dispose()

    try:
        return asyncio.run(probe())
    except Exception as e:
        msg = str(e).split("\n")[0]
        print(f"  ✗ AUTH     {type(e).__name__}: {msg[:120]}")
        if "password" in msg.lower():
            print("             Wrong password — copy the URL from Neon again.")
        elif "does not exist" in msg.lower():
            print("             That database name does not exist on the project.")
        return 1


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    raise SystemExit(main(sys.argv[1]))
