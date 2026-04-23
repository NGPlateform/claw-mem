#!/usr/bin/env bash
# claw-mem e2e happy path — sketched in the integration plan.
#
# Requires:
#   - hardhat installed in the COC repo (`npm install` under contracts/)
#   - jq, sqlite3, curl available on $PATH
#
# Not yet wired into CI — once contract deployment in `bootstrap dev`
# step 10 lands, drop this in .github/workflows/ and run on a runner with
# hardhat preinstalled.

set -euo pipefail

CLAW_MEM_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$HOME/.claw-mem}"

cd "$CLAW_MEM_DIR"

echo "=== preflight ==="
rm -rf "$DATA_DIR"
pkill -f "hardhat node"   2>/dev/null || true
pkill -f "coc-node\.pid"  2>/dev/null || true

npm install --no-audit --no-fund --silent
npm run typecheck
npm test

echo "=== bootstrap dev ==="
time bin/claw-mem bootstrap dev --hardhat-port 8545 --skip-first-backup

echo "=== node status ==="
bin/claw-mem node status dev-1 --json | jq '.running, .blockHeight'

echo "=== quota reservation ==="
test -f "$DATA_DIR/.quota.reserved"
test "$(stat -c%s "$DATA_DIR/.quota.reserved")" -eq 268435456

echo "=== mem search (after we plant a row) ==="
sqlite3 "$DATA_DIR/claw-mem.db" "INSERT INTO sessions (session_id, agent_id, started_at, started_at_epoch, status) VALUES ('e2e-session','e2e-agent','$(date -Iseconds)',$(date +%s),'active')"
sqlite3 "$DATA_DIR/claw-mem.db" "INSERT INTO observations (session_id,agent_id,type,title,facts,narrative,concepts,files_read,files_modified,prompt_number,token_estimate,content_hash,created_at,created_at_epoch) VALUES ('e2e-session','e2e-agent','discovery','bootstrap worked','[\"hardhat started on 8545\"]',null,'[]','[]','[]',0,10,'h1','$(date -Iseconds)',$(date +%s))"
bin/claw-mem mem search "bootstrap" --limit 5 --json | jq '.count'

echo "=== teardown ==="
bin/claw-mem bootstrap teardown --yes

echo "=== final cleanup ==="
rm -rf "$DATA_DIR"

echo "E2E PASSED"
