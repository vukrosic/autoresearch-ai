#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/tmp/researchloop-goal-init.log
node ./bin/researchloop.js goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-goal-set.log
node ./bin/researchloop.js prompt --dir "$tmpdir" --agent codex >/tmp/researchloop-goal-prompt.log
node ./bin/researchloop.js goal --dir "$tmpdir" >/tmp/researchloop-goal-show.log

grep -q "Research goal saved" /tmp/researchloop-goal-set.log
grep -q "lower validation loss" "$tmpdir/.researchloop/goal.md"
grep -q "Target Metric" "$tmpdir/.researchloop/goal.md"
grep -q "validation loss" /tmp/researchloop-goal-prompt.log
grep -q "lower validation loss" /tmp/researchloop-goal-prompt.log
grep -q "lower validation loss" /tmp/researchloop-goal-show.log

echo "autoresearch test:goal passed"
