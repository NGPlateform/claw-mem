#!/usr/bin/env bash
# Verify Q2: each per-(channel,user) MEMORY.md contains its own unique marker
# and contains NO marker that belongs to a different (channel, user) tuple.
#
# Reads the demo root from $CLAW_MEM_POC_ROOT (set by poc-demo.ts) or the
# first CLI arg. Exits non-zero on any cross-pollution.
#
# Usage:
#   CLAW_MEM_POC_ROOT=/tmp/foo ./verify-no-cross-pollution.sh
#   ./verify-no-cross-pollution.sh /tmp/foo

set -euo pipefail

ROOT="${1:-${CLAW_MEM_POC_ROOT:-}}"
if [ -z "$ROOT" ]; then
  echo "ERROR: pass root dir as arg or set CLAW_MEM_POC_ROOT" >&2
  exit 2
fi
if [ ! -d "$ROOT/memories/channels" ]; then
  echo "ERROR: $ROOT/memories/channels does not exist — did poc-demo.ts run?" >&2
  exit 2
fi

# (channel, user, expected-marker) tuples MUST stay in sync with poc-demo.ts.
# Format: "channel:user:marker"
declare -a EXPECT=(
  "telegram:user-a:MARKER-TG-A-PG"
  "telegram:user-b:MARKER-TG-B-DENO"
  "slack:user-a:MARKER-SLACK-A-RUST"
  "slack:user-b:MARKER-SLACK-B-PYTHON"
)

fail=0
echo "── verify-no-cross-pollution ──"
echo "root: $ROOT"
echo

for tuple in "${EXPECT[@]}"; do
  IFS=":" read -r ch user marker <<<"$tuple"
  file="$ROOT/memories/channels/$ch/users/$user/MEMORY.md"

  if [ ! -f "$file" ]; then
    echo "✗ MISSING $file"
    fail=$((fail + 1))
    continue
  fi

  # Own marker must appear.
  if ! grep -qF "$marker" "$file"; then
    echo "✗ $ch/$user: own marker $marker NOT found in MEMORY.md"
    fail=$((fail + 1))
    continue
  fi

  # All OTHER tuples' markers must NOT appear.
  for other in "${EXPECT[@]}"; do
    [ "$other" = "$tuple" ] && continue
    IFS=":" read -r _ _ other_marker <<<"$other"
    if grep -qF "$other_marker" "$file"; then
      echo "✗ $ch/$user: LEAKED $other_marker (from another user)"
      fail=$((fail + 1))
    fi
  done

  if [ "$fail" -eq 0 ]; then
    echo "✓ $ch/$user: clean (own marker present, no leaks)"
  fi
done

echo
if [ "$fail" -eq 0 ]; then
  echo "Q2 → PASS ✅  4 disjoint MEMORY.md, no cross-pollution"
  exit 0
else
  echo "Q2 → FAIL ✗  $fail violations"
  exit 1
fi
