# Vault backend — FastAPI · PostgreSQL(pgvector) · Redis/ARQ

Per-feature APIs mirroring the frontend's stores. Design docs with diagrams: [`../docs/`](../docs/).

## Run everything (Docker)

```bash
cd backend
docker compose up --build          # api :8000 · worker · pgvector db :5433 · redis :6380
```

## Run for development (db+redis in Docker, api/worker local)

```bash
docker compose up -d db redis
uv venv --python 3.12 .venv && uv pip install -r requirements.txt --python .venv/bin/python
VIRTUAL_ENV=.venv uv run alembic upgrade head     # required — the API refuses to boot without it
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/arq worker.tasks.WorkerSettings          # second terminal
```

Interactive docs: http://localhost:8000/docs

## Schema changes

Alembic owns the schema — the app never creates tables, so an unmigrated
database fails the API's startup check instead of being silently improvised.

```bash
VIRTUAL_ENV=.venv uv run alembic revision --autogenerate -m "what changed"
VIRTUAL_ENV=.venv uv run alembic upgrade head
```

Review generated migrations before committing: autogenerate does not detect
`CREATE EXTENSION`, and it emits pgvector column types without importing
pgvector (the script template adds that import for you).

## Configuration

Every value is an environment variable (see `app/config.py`):
`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS` (comma-separated origins allowed
to call the API — set this to your deployed frontend), `MAX_BODY_BYTES`,
and the embeddings/AI keys.

## Try it

```bash
# import your existing frontend export, then build the RAG index
curl -X POST localhost:8000/sync/import -H 'Content-Type: application/json' -d @vault-backup.json
curl -X POST localhost:8000/ai/reindex
curl -X POST localhost:8000/ai/ask -H 'Content-Type: application/json' -d '{"question":"what did I save about fastapi?"}'
```

## Environment (12-factor — see `app/config.py`)

`DATABASE_URL` · `REDIS_URL` · `EMBEDDINGS_URL`/`EMBEDDINGS_API_KEY`/`EMBEDDINGS_MODEL` (any OpenAI-compatible endpoint; dev fallback built in) · `ANTHROPIC_API_KEY` (phase 3 AI proxy).

## Status / roadmap

v0 verified end-to-end (29 endpoints, sprint roll-over, recurring bills, sync import, pgvector ask via worker). Before first deploy: Alembic migrations, Clerk auth (swap `deps.current_user_id`), money → integer cents. Phase 2: S3 presigned files. Phase 3: server-side AI completion + key vault. Phase 4: event fan-out (SES/Slack/push) + calendar subscribe URLs. AWS target: App Runner/ECS + RDS + ElastiCache + S3 + SES.
