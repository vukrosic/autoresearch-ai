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
  if echo "$out" | grep -qE "^Unknown command: ${cmd}$"; then
    echo "FAIL: registry command \`$cmd\` has no dispatch handler:"
    echo "----"
    echo "$out" | head -25
    echo "----"
    return 1
  fi
  if echo "$out" | grep -qE "$CRASH_RE"; then
    echo "FAIL: \`$cmd\` crashed with a runtime error:"
    echo "----"
    echo "$out" | head -25
    echo "----"
    return 1
  fi
  return 0
}

registry_file="$tmpdir/.commands.json"
help_file="$tmpdir/.help.txt"
$cli --list-commands --format json > "$registry_file"
$cli --help > "$help_file"

node - "$registry_file" <<'NODE'
const fs = require("node:fs");
const registryPath = process.argv[2];
const rows = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const canonical = new Set();
const aliases = new Map();
for (const entry of rows) {
  if (!entry || typeof entry.canonical !== "string" || !entry.canonical.trim()) {
    throw new Error("registry entry missing canonical command");
  }
  if (canonical.has(entry.canonical)) {
    throw new Error(`duplicate canonical command: ${entry.canonical}`);
  }
  canonical.add(entry.canonical);
  if (!Array.isArray(entry.aliases)) {
    throw new Error(`aliases must be an array for ${entry.canonical}`);
  }
  if (typeof entry.group !== "string" || !entry.group.trim()) {
    throw new Error(`missing group for ${entry.canonical}`);
  }
  if (typeof entry.summary !== "string" || !entry.summary.trim()) {
    throw new Error(`missing summary for ${entry.canonical}`);
  }
  for (const alias of entry.aliases) {
    if (canonical.has(alias)) {
      throw new Error(`alias collides with canonical command: ${alias}`);
    }
    if (aliases.has(alias)) {
      throw new Error(`alias ${alias} used by both ${aliases.get(alias)} and ${entry.canonical}`);
    }
    aliases.set(alias, entry.canonical);
  }
}
NODE

node - "$registry_file" "$help_file" <<'NODE'
const fs = require("node:fs");
const [registryPath, helpPath] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(registryPath, "utf8"));
const help = fs.readFileSync(helpPath, "utf8");
const missing = [];
for (const entry of rows) {
  const escaped = entry.canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`autoresearch\\s+${escaped}(\\s|$)`);
  if (!re.test(help)) missing.push(entry.canonical);
}
if (missing.length) {
  throw new Error(`help is missing registry commands: ${missing.join(", ")}`);
}
const duplicateFlagLines = [];
for (const line of help.split(/\r?\n/)) {
  if (!/^\s+autoresearch\s+/.test(line)) continue;
  const flags = [...line.matchAll(/--[A-Za-z0-9][A-Za-z0-9-]*/g)].map((m) => m[0]);
  const seen = new Set();
  const dupes = [];
  for (const flag of flags) {
    if (seen.has(flag) && !dupes.includes(flag)) dupes.push(flag);
    seen.add(flag);
  }
  if (dupes.length) duplicateFlagLines.push(`${line.trim()} (${dupes.join(", ")})`);
}
if (duplicateFlagLines.length) {
  throw new Error(`help has duplicate flags:\n${duplicateFlagLines.join("\n")}`);
}
NODE

# Enumerate canonical command names and aliases from --list-commands --format json.
# macOS ships bash 3.2 (no mapfile), so collect into a newline-separated file.
list_file="$tmpdir/.commands.txt"
node - "$registry_file" <<'NODE' > "$list_file"
const fs = require("node:fs");
const rows = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const entry of rows) {
  console.log(entry.canonical);
  for (const alias of entry.aliases) console.log(alias);
}
NODE

total=$(wc -l < "$list_file" | tr -d ' ')
if [ "$total" -lt 50 ]; then
  echo "expected >= 50 commands + aliases in registry, got $total"
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
