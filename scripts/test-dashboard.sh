#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
logfile="$(mktemp)"
pid=""

cleanup() {
  if [[ -n "$pid" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmpdir"
  rm -f "$logfile"
}
trap cleanup EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/tmp/researchloop-dashboard-init.log
node ./bin/researchloop.js goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-dashboard-goal.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-a --metric val_loss --command "printf 'val_loss=3.20\nval_loss=3.00\nval_loss=2.85\n'" >/tmp/researchloop-dashboard-run-a.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-b --metric val_loss --command "printf 'val_loss=3.10\nval_loss=2.95\nval_loss=2.70\n'" >/tmp/researchloop-dashboard-run-b.log
node ./bin/researchloop.js run --dir "$tmpdir" --id run-c --metric val_loss --command "printf 'val_loss=2.95\nval_loss=2.80\nval_loss=2.60\n'" >/tmp/researchloop-dashboard-run-c.log
node ./bin/researchloop.js run --dir "$tmpdir" --id lineage-root --metric val_loss --command "printf 'val_loss=2.40\n'" >/tmp/researchloop-dashboard-lineage-root.log
node ./bin/researchloop.js verify --dir "$tmpdir" --id lineage-root --metric val_loss --tolerance 0.001 >/tmp/researchloop-dashboard-lineage-verify.log
node ./bin/researchloop.js replay --dir "$tmpdir" lineage-root --metric val_loss --tolerance 0.001 >/tmp/researchloop-dashboard-lineage-replay.log

cat >> "$tmpdir/.researchloop/scratchpad/runs.jsonl" <<'EOF'
{"id":"diff-a","timestamp":"2026-05-17T10:11:00Z","started_at":"2026-05-17T10:10:30Z","ended_at":"2026-05-17T10:11:00Z","wall_seconds":30,"status":"completed","agent":"manual","command":"python train.py --lr 3e-4","metrics":{"val_loss":0.42,"val_acc":0.81},"params":{"lr":0.0003,"batch_size":32},"env":{"git_sha":"aaaa1111","python_version":"3.11.0","os":"macos"}}
{"id":"diff-b","timestamp":"2026-05-17T10:12:00Z","started_at":"2026-05-17T10:11:25Z","ended_at":"2026-05-17T10:12:00Z","wall_seconds":35,"status":"completed","agent":"manual","command":"python train.py --lr 1e-4","metrics":{"val_loss":0.39,"val_acc":0.83},"params":{"lr":0.0001,"batch_size":32},"env":{"git_sha":"aaaa1111","python_version":"3.11.0","os":"macos"}}
EOF

node ./bin/researchloop.js dashboard --dir "$tmpdir" --port 0 >"$logfile" 2>&1 &
pid=$!

url=""
for _ in $(seq 1 80); do
  if [[ -s "$logfile" ]]; then
    url="$(grep -o 'http://127.0.0.1:[0-9]\+' "$logfile" | tail -n 1 || true)"
    if [[ -n "$url" ]]; then
      break
    fi
  fi
  sleep 0.1
done

if [[ -z "$url" ]]; then
  echo "dashboard did not start" >&2
  cat "$logfile" >&2 || true
  exit 1
fi

state="$(curl -s "$url/api/state")"
lineage="$(curl -s "$url/api/lineage")"
diff_same="$(curl -s "$url/api/diff?a=diff-a&b=diff-a")"
diff_pair="$(curl -s "$url/api/diff?a=diff-a&b=diff-b")"
curve_a="$(curl -s "$url/api/curves?run=run-a")"
unknown_status="$(curl -s -o /tmp/researchloop-dashboard-diff-404.log -w '%{http_code}' "$url/api/diff?a=missing-a&b=missing-b")"
page="$(curl -s "$url/")"
lineage_page="$(curl -s "$url/lineage")"
diff_page="$(curl -s "$url/diff?a=diff-a&b=diff-b")"

grep -q 'AutoResearch-AI Dashboard' <<<"$page"
grep -q 'Metric dashboard' <<<"$page"
grep -q 'scatterMount' <<<"$page"
grep -q 'curveCountPill' <<<"$page"
grep -q 'curveStatusPill' <<<"$page"
grep -q 'Experiments' <<<"$page"
grep -q 'Run lineage' <<<"$page"
grep -q 'diffRunA' <<<"$diff_page"
grep -q 'lineageMount' <<<"$lineage_page"
grep -q '"primaryMetric": "val_loss"' <<<"$state"
grep -q '"traces"' <<<"$state"
grep -q '"comparison"' <<<"$state"
grep -q '"lineage"' <<<"$state"
grep -q '"run-c"' <<<"$state"
grep -q '"metric_history"' <<<"$state"
grep -q '"val_loss": \[' <<<"$state"
grep -q '3.1' <<<"$state"
grep -q '2.95' <<<"$state"
grep -q '2.7' <<<"$state"

node -e 'const payload = JSON.parse(process.argv[1]); if (payload.run_id !== "run-a") process.exit(1); if (!Array.isArray(payload.series) || payload.series.length !== 3) process.exit(1); if (!payload.series.every((p) => Number.isFinite(p.step) && Number.isFinite(p.value))) process.exit(1);' "$curve_a"
node -e 'const lineage = JSON.parse(process.argv[1]); if (!lineage || !Array.isArray(lineage.roots)) process.exit(1); const root = lineage.roots.find((node) => node.id === "lineage-root"); if (!root || !Array.isArray(root.children) || root.children.length < 2) process.exit(1); const childIds = root.children.map((child) => child.id); if (!childIds.some((id) => /^verify-lineage-root-/.test(id))) process.exit(1); if (!childIds.some((id) => /^replay-lineage-root-/.test(id))) process.exit(1);' "$lineage"
node -e 'const diff = JSON.parse(process.argv[1]); if (!diff.identical || diff.differences.length !== 0) process.exit(1);' "$diff_same"
node -e 'const diff = JSON.parse(process.argv[1]); if (diff.identical) process.exit(1); const paths = diff.differences.map((d) => d.path); if (!paths.includes("params.lr")) process.exit(1); if (!paths.includes("metrics.val_loss")) process.exit(1); if (diff.sections.params.length !== 1) process.exit(1); if (diff.sections.metrics.length < 2) process.exit(1);' "$diff_pair"
if [[ "$unknown_status" != "404" ]]; then
  echo "FAIL: diff endpoint should 404 for unknown runs"
  cat /tmp/researchloop-dashboard-diff-404.log >&2 || true
  exit 1
fi

echo "autoresearch test:dashboard passed"
