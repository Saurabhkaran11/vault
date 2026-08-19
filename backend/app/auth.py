"""Authentication — provider-agnostic JWT verification.

Until now `X-User-Id` was taken at face value, so anyone could read anyone's
vault by typing a different id. That is fine for a single-user dev loop and
fatal in public. Rather than bind the codebase to one vendor, this verifies
a standard OIDC access token against the issuer's JWKS, which is what Clerk,
Auth0, Cognito, Supabase and Firebase all publish. Switching providers is
three environment variables, not a refactor.

Two modes, chosen by AUTH_MODE:

  dev  — trust `X-User-Id`. The local loop, and the only way the frontend
         works before you wire up a provider.
  jwt  — require `Authorization: Bearer <token>`, verify signature, issuer,
         audience and expiry, and take the `sub` claim as the user id.

The interlock in `assert_safe_auth_config()` is the important part: dev mode
refuses to start once the app is configured for a non-local origin, so an
unauthenticated backend cannot be deployed by forgetting a variable.
"""

import logging
from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, Request
from jwt import PyJWKClient
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_session
from .models import User

log = logging.getLogger("vault.auth")


class AuthConfigError(RuntimeError):
    """Raised at startup — never at request time — for an unsafe setup."""


def _is_local(origin: str) -> bool:
    return origin.startswith("http://localhost") or origin.startswith("http://127.0.0.1")


def assert_safe_auth_config() -> None:
    """Fail the boot rather than serve an open backend to the internet."""
    if settings.auth_mode == "jwt":
        if not settings.jwt_issuer or not settings.jwt_jwks_url:
            raise AuthConfigError("AUTH_MODE=jwt requires JWT_ISSUER and JWT_JWKS_URL")
        return

    if settings.auth_mode != "dev":
        raise AuthConfigError(f"AUTH_MODE must be 'dev' or 'jwt', got {settings.auth_mode!r}")

    public_origins = [o for o in settings.cors_origin_list if not _is_local(o)]
    if public_origins:
        raise AuthConfigError(
            "AUTH_MODE=dev trusts the X-User-Id header, so any caller can read any "
            f"account — refusing to start while serving public origins {public_origins}. "
            "Set AUTH_MODE=jwt with JWT_ISSUER/JWT_JWKS_URL before deploying."
        )
    log.warning(
        "AUTH_MODE=dev — X-User-Id is trusted without verification. "
        "Local development only; never expose this to a public origin."
    )


@lru_cache(maxsize=1)
def _jwks_client() -> PyJWKClient:
    # PyJWKClient caches signing keys internally and refetches on rotation,
    # so this is one long-lived client rather than a fetch per request.
    return PyJWKClient(settings.jwt_jwks_url, cache_keys=True)


def _verify_bearer(token: str) -> str:
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            issuer=settings.jwt_issuer,
            # Audience is optional: some providers omit it for access tokens.
            audience=settings.jwt_audience or None,
            options={"require": ["exp", "sub"], "verify_aud": bool(settings.jwt_audience)},
        )
    except jwt.PyJWTError as exc:
        # Log the reason, tell the caller only that it failed.
        log.warning(f"Rejected token: {type(exc).__name__}: {exc}")
        raise HTTPException(401, "Invalid or expired token") from exc

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "Token has no subject claim")
    return str(sub)


async def current_user_id(
    request: Request,
    session: AsyncSession = Depends(get_session),
    x_user_id: str | None = Header(default=None),
) -> str:
    """Resolve the caller's user id, creating the row on first sight.

    Every router already depends on this, so switching modes changes nothing
    downstream — the id is still just a string.
    """
    if settings.auth_mode == "jwt":
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(401, "Missing bearer token")
        uid = _verify_bearer(token)
    else:
        uid = x_user_id or settings.demo_user

    if not await session.get(User, uid):
        session.add(User(id=uid))
        await session.commit()
    return uid
