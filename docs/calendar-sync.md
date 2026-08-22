# Calendar sync — design and plan (bug-list #4)

**Status:** design ready; blocked on external OAuth setup only you can do (see
[What I need from you](#what-i-need-from-you)).

## What exists today

One-way `.ics` works end to end and is not going away:

- `frontend/lib/ics.js` — `buildICS()` / `downloadICS()` export your to-dos
  and saved events as a standard `.ics`; `parseICS()` / `importICSFile()`
  import an `.ics` into `vault.calendar.v1`.
- `frontend/components/TodoCalendar.jsx` — week / month / year views.
- Settings shows the imported-event count.

That covers "move dates in and out of Vault". It does **not** keep Vault and
your Google/Apple calendars *continuously in step* — that's what #4 adds.

## Requirements

**Functional**
- Connect a Google account and/or an Apple calendar.
- **Pull:** external events appear in the Vault calendar.
- **Push:** to-dos with a due date (and Vault events) appear on the external
  calendar, and edits/deletes propagate.
- Survive token expiry without the user re-connecting each time.

**Non-functional**
- Local-first stays true: a disconnected Vault keeps working; sync is additive.
- No third-party sees more than the calendar scope. Tokens never touch the
  browser bundle or `localStorage`.
- Free-tier friendly (fits the existing Neon + Render + Upstash stack).

## Why this can't be "just built" now

- **Google Calendar API** requires *your* Google Cloud project: an OAuth
  client (ID + secret), a configured consent screen, and — because calendar
  access is a sensitive scope — **Google app verification**, which takes days
  to weeks. There is no way to test the flow without that client.
- **Apple** has no public Calendar REST API. Web integration means **CalDAV**
  with an app-specific password, or nothing. (Native EventKit is iOS/macOS
  only and irrelevant to a web app.)
- Both need a **server-side token store** — refresh tokens must live on the
  backend, never in the browser.

So the honest deliverable right now is this plan plus the exact inputs needed;
speculative OAuth code that can't be run would be dead weight.

## Architecture

```
Browser (local-first)                 Backend (FastAPI)              Provider
─────────────────────                 ─────────────────              ────────
TodoCalendar / Vault  ──connect──▶  /calendar/google/authorize ──▶ Google consent
                       ◀─redirect──  /calendar/google/callback  ◀── code
                                     store refresh token (encrypted, Postgres)
to-do due-date change ──mirror────▶  /calendar/push  ─────────────▶ Calendar API
                       ◀─pull (ARQ)  worker: periodic + webhook  ◀── events / push
Vault calendar view   ◀────────────  /calendar/events (merged)
```

- **Auth:** OAuth 2.0 Authorization Code + refresh token for Google; CalDAV
  basic auth (app-specific password) for Apple. The browser only ever starts
  the flow and reads merged events — it never holds a provider token.
- **Token store:** a `calendar_accounts` table (below). Refresh tokens
  encrypted at rest (Fernet/KMS); the app already has a config seam for secrets.
- **Sync engine:** an ARQ worker job (the queue already exists) does the
  periodic pull; Google *push notifications* (watch channels) can later make
  pull near-real-time. Push-to-provider is fired from the same mirror path
  to-dos already use.
- **Conflict rule:** last-writer-wins keyed on `updated` timestamp, with the
  Vault copy winning ties (the user is editing here). Each synced event
  carries the provider's `etag`/`id` so we update rather than duplicate.

## Data model

```sql
CREATE TABLE calendar_accounts (
  id             uuid PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users(id),
  provider       text NOT NULL,            -- 'google' | 'caldav'
  external_email text,
  access_token   bytea,                    -- encrypted
  refresh_token  bytea,                    -- encrypted
  token_expiry   timestamptz,
  caldav_url     text,                     -- Apple/CalDAV only
  sync_token     text,                     -- provider incremental cursor
  created_at     timestamptz DEFAULT now(),
  UNIQUE (user_id, provider, external_email)
);

CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY,
  account_id   uuid REFERENCES calendar_accounts(id) ON DELETE CASCADE,
  external_id  text,                       -- provider event id
  etag         text,
  source       text NOT NULL,              -- 'vault' | 'external'
  vault_ref    text,                       -- client id of the to-do/event, if ours
  title        text, starts_at timestamptz, ends_at timestamptz, all_day bool,
  updated_at   timestamptz,
  UNIQUE (account_id, external_id)
);
```

## API (new router `backend/app/routers/calendar.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/calendar/google/authorize` | Start OAuth; returns the consent URL |
| GET  | `/calendar/google/callback`  | Exchange code, store encrypted tokens |
| POST | `/calendar/caldav/connect`   | Store Apple CalDAV url + app password |
| GET  | `/calendar/accounts`         | List connected accounts (no tokens) |
| DELETE | `/calendar/accounts/{id}`  | Disconnect + purge tokens/events |
| GET  | `/calendar/events`           | Merged events for the calendar view |
| POST | `/calendar/push`             | Upsert a Vault item onto the provider |

## Phased plan

1. **Phase 1 — read-only Google pull.** OAuth connect, store tokens, worker
   pulls events, `TodoCalendar` shows them behind a "Google" toggle. Lowest
   scope (`calendar.readonly`), fastest verification. *This is the milestone
   that proves the whole pipeline.*
2. **Phase 2 — push.** To-dos with due dates and Vault events write to Google;
   edits/deletes propagate; conflict rule active. Needs the read/write scope.
3. **Phase 3 — Apple via CalDAV.** App-specific password connect, same
   pull/push engine over a CalDAV client.
4. **Phase 4 — near-real-time.** Google watch channels replace polling.

Estimated effort once unblocked: Phase 1 ≈ 1–2 focused sessions, Phase 2 ≈ 1,
Phase 3 ≈ 1. Google verification is calendar time, not build time.

## Security

- Refresh tokens encrypted at rest; browser never receives a provider token.
- Minimum scope per phase (`calendar.readonly` before read/write).
- Disconnect hard-deletes tokens and that account's mirrored events.
- CalDAV app-specific passwords (never the Apple ID password); stored encrypted.
- Reuses the existing auth: every endpoint is behind the same Clerk JWT guard.

## What I need from you

To start **Phase 1** I need:

1. A **Google Cloud project** with the Calendar API enabled, an **OAuth 2.0
   Web client** (I'll give you the exact redirect URI to paste), and the
   OAuth **consent screen** filled in. Add yourself as a test user so we can
   run it before Google's full verification completes.
2. The client **ID and secret**, set as backend env vars (never committed).
3. A decision: **Google first** (recommended — cleanest API), or Apple/CalDAV
   first?

Say the word and I'll build Phase 1 against your client.
