#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-paper-reread-init.log
$cli goal --dir "$tmpdir" "lower validation loss" \
  --metric val_loss --direction lower \
  --baseline "python train.py --epochs 100" \
  --evaluation "python eval.py" \
  >/tmp/researchloop-paper-reread-goal.log

mkdir -p "$tmpdir/.researchloop/scratchpad/papers"
cp "$repo_root/examples/fixtures/hypotheses/paper-read-note.md" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"

cat > "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"baseline-001","status":"complete","tags":["baseline"],"metrics":{"val_loss":0.50},"command":"python train.py --epochs 100","params":{"warmup_steps":0,"schedule":"constant"}}
{"id":"warmup-001","status":"complete","metrics":{"val_loss":0.42},"command":"python train.py --epochs 100 --warmup 1000 --schedule cosine","params":{"warmup_steps":1000,"schedule":"cosine","lr":0.001},"note":"warmup plus cosine decay"}
EOF

echo "=== Test paper-reread ==="

OUT1="$($cli paper-reread 2503.12345v1 --against warmup-001 --dir "$tmpdir" 2>&1)"
echo "$OUT1"
grep -q "Paper reread:" <<<"$OUT1" || { echo "FAIL: missing paper reread title"; exit 1; }
grep -q "Verdict: supports" <<<"$OUT1" || { echo "FAIL: expected supports verdict"; exit 1; }
grep -q "warmup" <<<"$OUT1" || { echo "FAIL: expected warmup cue"; exit 1; }
grep -q "baseline-001" <<<"$OUT1" || { echo "FAIL: expected baseline comparison"; exit 1; }
grep -q "delta -0.08" <<<"$OUT1" || { echo "FAIL: expected metric delta"; exit 1; }

OUT2="$($cli paper-reread 2503.12345v1 --against warmup-001 --write --dir "$tmpdir" 2>&1)"
echo "$OUT2"
grep -q "paper reread written to:" <<<"$OUT2" || { echo "FAIL: expected write confirmation"; exit 1; }
test -f "$tmpdir/.researchloop/scratchpad/paper-rereads/2503.12345v1-against-warmup-001.md" || { echo "FAIL: reread note not written"; exit 1; }
grep -q "^## Alignment$" "$tmpdir/.researchloop/scratchpad/paper-rereads/2503.12345v1-against-warmup-001.md"
grep -q "^## Next Step$" "$tmpdir/.researchloop/scratchpad/paper-rereads/2503.12345v1-against-warmup-001.md"

set +e
$cli paper-reread 2503.12345v1 --against missing-run --dir "$tmpdir" >/tmp/researchloop-paper-reread-missing.log 2>&1
missing_exit=$?
set -e
if [ "$missing_exit" -eq 0 ]; then
  echo "expected missing run to fail"
  exit 1
fi
grep -q "no run found" /tmp/researchloop-paper-reread-missing.log

echo "autoresearch test:paper-reread passed"
