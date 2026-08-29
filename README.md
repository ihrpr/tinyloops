# Tinyloops

Baby tracker at [tinyloops.app](https://tinyloops.app): feeds, sleep, nappies
and pumping, logged in seconds and shared with your partner. Your data lives
in a Google Sheet in **your own Drive** — export it, open it, delete it any
time; the server stores only account and encrypted Google tokens.

## Architecture

One Cloudflare Worker serves both the React SPA (built from `web/` with Vite
into `dist/`) and the API (`server/`, [Hono](https://hono.dev)):

- **`/auth/*`** — Google sign-in (authorization-code flow). The refresh token
  is stored AES-GCM-encrypted in D1; sessions are httpOnly cookies with a
  rolling ~90-day expiry. Sign in once per device.
- **`/api/*`** — render-ready JSON per view. All logic lives server-side; the
  React client renders and collects input. Writes return a fresh home payload
  so the UI updates in one round trip. Charts use [Recharts](https://recharts.org).
- **D1** (`schema.sql`) — `users` and `sessions` only. Baby data never
  touches our database.
- **The sheet** — tabs `Log` + `Settings`, datetimes as native serial
  numbers (see `server/time.js`; never strings). The spreadsheet is a
  stable contract: anything else reading or writing it keeps working.

Open `/?demo` (or `/?demo&tab=stats`) for a sample-data preview without
signing in.

Two deliberate tradeoffs, written down so they aren't rediscovered later:

- **The API returns display-shaped payloads** (labels, "Today", composed
  strings) for this one client. A future native widget or a second locale
  needs semantic fields — add a dedicated endpoint then rather than
  reshaping these.
- **Every request reads the whole Log tab**, so latency grows with history
  (~11k rows/year). Fine for a long while; the fix when needed is a tail
  window for `/api/home` (see `fetchState` in `server/sheets.js`).

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars   # fill in (see below)
npm run db:local                 # create the local D1 tables

# two dev options:
npm run dev:worker               # Worker on :8787 serving the built dist/ (run `npm run build` first)
# — or, for fast client iteration with HMR —
npm run dev:worker &             # API/auth on :8787
npm run dev:web                  # Vite dev server on :5173, proxies /api + /auth to :8787

npm run build                    # Vite → dist/ (what the Worker serves)
npm test                         # unit tests: time format, view logic, validation, crypto, sheet writes
npm run test:e2e                 # Playwright smoke: builds, boots the Worker, checks the demo views render
npm run lint                     # ESLint (server + React client)
npm run check                    # lint + tests (run before pushing)
```

Demo mode works with dummy `.dev.vars` values. For real sign-in locally you
need, in the Google Cloud console (APIs & Services → Credentials):

- OAuth client: add redirect URI `http://localhost:8787/auth/callback` and
  JS origin `http://localhost:8787`
- the OAuth client **secret** in `.dev.vars` (code flow is server-side)
- `TOKEN_ENC_KEY` from `openssl rand -base64 32`
