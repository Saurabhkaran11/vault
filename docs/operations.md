# Operations

## Backups

Two scripts in `backend/scripts/`, and the second matters more than the first.

```bash
# take a dump (and upload it, if BACKUP_BUCKET is set)
DATABASE_URL=postgresql://... BACKUP_BUCKET=my-vault-backups ./scripts/backup.sh

# prove the newest dump actually restores
DATABASE_URL=postgresql://... BACKUP_BUCKET=my-vault-backups ./scripts/restore-check.sh
```

`backup.sh` writes a compressed custom-format dump (`pg_dump -Fc`, restorable
selectively and in parallel), uploads it under a date-stamped key, and prunes
anything older than `RETAIN_DAYS`.

`restore-check.sh` pulls the newest dump, restores it into a throwaway
database, and asserts the tables exist, hold rows, and carry an Alembic
revision. **Run it on a schedule.** The failure that hurts is not "we had no
backups", it is "the backups were never going to restore" — and you only find
out on the day you need one.

Verified locally end to end: a dump of the dev database restored into a
scratch database with 21 items, 14 tasks and 16 expenses intact at schema
revision `367fc5c8d10c`.

### Client/server version skew

`pg_dump` refuses to dump a server newer than itself, which is how a backup
job silently stops working after a database upgrade. `backup.sh` checks the
versions up front and fails with the fix rather than a bare error:

```bash
docker run --rm -e DATABASE_URL -v $PWD:/w -w /w postgres:16 bash scripts/backup.sh
```

Pin that image to your server's major version.

### Recommended schedule

| What | When | Why |
|---|---|---|
| `backup.sh` | daily | RPO of one day; tighten with WAL archiving / PITR if that is too much to lose |
| `restore-check.sh` | weekly | the only thing that turns a backup into a guarantee |
| Managed snapshots (RDS) | continuous | belt and braces; independent of these scripts |

S3 lifecycle rules are a more reliable retention mechanism than the pruning
loop in the script, because they keep working when the script does not run.

## File storage

Uploaded document bytes go to S3 via presigned URLs — the API signs, the
browser transfers, so bytes never pass through the app servers.

```
S3_BUCKET=vault-user-files
S3_REGION=us-east-1
# omit the keys on AWS to use the instance role
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

Unset `S3_BUCKET` and the app keeps file bodies in the browser, exactly as
before; `GET /files/status` is what the frontend asks so it can say so
honestly instead of failing at upload time.

Keys are `u/{user_id}/{item_id}/{filename}`, so per-account access is a
prefix check rather than a lookup, and a crafted filename cannot escape its
owner's prefix. Only a small allowlist of content types is served inline —
everything else downloads as an attachment, so an uploaded `.html` cannot
execute in the vault's origin.

**The bucket must not be public.** Access is entirely via short-lived
presigned URLs (15 minutes by default).

## Health checks

| Endpoint | Use |
|---|---|
| `/health/live` | liveness. Dependency-free on purpose: a database blip must not make the orchestrator kill healthy processes |
| `/health/ready` | readiness. Checks Postgres and Redis, and names whichever is down |
| `/health` | the frontend's simple reachability probe |

Point your load balancer at `/health/ready` and your container runtime's
liveness probe at `/health/live`.

## Logs

JSON, one object per line, on stdout. Every line carries `request_id`, which
also comes back to the caller as the `X-Request-Id` header — so a user
quoting an error id gives you something to grep for. Unhandled errors log a
full traceback server-side and return only that id.
