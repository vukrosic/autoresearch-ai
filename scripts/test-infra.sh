#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" infra-doctor --dir "$tmpdir" --format json --write >/tmp/autoresearch-infra-doctor.json
grep -q '"aiInfra":' /tmp/autoresearch-infra-doctor.json
grep -q '"recommendedExecutionMode":' /tmp/autoresearch-infra-doctor.json
test -f "$tmpdir/.researchloop/env/environment.json"
test -f "$tmpdir/.researchloop/env/environment.md"

demo="$tmpdir/python-aiinfra-demo"
"${cli[@]}" scaffold --template python-benchmark --out "$demo" >/tmp/autoresearch-scaffold.log
test -f "$demo/bench.py"
test -f "$demo/.researchloop/repo-profile.json"
test -f "$demo/.researchloop/env/environment.md"
grep -q "python-benchmark" "$demo/.researchloop/config.yaml"

"${cli[@]}" run --dir "$demo" \
  --id py-bench \
  --command "python3 bench.py --size 2048 --repeat 5 --warmup 1" \
  --metric latency_ms \
  --direction lower \
  --timeout 30 \
  >/tmp/autoresearch-python-bench.log

grep -q "status: complete" /tmp/autoresearch-python-bench.log
grep -q "latency_ms:" /tmp/autoresearch-python-bench.log
grep -q '"latency_ms":' "$demo/.researchloop/scratchpad/runs.jsonl"
test -f "$demo/.researchloop/scratchpad/runs/py-bench/system.jsonl"

"${cli[@]}" compare --dir "$demo" --metric latency_ms --direction lower >/tmp/autoresearch-python-compare.log
grep -q "best: py-bench" /tmp/autoresearch-python-compare.log

"${cli[@]}" report --dir "$demo" --format markdown --out .researchloop/scratchpad/infra-report.md --include-plots >/tmp/autoresearch-python-report.log
test -f "$demo/.researchloop/scratchpad/infra-report.md"
grep -q "py-bench" "$demo/.researchloop/scratchpad/infra-report.md"

echo "autoresearch test:infra passed"
