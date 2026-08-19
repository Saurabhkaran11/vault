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
    # Any OpenAI-compatible embeddings endpoint (Ollama, Together, OpenAI…).
    embeddings_url: str | None = None
    embeddings_api_key: str | None = None
    embeddings_model: str = "nomic-embed-text"
    embedding_dim: int = 768

    # v0 single-user mode; replaced by Clerk-verified JWTs in the auth phase.
    demo_user: str = "demo"

    class Config:
        env_file = ".env"


settings = Settings()
