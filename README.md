# Glisten Timecard

[![ci](https://github.com/holocronchad/glisten-timecard/actions/workflows/ci.yml/badge.svg)](https://github.com/holocronchad/glisten-timecard/actions/workflows/ci.yml)

A time-clock app built for Glisten Dental — a 3-office practice in
Arizona. Cinematic kiosk surface for staff, utility-grade dashboard for
managers. Runs as a single Node process alongside the rest of the
practice's infrastructure, isolated by Postgres schema.

## Three surfaces

**Kiosk** — `/`
4-digit PIN → name reveal in Instrument Serif italic → action button
(Clock in / out / lunch start / end) → confirmation. Runs on the
front-desk PC in fullscreen Chrome at each office. Geofenced to the
office GPS coordinates, with a "I forgot to punch earlier" escape hatch
that routes to the manager queue.

**Personal** — `/me`
Employee's own phone — also doubles as a punch surface when staff aren't
at the front desk. PIN → 14-day punch history, weekly + period totals,
per-day breakdown. Read-only.

**Manager** — `/manage`
Email + password. Tabs: Today (live status), Missed (approve/deny
forgotten-punch requests), Pay period (bi-weekly nav with W2 OT split
and CSV export), Punches (last 500, click any row to edit with
audit-logged reason), Staff (owner-only).

## Stack

| Layer | Choice |
|---|---|
| Server | Node 22, Express 5, TypeScript, pg |
| Auth | bcrypt for PINs (with brute-force lockout), JWT for managers |
| DB | Postgres, isolated `timeclock` schema, 5 tables |
| Cron | node-cron, gated to NODE_APP_INSTANCE=0 |
| Web | React 18, Vite, Tailwind, framer-motion, react-router |
| Type | Almarai (sans, weights 300/400/700/800), Instrument Serif (italic) |
| Palette | `#DEDBC8` cream on `#0A0A0A` ink, fractal-noise overlay |

## Repo layout

```
migrations/         SQL — applied via server/src/scripts/migrate.ts
server/             API + cron + auth + payroll services
  src/
    routes/         /kiosk, /manage, /health
    services/       punches, hours, payPeriod, payroll, geofence
    auth/           pin (bcrypt + lockout), jwt, middleware
    jobs/           autoClose (daily 23:59 AZ)
    scripts/        migrate, seed
web/                React kiosk + dashboard + personal view
  src/
    kiosk/          PinPad, NameReveal, Confirmation, MissedPunchModal
    me/             Personal view (employee self-service)
    manage/         Login + Today/Missed/Period/Punches/Staff
    shared/         api client, geo helpers, hours math
docs/DEPLOY.md      Step-by-step runbook (zero → live in ~25 min)
scripts/smoke.sh    8-check post-deploy probe
ecosystem.config.js PM2 config (single fork, daily restart)
```

## Local development

```bash
npm install
cp .env.example .env       # fill DATABASE_URL + JWT_SECRET
node server/dist/scripts/migrate.js
SEED_ANAS_PASSWORD=... node server/dist/scripts/seed.js
npm run dev                # server on :3001, web on :5173 with proxy
```

## Production deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md). Short version:

```bash
git clone … && cd glisten-timecard
npm install && npm run build
node server/dist/scripts/migrate.js
SEED_ANAS_PASSWORD=… node server/dist/scripts/seed.js
pm2 start ecosystem.config.js
# nginx reverse proxy for /kiosk, /manage, /health → :3001
# certbot for HTTPS, Cloudflare A record for the subdomain
bash scripts/smoke.sh https://timecard.glistendental.com
```

## Design choices worth noting

- **One database, one schema, zero foreign keys to the host app.**
  Rollback is `DROP SCHEMA timeclock CASCADE`; the rest of the practice's
  infrastructure is untouched.
- **PIN-only at the kiosk, JWT only for managers.** No persistent kiosk
  session — every action submits PIN + lat/lng, so a tablet left at the
  front desk can't be hijacked.
- **Auto-close cron caps at the wall-clock time**, never writes a future
  punch. Closed shifts are flagged for manager review.
- **All "today" boundaries use America/Phoenix.** Pay periods anchor on
  a known date; bi-weekly math survives DST because Arizona doesn't
  observe it.
- **Audit-log every manager edit.** Every punch change records actor +
  before-state JSON + after-state JSON + a required reason string.
- **Tool-call shape stays identical between server and web.** The
  `services/hours.ts` and `shared/hours.ts` files are the same algorithm
  in two languages, kept in sync by hand — chosen over a shared package
  to keep the build dead simple.

## Status

Initial beta sprint: feature-complete for an at-office kiosk + manager
dashboard. The first real employee (Annie Simmons) has PIN `1111` after
seeding. Next gates: 2-week observation with real punches, then a
broader rollout across the 3 offices.
