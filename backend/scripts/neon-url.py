#!/usr/bin/env python3
"""Turn a Neon (or any Postgres) URL into the DATABASE_URL this app needs.

Neon hands you a libpq-style URL. Two things have to change and neither is
obvious from their console:

  postgresql://          → postgresql+asyncpg://   (tells SQLAlchemy the driver)
  ?sslmode=require       → ?ssl=require            (asyncpg is not libpq, and
                                                    rejects sslmode outright)

Usage:  python scripts/neon-url.py '<paste the URL from Neon>'
"""

import sys
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# asyncpg accepts none of these; they are libpq spellings.
DROP = {"channel_binding", "options", "target_session_attrs"}


def convert(raw: str) -> str:
    u = urlparse(raw.strip().strip('"').strip("'"))

    scheme = "postgresql+asyncpg"
    query = []
    for k, v in parse_qsl(u.query):
        if k in DROP:
            continue
        if k == "sslmode":
            # require / verify-full / prefer all mean "use TLS" to asyncpg.
            query.append(("ssl", "require" if v != "disable" else "disable"))
        else:
            query.append((k, v))
    if not any(k == "ssl" for k, _ in query):
        query.append(("ssl", "require"))   # Neon always needs TLS

    host = u.netloc
    warn = "-pooler." in host
    return urlunparse((scheme, host, u.path, "", urlencode(query), "")), warn


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    url, pooled = convert(sys.argv[1])
    print("\nDATABASE_URL=" + url + "\n")
    if pooled:
        print("⚠  That is the POOLED endpoint (host contains '-pooler').")
        print("   Use the DIRECT one instead: pgbouncer runs in transaction mode,")
        print("   which breaks asyncpg's prepared statements.\n")
