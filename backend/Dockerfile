FROM python:3.12-slim
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY worker ./worker
COPY alembic ./alembic
COPY alembic.ini .
EXPOSE 8000
# Migrations run before the API starts: the app refuses to boot against an
# unmigrated database (see app/main.py lifespan), so this ordering is the
# contract, not a convenience. Alembic is idempotent — a no-op on a
# current schema — so restarts and multiple replicas are safe.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
