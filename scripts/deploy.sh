#!/usr/bin/env bash
# Glisten Timecard — guarded deploy.
#
# THE GUARDRAIL: this script refuses to ship a working tree that is dirty or
# not pushed. That is deliberate. On 2026-05-14 a session built the CPR
# manager feature, deployed it to prod, and never committed it — production
# ran code that existed nowhere in git. The next clean redeploy would have
# silently regressed Dr. Dawood's live payroll UI. This script makes that
# class of mistake structurally impossible: prod can only ever run a commit
# that is on origin/main.
#
# Usage: bash scripts/deploy.sh
set -euo pipefail

SSH_HOST="holocron-do"
PROD_DIR="/srv/glisten-timecard"
PUBLIC_URL="https://timecard.glistendentalstudio.com"
BRANCH="main"

red()   { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
info()  { printf '\033[2m%s\033[0m\n' "$1"; }

cd "$(dirname "$0")/.."

# ── GUARD 1: on the right branch ───────────────────────────────────────────
cur_branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$cur_branch" != "$BRANCH" ]; then
  red "ABORT: on '$cur_branch', not '$BRANCH'. Deploys ship from $BRANCH only."
  exit 1
fi

# ── GUARD 2: clean working tree ────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  red "ABORT: working tree is dirty. Commit (or stash) before deploying."
  info "Production must only ever run a committed, pushed SHA."
  git status --short
  exit 1
fi

# ── GUARD 3: nothing unpushed ──────────────────────────────────────────────
git fetch origin "$BRANCH" --quiet
ahead="$(git rev-list --count "origin/$BRANCH..HEAD")"
if [ "$ahead" != "0" ]; then
  red "ABORT: $ahead local commit(s) not on origin/$BRANCH. Push first."
  git log --oneline "origin/$BRANCH..HEAD"
  exit 1
fi

SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"
green "Guards passed. Deploying $SHORT_SHA (== origin/$BRANCH)."

# ── BUILD ──────────────────────────────────────────────────────────────────
info "Building server + web..."
npm run build

# ── PACKAGE ────────────────────────────────────────────────────────────────
TARBALL="/tmp/timecard-deploy-$SHORT_SHA.tar.gz"
tar czf "$TARBALL" server/dist server/package.json web/dist
info "Packaged $TARBALL"
scp -q "$TARBALL" "$SSH_HOST:/tmp/"

# ── SHIP ───────────────────────────────────────────────────────────────────
# pm2 path resolved dynamically so an nvm version bump can't break deploys
# (see reference_droplet_ssh_nvm_path.md). Snapshot dist before overwrite so
# rollback is one mv. Stamp the live SHA so any future session can verify
# prod == a pushed commit (closes the detection side of the guardrail).
ssh "$SSH_HOST" "
  set -euo pipefail
  cd $PROD_DIR
  TS=\$(date +%Y%m%d-%H%M%S)
  [ -d server/dist ] && mv server/dist server/dist.bak.\$TS
  [ -d web/dist ]    && mv web/dist    web/dist.bak.\$TS
  rm -rf /tmp/tc-stage && mkdir /tmp/tc-stage && cd /tmp/tc-stage
  tar xzf /tmp/timecard-deploy-$SHORT_SHA.tar.gz
  cp -r server/dist $PROD_DIR/server/
  cp -r web/dist    $PROD_DIR/web/
  echo $SHA > $PROD_DIR/DEPLOYED_SHA
  PM2=\$(ls -d /home/holocron/.nvm/versions/node/*/bin/pm2 2>/dev/null | tail -1)
  \"\$PM2\" restart glisten-timecard --update-env
  sleep 2
  \"\$PM2\" status glisten-timecard | tail -3
"

# ── VERIFY ─────────────────────────────────────────────────────────────────
info "Verifying live deploy..."
sleep 2
health="$(curl -sf -m 10 "$PUBLIC_URL/api/health" || true)"
echo "$health" | grep -q '"db":"connected"' \
  && green "health OK: $health" \
  || { red "health check FAILED: $health"; red "Rollback: see reference_glisten_timecard_deploy.md"; exit 1; }

live_sha="$(ssh "$SSH_HOST" "cat $PROD_DIR/DEPLOYED_SHA" 2>/dev/null || true)"
if [ "$live_sha" = "$SHA" ]; then
  green "Prod now live on $SHORT_SHA (verified, == origin/$BRANCH)."
else
  red "WARNING: DEPLOYED_SHA on prod ($live_sha) != $SHA. Investigate."
  exit 1
fi

bash scripts/smoke.sh "$PUBLIC_URL" || { red "Smoke failed against prod."; exit 1; }
green "Deploy complete."
