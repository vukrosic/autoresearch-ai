#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/tmp/researchloop-compare-init.log
node ./bin/researchloop.js record --dir "$tmpdir" --id run-a --status complete --metric val_loss=2.50 --metric accuracy=0.71 --note "baseline" >/tmp/researchloop-compare-run-a.log
node ./bin/researchloop.js record --dir "$tmpdir" --id run-b --status complete --metric val_loss=1.90 --metric accuracy=0.75 --note "better loss" >/tmp/researchloop-compare-run-b.log
node ./bin/researchloop.js record --dir "$tmpdir" --id run-c --status complete --metric val_loss=2.10 --metric accuracy=0.80 --note "best accuracy" >/tmp/researchloop-compare-run-c.log

node ./bin/researchloop.js compare --dir "$tmpdir" >/tmp/researchloop-compare-default.log
node ./bin/researchloop.js compare --dir "$tmpdir" --metric accuracy --direction higher >/tmp/researchloop-compare-accuracy.log

grep -q "metric: val_loss" /tmp/researchloop-compare-default.log
grep -q "direction: lower" /tmp/researchloop-compare-default.log
grep -q "best: run-b = 1.9" /tmp/researchloop-compare-default.log
grep -q "worst: run-a = 2.5" /tmp/researchloop-compare-default.log

grep -q "metric: accuracy" /tmp/researchloop-compare-accuracy.log
grep -q "direction: higher" /tmp/researchloop-compare-accuracy.log
grep -q "best: run-c = 0.8" /tmp/researchloop-compare-accuracy.log
grep -q "worst: run-a = 0.71" /tmp/researchloop-compare-accuracy.log

echo "autoresearch test:compare passed"
