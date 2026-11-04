# Vault — everything, one place

A personal knowledge & life hub: **notes, YouTube saves, reading library, documents, to-dos, Jira-style boards with sprints, and personal finance** — every item date-stamped, linked by project tags, visualized in a live force-directed graph, and summarized on an analytics dashboard with per-feature reports.

**Status:** Next.js frontend that runs on its own with data in the browser. An optional FastAPI + PostgreSQL backend adds accounts and sync — see [`docs/`](docs/) for the system design.

![wireframe](docs/wireframes.md)

## The product in 60 seconds

| Area | What it does |
|---|---|
| **Quick capture** (`C`) | One box that files anything: a YouTube URL → video, `coffee $4.50` → expense, `call the bank tomorrow ⚑` → to-do, `#tags` inline, Google Doc/Sheet links → Documents |
| **Dashboard** | Daily activity strip with streak, weekly bars, collection donut, spend-by-category, most-used-feature ranking, per-feature insight cards, AI weekly digest |
| **Notes** | Apple-Notes-style: block editor (headings, todos, tables, images, sub-pages), insert-anywhere, folders, pins, templates, Read/Edit views, movable date stamps |
| **YouTube** | Save + watch inside the app (S/M/L/theater), watched-queue tracking |
| **Library** | Books/PDFs with reading progress, linked resources per book |
| **Documents** | Upload files (PDF/img/text/audio/video preview inline, resizable + fullscreen viewer), link cloud files (Google Docs/Sheets/Drive/OneDrive/Notion), written docs with block editor |
| **To-dos** | Smart list (Overdue/Today/Upcoming/Someday), natural-language quick-add, Day/Week/Month/Year + calendar views, `.ics` import from Google/Apple Calendar |
| **Boards** | Custom kanbans with Jira-style task keys (`FVB-1`), labels, detail modal (Read/Edit), **sprints** with roll-over, hours-to-complete, per-sprint CSV export |
| **Finance** | Expenses with categories & **payment methods**, recurring bills, budgets, savings goals, income & savings rate, multi-currency, analytics (bar/line/area/donut × day/week/month/year), CSV export |
| **Graph** | Live force simulation of tags ↔ items; drag, zoom, search; scale-tested to 800+ items |
| **Tags** | Directory of every project tag + create standalone custom tags |
| **AI (BYO key)** | Claude (Anthropic) **or a listed provider** (Ollama, LM Studio, OpenAI, Gemini, Mistral, DeepSeek, Groq, Together, OpenRouter). Your key stays in tab memory, is never saved and clears on reload: Ask-your-Vault RAG with citations, weekly digest, note summaries, action-item extraction, finance smart-add |
| **Reports** | Self-contained printable HTML report per feature (or the full vault) |
| **Production details** | First-run onboarding (sample data vs clean start), notification bell + desktop alerts, `.ics` export, PWA manifest, WCAG AA contrast, dark mode, fully rebindable keyboard shortcuts, click-again destructive confirms, 30-day trash |

## Run it

```bash
cd frontend
npm install
npm run dev   # http://localhost:3100
```

Data lives in `localStorage` (versioned schemas: `vault.items.v1`, `vault.todos.v1`, `vault.finance.v1`, `vault.boards.v1`, `vault.tags.v1`, `vault.keys.v1` for shortcuts, `vault.ai.v1` for AI settings but never API keys) with one-click JSON export/import.

## Repo layout

```
frontend/   Next.js 16 app — the product
backend/    FastAPI + PostgreSQL(pgvector) + Redis — optional
docs/       Wireframes + per-feature system design documents
```

## Deploy

**Frontend only (simplest):** Vercel with root directory `frontend`. No settings are required. Data stays in each visitor's browser and visitors bring their own AI key.

**With accounts and sync:** also run `backend/` on Render or any Docker host with Postgres (pgvector) and Redis. The owner sets these. Details are in [`docs/runbook.md`](docs/runbook.md).

- Frontend: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, optional `NEXT_PUBLIC_SENTRY_DSN`
- Backend: `DATABASE_URL`, `REDIS_URL`, `AUTH_MODE=jwt`, `JWT_ISSUER`, `JWT_JWKS_URL`, `CORS_ORIGINS`. Optional: S3 storage, Google calendar, Sentry and embeddings

`CHAT_URL` and `CHAT_API_KEY` only work in `AUTH_MODE=dev`, which is local only. A public deployment never answers with a server AI key.

## Roadmap

FastAPI backend (per-feature APIs → pgvector RAG → Redis event bus for notifications/digests) → AWS (App Runner/ECS + RDS + ElastiCache + S3 + SES). See [`docs/backend-architecture.md`](docs/backend-architecture.md).
