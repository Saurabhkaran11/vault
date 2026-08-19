# Tags · Sync · Events — system design

## Tags

Tags live on items (`tags` JSONB) + `custom_tags` for standalone tags created in the Tags view before anything carries them.

| Endpoint | Purpose |
|---|---|
| `GET /tags` | directory: every tag with total + per-type counts; unused customs flagged `custom:true` |
| `POST /tags?tag=` | create (normalized: lowercase, dashes, `#` stripped) |
| `DELETE /tags/{tag}` | remove a custom tag (used tags live on items and are never mass-edited) |

## Sync — the migration door

The frontend's existing JSON export **is** the import format; no new exporter was needed on day one.

```mermaid
sequenceDiagram
  participant U as User
  participant FE as Frontend (Settings)
  participant API as POST /sync/import
  participant PG as Postgres
  U->>FE: Export backup (E) → vault-backup.json
  FE->>API: POST snapshot {items, todos, finance, boards, tags}
  API->>PG: bulk INSERT, client ids preserved, dates parsed
  API-->>FE: {imported: counts}
  FE->>API: POST /ai/reindex   (RAG catches up)
  Note over FE,API: verified: items+tasks+finance+boards+custom tags<br/>round-trip losslessly under a separate user id
```

## Events — the outbox that powers phase 4

Every meaningful change writes an `events` row in the same transaction (`item.created`, `task.completed`, `bill.paid`, `sprint.completed`, `expense.logged`, `digest.daily`). The worker's `drain_outbox` cron marks them processed; fan-out targets plug in per `kind`:

```mermaid
flowchart LR
  E[(events table)] --> D[drain_outbox cron 1/min]
  D --> M{kind}
  M -->|digest.daily| SES[email · SES]
  M -->|bill.overdue| Push[web push]
  M -->|sprint.completed| Slack[Slack/Discord webhook]
  M -->|*| Zap[generic outbound webhook → Zapier/n8n]
```

Durability: Redis can vanish and nothing is lost — events wait in Postgres. Adding a channel = one `kind → deliverer` branch, zero feature-code changes.
