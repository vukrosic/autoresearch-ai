#!/usr/bin/env bash
# Smoke test: every dispatched command should exit cleanly when invoked
# with no args in an empty repo — friendly usage error is fine, but an
# uncaught TypeError / ReferenceError / SyntaxError / undefined-access
# is a real bug (the dispatch silently routed to a broken handler).

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="node $repo_root/bin/researchloop.js"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# Commands skipped because they legitimately start long-running work
# (servers, real training, real sweeps) before they'd hit a usage error.
SKIP=(
  dashboard       # localhost server, runs forever
  run             # would shell out to whatever --command resolves to
  baseline        # same as run
  loop            # iterates --command
  smoke           # runs a child --command
  sweep           # sweep run launches workers
)

is_skipped() {
  local needle="$1"
  for s in "${SKIP[@]}"; do
    [ "$s" = "$needle" ] && return 0
  done
  return 1
}

# Crash patterns — these are JS runtime errors that mean the handler
# is broken, distinct from a clean "missing required arg" exit.
CRASH_RE='TypeError|ReferenceError|SyntaxError|is not a function|is not defined|Cannot read prop|Cannot read properties|Cannot destructure|Cannot convert undefined'

run_one() {
  local cmd="$1"
  local out
  # 8 second wall-clock guard via perl alarm — portable across linux/mac.
  out=$(perl -e 'alarm 8; exec @ARGV or die "exec failed: $!"' \
        -- node "$repo_root/bin/researchloop.js" "$cmd" --dir "$tmpdir" 2>&1 || true)
  if echo "$out" | grep -qE "$CRASH_RE"; then
    echo "FAIL: \`$cmd\` crashed with a runtime error:"
    echo "----"
    echo "$out" | head -25
    echo "----"
    return 1
  fi
  return 0
}

# Enumerate canonical command names from --list-commands --format json.
# macOS ships bash 3.2 (no mapfile), so collect into a newline-separated file.
list_file="$tmpdir/.commands.txt"
$cli --list-commands --format json \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{JSON.parse(s).forEach(x=>console.log(x.canonical))})' \
  > "$list_file"

total=$(wc -l < "$list_file" | tr -d ' ')
if [ "$total" -lt 50 ]; then
  echo "expected >= 50 commands in registry, got $total"
  exit 1
fi

failures=0
checked=0
skipped=0

while IFS= read -r cmd; do
  [ -z "$cmd" ] && continue
  if is_skipped "$cmd"; then
    skipped=$((skipped + 1))
    continue
  fi
  checked=$((checked + 1))
  if ! run_one "$cmd"; then
    failures=$((failures + 1))
  fi
done < "$list_file"

echo "checked $checked commands (skipped $skipped); $failures crash failure(s)"

if [ "$failures" -gt 0 ]; then
  exit 1
fi
