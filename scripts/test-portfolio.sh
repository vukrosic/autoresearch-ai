#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node ./bin/researchloop.js)

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-portfolio-init.log
"${cli[@]}" goal --dir "$tmpdir" "optimize Apple Silicon operator benchmark latency" \
  --metric latency_ms \
  --direction lower \
  --baseline "python bench.py --backend cpu" \
  --evaluation "python bench.py --backend mlx" >/tmp/autoresearch-portfolio-goal.log

"${cli[@]}" record --dir "$tmpdir" --id baseline-cpu --status complete \
  --metric latency_ms=1.25 \
  --metric throughput=100 \
  --note "CPU baseline" >/tmp/autoresearch-portfolio-record-a.log

"${cli[@]}" record --dir "$tmpdir" --id candidate-mlx --status complete \
  --metric latency_ms=0.74 \
  --metric throughput=132 \
  --note "MLX candidate" >/tmp/autoresearch-portfolio-record-b.log

"${cli[@]}" metric-tiers init --dir "$tmpdir" --profile hpc_operator >/tmp/autoresearch-portfolio-tiers.log
"${cli[@]}" report --dir "$tmpdir" --format markdown --out .researchloop/scratchpad/dashboard-report.md >/tmp/autoresearch-portfolio-report.log
"${cli[@]}" portfolio --dir "$tmpdir" --out .researchloop/scratchpad/portfolio-report.md >/tmp/autoresearch-portfolio.log

portfolio="$tmpdir/.researchloop/scratchpad/portfolio-report.md"
test -f "$portfolio"
test -f "$tmpdir/.researchloop/env/environment.md"
test -f "$tmpdir/.researchloop/env/environment.json"

grep -q "AutoResearch-AI Portfolio Evidence" "$portfolio"
grep -q "candidate-mlx" "$portfolio"
grep -q "Environment Readiness" "$portfolio"
grep -q "Dashboard experiment report" "$portfolio"
grep -q "Verify the current best run" "$portfolio"

echo "autoresearch test:portfolio passed"
