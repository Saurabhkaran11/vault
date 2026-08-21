from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """12-factor config — every value comes from the environment, so the
    Railway → AWS (App Runner/ECS + RDS + ElastiCache) move is a values
    change, never a code change."""

    database_url: str = "postgresql+asyncpg://vault:vault@localhost:5433/vault"
    redis_url: str = "redis://localhost:6380"

    # Comma-separated browser origins allowed to call this API. The default
    # covers local dev; production sets CORS_ORIGINS to the deployed domain.
    cors_origins: str = "http://localhost:3100,http://localhost:3000"
    # Reject bodies larger than this (bytes). Note bodies carry note blocks
    # and board snapshots, so it is generous — but not unbounded.
    max_body_bytes: int = 5 * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # AI proxy (phase 3): the user's provider key lives HERE, never in the browser.
    anthropic_api_key: str | None = None

    # Server-side chat completion. Any OpenAI-compatible endpoint — including
    # ones a BROWSER cannot reach, which is the point: providers like NVIDIA
    # NIM send no CORS headers, so the frontend can never call them directly
    # however valid the key. Routing through here also means the key lives on
    # the server instead of in every user's localStorage.
    chat_url: str | None = None            # e.g. https://integrate.api.nvidia.com/v1
    chat_api_key: str | None = None
    chat_model: str | None = None          # e.g. meta/llama-3.3-70b-instruct
    chat_max_tokens: int = 4096
    # Any OpenAI-compatible embeddings endpoint (Ollama, Together, OpenAI…).
    embeddings_url: str | None = None
    embeddings_api_key: str | None = None
    embeddings_model: str = "nomic-embed-text"
    embedding_dim: int = 768

    # ---- auth ----
    # "dev"  → trust X-User-Id (local only; refuses to boot on a public origin)
    # "jwt"  → verify a bearer token against the issuer's JWKS
    auth_mode: str = "dev"
    jwt_issuer: str | None = None        # e.g. https://your-app.clerk.accounts.dev
    jwt_jwks_url: str | None = None      # e.g. <issuer>/.well-known/jwks.json
    jwt_audience: str | None = None      # optional; some providers omit it
    demo_user: str = "demo"              # the identity used in dev mode

    # ---- file storage (optional) ----
    # Unset S3_BUCKET keeps file bodies in the browser, exactly as before.
    s3_bucket: str | None = None
    s3_region: str = "us-east-1"
    s3_endpoint_url: str | None = None      # set for MinIO / R2 / LocalStack
    aws_access_key_id: str | None = None    # omit on AWS to use the instance role
    aws_secret_access_key: str | None = None
    s3_max_upload_bytes: int = 25 * 1024 * 1024
    s3_url_ttl_seconds: int = 900           # presigned links are short-lived by design

    # ---- limits ----
    # Requests per window, per identity. Generous: a sync flush legitimately
    # fires a burst of mirrors. Set RATE_LIMIT_PER_MINUTE=0 to disable.
    rate_limit_per_minute: int = 300
    log_level: str = "INFO"

    # ---- error reporting (optional; unset = logs only) ----
    sentry_dsn: str | None = None
    sentry_environment: str = "development"
    sentry_traces_sample_rate: float = 0.1
    release: str | None = None          # set to the git sha at deploy time

    class Config:
        env_file = ".env"
        # Ignore environment variables that are not settings, rather than
        # refusing to start. Every real host sets its own: Render adds PORT and
        # RENDER_SERVICE_ID, AWS adds task metadata, a shell adds VIRTUAL_ENV.
        # Forbidding extras turns any of those into a crash at boot, with an
        # error naming a variable that has nothing to do with the app.
        extra = "ignore"


settings = Settings()
