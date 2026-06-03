#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-sweep-init.log

# Variant-list spec: three explicit param combos, command template prints val_loss=<lr>.
cat > "$tmpdir/sweep-variants.json" <<'JSON'
{
  "name": "lr-list",
  "command_template": "printf 'val_loss={lr}\\n'",
  "variants": [
    {"lr": 0.50},
    {"lr": 0.30},
    {"lr": 0.10}
  ]
}
JSON

# Dry-run should print all variants and not record runs.
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-variants.json" --metric val_loss --direction lower --dry-run >/tmp/autoresearch-sweep-dry.log
grep -q "variants: 3" /tmp/autoresearch-sweep-dry.log
grep -q "dry-run: no runs executed" /tmp/autoresearch-sweep-dry.log
if [ -f "$tmpdir/.researchloop/scratchpad/runs.jsonl" ]; then
  if grep -q "lr-list" "$tmpdir/.researchloop/scratchpad/runs.jsonl" 2>/dev/null; then
    echo "dry-run should not record runs"
    exit 1
  fi
fi

# Real sweep run.
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-variants.json" --metric val_loss --direction lower >/tmp/autoresearch-sweep-run.log
grep -q "sweep: lr-list" /tmp/autoresearch-sweep-run.log
grep -q "completed: 3/3" /tmp/autoresearch-sweep-run.log
grep -q "scored: 3" /tmp/autoresearch-sweep-run.log
grep -q 'val_loss=0.1' /tmp/autoresearch-sweep-run.log
# Best should be lr=0.10 (lowest val_loss).
grep -q '"lr":0.1' /tmp/autoresearch-sweep-run.log
test -f "$tmpdir/.researchloop/scratchpad/runs.jsonl"
grep -q '"sweep":"lr-list"' "$tmpdir/.researchloop/scratchpad/runs.jsonl" || \
  grep -q 'sweep:lr-list' "$tmpdir/.researchloop/scratchpad/runs.jsonl"

# Grid spec: 2x2 cross product = 4 variants.
cat > "$tmpdir/sweep-grid.json" <<'JSON'
{
  "name": "grid",
  "command_template": "printf 'accuracy={hidden}\\n'",
  "grid": {
    "lr": [0.001, 0.01],
    "hidden": [128, 256]
  }
}
JSON

"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-grid.json" --metric accuracy --direction higher >/tmp/autoresearch-sweep-grid.log
grep -q "variants: 4" /tmp/autoresearch-sweep-grid.log
grep -q "completed: 4/4" /tmp/autoresearch-sweep-grid.log

# Summary file should exist.
test -d "$tmpdir/.researchloop/scratchpad/sweeps"

# Bad spec is rejected.
echo "{ this is not json" > "$tmpdir/sweep-bad.json"
set +e
"${cli[@]}" sweep --dir "$tmpdir" --spec "$tmpdir/sweep-bad.json" >/tmp/autoresearch-sweep-bad.log 2>&1
bad_exit=$?
set -e
if [ "$bad_exit" -eq 0 ]; then
  echo "expected invalid sweep spec to exit nonzero"
  exit 1
fi
grep -q "sweep spec" /tmp/autoresearch-sweep-bad.log

echo "autoresearch test:sweep passed"
