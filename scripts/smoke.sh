#!/usr/bin/env bash
# Glisten Timecard smoke test — proves a fresh deploy is live + responsive.
# Hits public-only endpoints; never modifies state.
#
# Usage: bash scripts/smoke.sh [BASE_URL]
# Default: http://localhost:3001
set -euo pipefail

BASE="${1:-http://localhost:3001}"
PASS=0
FAIL=0

red()    { printf '\033[31m%s\033[0m' "$1"; }
green()  { printf '\033[32m%s\033[0m' "$1"; }
dim()    { printf '\033[2m%s\033[0m' "$1"; }

check() {
  local label="$1"; shift
  local cmd="$*"
  printf '  %s ' "$label"
  if eval "$cmd" >/dev/null 2>&1; then
    green '✓'; echo
    PASS=$((PASS+1))
  else
    red '✗'; echo
    FAIL=$((FAIL+1))
  fi
}

echo
echo "Glisten Timecard smoke — $BASE"
echo

# 1. /health is 200 with db connected
check "health endpoint reports db connected" \
  "curl -fs '$BASE/health' | grep -q '\"db\":\"connected\"'"

# 2. Frontend serves index.html
check "frontend index.html served" \
  "curl -fs '$BASE/' | grep -qi 'glisten timecard'"

# 3. Manager login rejects bad credentials
check "manager login rejects bad password" \
  "curl -fs -o /dev/null -w '%{http_code}' -X POST '$BASE/manage/login' \
    -H 'content-type: application/json' \
    -d '{\"email\":\"nobody@example.com\",\"password\":\"wrongwrong\"}' | grep -q 401"

# 4. Manager endpoints require auth
check "manager today requires auth" \
  "curl -fs -o /dev/null -w '%{http_code}' '$BASE/manage/today' | grep -q 401"

# 5. Kiosk lookup rejects malformed PIN
check "kiosk lookup rejects malformed PIN" \
  "curl -fs -o /dev/null -w '%{http_code}' -X POST '$BASE/kiosk/lookup' \
    -H 'content-type: application/json' \
    -d '{\"pin\":\"abc\"}' | grep -q 400"

# 6. Kiosk punch requires geofence coords
check "kiosk punch rejects missing coords" \
  "curl -fs -o /dev/null -w '%{http_code}' -X POST '$BASE/kiosk/punch' \
    -H 'content-type: application/json' \
    -d '{\"pin\":\"1111\",\"type\":\"clock_in\"}' | grep -q 400"

# 7. Manifest reachable (PWA install)
check "PWA manifest served" \
  "curl -fs '$BASE/manifest.webmanifest' | grep -q 'Glisten'"

# 8. Favicon served
check "favicon.svg served" \
  "curl -fs -o /dev/null -w '%{http_code}' '$BASE/favicon.svg' | grep -q 200"

echo
if [ "$FAIL" -eq 0 ]; then
  green "  $PASS passed, 0 failed"; echo
  exit 0
else
  red "  $PASS passed, $FAIL failed"; echo
  exit 1
fi
