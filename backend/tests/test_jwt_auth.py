"""JWT mode, exercised against real signed tokens.

Config tests prove the wiring refuses bad setups; these prove the verifier
actually verifies. A self-signed RSA key stands in for the provider's JWKS,
so the whole path — signature, issuer, audience, expiry, subject — runs
exactly as it will against Clerk or Auth0, with no network call.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import ASGITransport, AsyncClient

ISSUER = "https://test-issuer.example.com"
AUDIENCE = "vault-api"


@pytest.fixture(scope="module")
def keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return key, pem


def _token(pem, *, sub="user-123", iss=ISSUER, aud=AUDIENCE, expires_in=3600):
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {"sub": sub, "iss": iss, "aud": aud,
         "iat": now, "exp": now + timedelta(seconds=expires_in)},
        pem, algorithm="RS256",
    )


@pytest.fixture
def jwt_app(monkeypatch, keypair):
    """Put the app in jwt mode with the test key standing in for the JWKS."""
    key, pem = keypair
    import app.auth as auth
    from app.config import Settings

    monkeypatch.setattr(auth, "settings", Settings(
        _env_file=None, auth_mode="jwt", jwt_issuer=ISSUER,
        jwt_jwks_url=f"{ISSUER}/.well-known/jwks.json", jwt_audience=AUDIENCE,
    ))

    class FakeSigningKey:
        def __init__(self, k): self.key = k

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            return FakeSigningKey(key.public_key())

    monkeypatch.setattr(auth, "_jwks_client", lambda: FakeJWKS())
    return pem


async def _get(pem_token, path="/todos"):
    from app.main import app
    headers = {"Authorization": f"Bearer {pem_token}"} if pem_token else {}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers=headers) as ac:
        return await ac.get(path)


@pytest.mark.asyncio
async def test_valid_token_is_accepted_and_identifies_the_user(jwt_app, keypair):
    from tests.conftest import _purge
    r = await _get(_token(jwt_app, sub="user-123"))
    assert r.status_code == 200
    await _purge("user-123")


@pytest.mark.asyncio
async def test_missing_token_is_rejected(jwt_app):
    r = await _get(None)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_expired_token_is_rejected(jwt_app):
    r = await _get(_token(jwt_app, expires_in=-60))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_wrong_issuer_is_rejected(jwt_app):
    r = await _get(_token(jwt_app, iss="https://attacker.example.com"))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_wrong_audience_is_rejected(jwt_app):
    r = await _get(_token(jwt_app, aud="some-other-api"))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_token_signed_by_another_key_is_rejected(jwt_app):
    """The core guarantee: a well-formed token someone else minted is useless."""
    attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    attacker_pem = attacker.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    r = await _get(_token(attacker_pem))
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_x_user_id_header_is_ignored_in_jwt_mode(jwt_app):
    """The whole point of the migration: the old header must buy nothing."""
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                           headers={"X-User-Id": "someone-elses-account"}) as ac:
        r = await ac.get("/todos")
    assert r.status_code == 401
