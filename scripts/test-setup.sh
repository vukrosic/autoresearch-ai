#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_blank="$(mktemp -d)"
tmp_fixture="$(mktemp -d)"
trap 'rm -rf "$tmp_blank" "$tmp_fixture"' EXIT

node "$repo_root/bin/researchloop.js" init --agent codex --dir "$tmp_blank" >/tmp/researchloop-setup-init.log
node "$repo_root/bin/researchloop.js" inspect --dir "$tmp_blank" >/tmp/researchloop-setup-inspect.log
node "$repo_root/bin/researchloop.js" prompt --goal "improve validation loss" >/tmp/researchloop-setup-prompt.log
node "$repo_root/bin/researchloop.js" doctor --dir "$tmp_blank" >/tmp/researchloop-setup-doctor.log
node "$repo_root/bin/researchloop.js" record --dir "$tmp_blank" --id setup-blank-001 --status complete --metric val_loss=1.23 --metric tokens_seen=8 --note "blank repo setup smoke" >/tmp/researchloop-setup-record.log
node "$repo_root/bin/researchloop.js" report --dir "$tmp_blank" >/tmp/researchloop-setup-report.log

cp -R "$repo_root/examples/fixtures/minimal-pytorch/." "$tmp_fixture/"
node "$repo_root/bin/researchloop.js" init --agent codex --dir "$tmp_fixture" >/tmp/researchloop-fixture-init.log
node "$repo_root/bin/researchloop.js" inspect --dir "$tmp_fixture" >/tmp/researchloop-fixture-inspect.log
node "$repo_root/bin/researchloop.js" prompt --goal "reduce validation loss" >/tmp/researchloop-fixture-prompt.log

test -f "$tmp_blank/.researchloop/AGENTS.md"
test -f "$tmp_blank/.researchloop/baseline.md"
test -f "$tmp_blank/.researchloop/goal.md"
test -f "$tmp_blank/.researchloop/plan.md"
test -f "$tmp_blank/.researchloop/scratchpad/runs.jsonl"
test -f "$tmp_blank/AGENTS.md"
test -f "$tmp_fixture/.researchloop/repo-profile.json"

grep -q "Detected adapters: generic" /tmp/researchloop-setup-init.log
grep -q "improve validation loss" /tmp/researchloop-setup-prompt.log
grep -q "Recorded run: setup-blank-001" /tmp/researchloop-setup-record.log
grep -q "runs: 1" /tmp/researchloop-setup-report.log
grep -q '"pytorch"' /tmp/researchloop-fixture-inspect.log
grep -q "train.py" /tmp/researchloop-fixture-inspect.log

echo "autoresearch test:setup passed"
