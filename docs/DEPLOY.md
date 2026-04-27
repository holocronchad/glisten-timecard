# Glisten Timecard — deploy runbook

This is the only doc you need to take a fresh droplet from zero to a live
kiosk at `https://timecard.glistendental.com`.

Time budget on a clean DO droplet with Postgres + nginx already running:
**about 25 minutes**, the slowest step is DNS propagation.

---

## 0. What you need before you start

- SSH to the Holocron DO droplet (already running PM2 + nginx + Postgres)
- The Holocron Postgres connection string
- A 64-char random string for `JWT_SECRET` (generate with `openssl rand -hex 32`)
- Owner passwords for Anas + Dr. Dawood (these go into `password_hash`)
- Cloudflare access for `glistendental.com` (DNS record)
- Repo: https://github.com/holocronchad/glisten-timecard

---

## 1. Provision the droplet directory

```bash
ssh root@<droplet>
mkdir -p /srv/glisten-timecard
cd /srv/glisten-timecard
git clone https://github.com/holocronchad/glisten-timecard.git .
npm install
```

---

## 2. Configure environment

```bash
cp .env.example .env
nano .env
```

Required values:

| Var | Value |
|---|---|
| `PORT` | `3001` (do **not** collide with Holocron) |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Holocron Postgres URL — schema is isolated, same DB is fine |
| `DB_SCHEMA` | `timeclock` |
| `JWT_SECRET` | output of `openssl rand -hex 32` — must differ from Holocron's |
| `SEED_ANAS_PASSWORD` | a strong password (you can rotate later) |
| `SEED_DAWOOD_PASSWORD` | same |

Confirm: `cat .env | grep -E '^(PORT|JWT_SECRET|DATABASE_URL)='`

---

## 3. Build server + web

```bash
npm run build
```

Produces `server/dist/` and `web/dist/`. Both must succeed.

---

## 4. Run the migration

```bash
node server/dist/scripts/migrate.js
```

This creates the `timeclock` schema if it doesn't exist and applies
`migrations/001_initial.sql`. Idempotent — re-running is safe.

Verify:

```bash
psql "$DATABASE_URL" -c "\dt timeclock.*"
```

You should see `locations`, `users`, `punches`, `audit_log`,
`missed_punch_requests`, `schema_versions`.

---

## 5. Seed offices + first users

```bash
SEED_ANAS_PASSWORD=... SEED_DAWOOD_PASSWORD=... \
  node server/dist/scripts/seed.js
```

Inserts the 3 Glisten offices (Gilbert, Mesa, Glendale) with real
geocoded coordinates + 150m geofence, Annie Simmons (PIN `1111`), and
both owners.

Verify:

```bash
psql "$DATABASE_URL" -c "SELECT name, lat, lng FROM timeclock.locations"
psql "$DATABASE_URL" -c "SELECT name, role, is_owner FROM timeclock.users"
```

---

## 6. Boot under PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 logs glisten-timecard --lines 30
```

You should see `[glisten-timecard] listening on :3001 (production)`
and `[autoClose] scheduling cron: 59 6 * * * (America/Phoenix)`.

---

## 7. Wire nginx → :3001

Add to `/etc/nginx/sites-available/glisten-timecard.conf`:

```nginx
server {
  listen 80;
  server_name timecard.glistendental.com;

  # Static frontend
  root /srv/glisten-timecard/web/dist;
  index index.html;

  # API
  location ~ ^/(kiosk|manage|health) {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/glisten-timecard.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## 8. DNS + TLS

In Cloudflare (`glistendental.com` zone):

- Type: **A**
- Name: `timecard`
- Value: droplet IP
- Proxy status: **DNS only** (orange cloud OFF — we want certbot to grab a real cert; flip back on later if you want CF caching)
- TTL: Auto

```bash
certbot --nginx -d timecard.glistendental.com
```

Certbot updates the nginx config in place. Reload:

```bash
systemctl reload nginx
```

---

## 9. Smoke test

From your laptop:

```bash
bash scripts/smoke.sh https://timecard.glistendental.com
```

Expected output: all green checks.

Manual sanity check from the **front-desk PC inside an office**:

1. Open `https://timecard.glistendental.com` in Chrome
2. Click PIN `1111` → "Good morning, Annie"
3. Click "Clock in" → success
4. Repeat from your laptop **off-site** → "You're not at a Glisten office"
5. Open `/manage`, log in as Anas → see Annie's punch under Today

---

## 10. Pin to the front-desk PC

On each office's front-desk computer:
1. Chrome → `https://timecard.glistendental.com`
2. Three-dot menu → Cast/save/share → **Install Glisten Timecard** (or use the install icon in the URL bar)
3. The PWA window opens fullscreen, no browser chrome — same effect as a kiosk app
4. Pin the resulting shortcut to the desktop / taskbar so the front desk launches it without typing

For employees who want it on their phone, point them at `/me` —
they Add to Home Screen from their browser's share sheet.

---

## Common fixes

| Symptom | Fix |
|---|---|
| `pm2 logs` shows `Missing required env var: JWT_SECRET` | `.env` not loaded — `pm2 restart glisten-timecard --update-env` after fixing |
| `/health` returns 200 but kiosk says "Connection failed" | nginx proxy block missing — re-check step 7 |
| All punches flagged "outside office" | Verify lat/lng with `SELECT * FROM timeclock.locations`; bump `geofence_m` if browser GPS is jittery (front-desk PCs without GPS hardware fall back to WiFi positioning) |
| Auto-close cron firing twice | More than one PM2 instance — `ecosystem.config.js` should be `instances: 1, exec_mode: 'fork'` |
| Manager login 401 with correct password | Owner record missing `password_hash` — re-run seed with `SEED_*_PASSWORD` set |

---

## Where things live

- **App code**: `/srv/glisten-timecard/`
- **Logs**: `/var/log/pm2/glisten-timecard.{out,err}.log`
- **DB**: shared Holocron Postgres, schema `timeclock`
- **PM2 process**: `glisten-timecard`
- **Daily auto-close**: 23:59 AZ (06:59 UTC) cron in `server/src/jobs/autoClose.ts`
- **Daily PM2 restart**: 13:59 UTC (in `ecosystem.config.js`)

Rollback: `DROP SCHEMA timeclock CASCADE` + `pm2 delete glisten-timecard`.
Holocron is untouched.
