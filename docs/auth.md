# Authentication

Vault is local-first, and that shapes the whole design: with no identity
provider configured it runs exactly as it always has — no accounts, no
sign-in wall, everything in the browser. Authentication is something you
switch on, not something the app depends on to start.

Turning it on is two coordinated changes, frontend and backend. Doing only
one leaves you worse off than doing neither, so the order below matters.

## What each side does

| | Without auth | With auth |
|---|---|---|
| Frontend | sends `X-User-Id: <whatever is typed in Settings>` | sends `Authorization: Bearer <Clerk session JWT>` |
| Backend | `AUTH_MODE=dev` — trusts that header | `AUTH_MODE=jwt` — verifies signature, issuer, expiry against the JWKS, uses `sub` |
| Identity | a string anyone could type | a verified account |

The backend **refuses to boot** in `dev` mode once `CORS_ORIGINS` names a
non-localhost origin. That interlock exists so an unauthenticated backend
cannot reach the internet because someone forgot a variable — you cannot
deploy publicly without completing the switch.

## Switching it on

### 1. Create a Clerk application

At [dashboard.clerk.com](https://dashboard.clerk.com), create an application
and copy its **Publishable key** (`pk_…`) and **Secret key** (`sk_…`).

Your instance domain is embedded in the publishable key and looks like
`your-app-12.clerk.accounts.dev`. You need it for the backend below.

### 2. Frontend

`frontend/.env.local`:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

That is the whole frontend change. The app detects the key and mounts
`ClerkProvider`, gates the UI behind sign-in, and starts sending bearer
tokens — see "How it hangs together" below.

### 3. Backend

```
AUTH_MODE=jwt
JWT_ISSUER=https://your-app-12.clerk.accounts.dev
JWT_JWKS_URL=https://your-app-12.clerk.accounts.dev/.well-known/jwks.json
# JWT_AUDIENCE=      # optional — leave unset unless you configured one
```

Restart the API. It will now reject any request without a valid token, and
`X-User-Id` stops meaning anything.

### 4. Existing data

User ids change. Rows synced under `demo` (or whatever you typed) stay
attached to that string, while your signed-in account is a Clerk id like
`user_2abc…`. The simplest migration for a personal vault is to sync fresh:
sign in, then **Settings → Backend sync → Sync everything again**, which
pushes the browser's copy up under the new identity.

To keep the old rows instead, re-point them once in SQL:

```sql
UPDATE items SET user_id = 'user_2abc...' WHERE user_id = 'demo';
-- repeat for tasks, boards, expenses, bills, incomes, pay_methods,
-- budgets, goals, custom_tags, embeddings
```

## How it hangs together

```
lib/authConfig.js     is a key present? (build-time constant)
   │
   ├─ no  → app/layout.js renders the app directly. Nothing Clerk-related
   │        mounts; middleware.js is a pass-through; lib/api.js falls back
   │        to the X-User-Id header. This is the local-first path.
   │
   └─ yes → app/layout.js wraps everything in <ClerkProvider>
            └─ components/AuthGate.jsx
               ├─ signed out → full-page <SignIn>
               └─ signed in  → <AuthBridge> + the app
                                  │
                                  └─ hands Clerk's getToken() to lib/api.js
                                     so every request carries a fresh JWT
```

`lib/api.js` cannot call Clerk's `useAuth()` hook — it is plain module code,
not a component — so `AuthBridge` registers the *getter function* rather than
a token value. A token captured once would expire mid-session; the getter
refreshes it.

## Notes

- **Clerk Core 3** (March 2026) removed `<SignedIn>` / `<SignedOut>` in favour
  of `<Show when="signed-in">`. This code uses the current API.
- The sign-in page uses `routing="hash"`, so no extra routes are needed.
- `middleware.js` imports Clerk dynamically. Importing it at module scope
  would run Clerk's key assertions at boot and break the no-key path.
- Rate limiting keys off the token when one is present, so limits are
  per-account rather than per-IP.
