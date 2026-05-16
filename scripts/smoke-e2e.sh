#!/usr/bin/env bash
set -euo pipefail

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmpdir" >/tmp/researchloop-init.log
node ./bin/researchloop.js goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-goal.log
node ./bin/researchloop.js idea --dir "$tmpdir" --write >/tmp/researchloop-idea.log
node ./bin/researchloop.js inspect --dir "$tmpdir" >/tmp/researchloop-inspect.log
node ./bin/researchloop.js prompt --dir "$tmpdir" --agent codex >/tmp/researchloop-prompt.log
node ./bin/researchloop.js doctor --dir "$tmpdir" >/tmp/researchloop-doctor.log
node ./bin/researchloop.js record --dir "$tmpdir" --id smoke-001 --status complete --metric val_loss=1.23 --metric tokens_seen=128 --note "Smoke record" >/tmp/researchloop-record.log
node ./bin/researchloop.js report --dir "$tmpdir" >/tmp/researchloop-report.log

test -f "$tmpdir/.researchloop/AGENTS.md"
test -f "$tmpdir/.researchloop/goal.md"
test -f "$tmpdir/.researchloop/plan.md"
test -f "$tmpdir/.researchloop/repo-profile.json"
test -f "$tmpdir/.researchloop/scratchpad/runs.jsonl"
test -f "$tmpdir/AGENTS.md"

grep -q "Detected adapters: generic" /tmp/researchloop-init.log
grep -q "lower validation loss" /tmp/researchloop-goal.log
grep -q "Research Idea Chat" /tmp/researchloop-idea.log
grep -q "Idea chat prompt written to" /tmp/researchloop-idea.log
grep -q "lower validation loss" /tmp/researchloop-prompt.log
grep -q "Recorded run: smoke-001" /tmp/researchloop-record.log
grep -q "runs: 1" /tmp/researchloop-report.log
grep -q "complete: 1" /tmp/researchloop-report.log

echo "autoresearch smoke:e2e passed"
