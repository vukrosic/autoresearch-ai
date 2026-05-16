#!/usr/bin/env bash
set -euo pipefail

tmp_repo="$(mktemp -d)"
trap 'rm -rf "$tmp_repo"' EXIT

node ./bin/researchloop.js init --agent codex --dir "$tmp_repo" >/tmp/researchloop-team-init.log
node ./bin/researchloop.js team --dir "$tmp_repo" --workers 6 >/tmp/researchloop-team.log

test -f "$tmp_repo/.researchloop/team/README.md"
test -f "$tmp_repo/.researchloop/team/orchestrator.md"
test -f "$tmp_repo/.researchloop/team/reviewer.md"
test -f "$tmp_repo/.researchloop/team/board.md"
test -f "$tmp_repo/.researchloop/team/summary.md"
test -f "$tmp_repo/.researchloop/team/setup.sh"
test -f "$tmp_repo/.researchloop/team/workers/01-cli-runtime.md"
test -f "$tmp_repo/.researchloop/team/workers/02-dashboard.md"
test -f "$tmp_repo/.researchloop/team/workers/03-prompts-skills.md"
test -f "$tmp_repo/.researchloop/team/workers/04-docs-onboarding.md"
test -f "$tmp_repo/.researchloop/team/workers/05-tests-ci.md"
test -f "$tmp_repo/.researchloop/team/workers/06-release-publishing.md"

grep -q "AutoResearch-AI development team written" /tmp/researchloop-team.log
grep -q "workers: 6" /tmp/researchloop-team.log
grep -q "orchestrator" "$tmp_repo/.researchloop/team/README.md"
grep -q "human: release direction and final merge gate" "$tmp_repo/.researchloop/team/summary.md"
grep -q "CLI and runtime" "$tmp_repo/.researchloop/team/board.md"
grep -q "Dashboard and state API" "$tmp_repo/.researchloop/team/workers/02-dashboard.md"
grep -q "git worktree add -b codex/autoresearch-cli-runtime" "$tmp_repo/.researchloop/team/setup.sh"

echo "autoresearch test:team passed"
