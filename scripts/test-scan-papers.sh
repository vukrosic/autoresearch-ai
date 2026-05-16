#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
cache_dir="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$cache_dir"' EXIT

cli="node $repo_root/bin/researchloop.js"
export RESEARCHLOOP_ARXIV_FIXTURE="$repo_root/examples/fixtures/arxiv-sample.xml"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-scan-init.log
$cli goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-scan-goal.log

$cli scan-papers --dir "$tmpdir" --cache-dir "$cache_dir" --limit 5 >/tmp/researchloop-scan-default.log
grep -q "found: 2" /tmp/researchloop-scan-default.log
grep -q "2503.12345v1" /tmp/researchloop-scan-default.log
grep -q "2504.67890v2" /tmp/researchloop-scan-default.log
grep -q "all:lower validation loss" /tmp/researchloop-scan-default.log

test -f "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
test -f "$tmpdir/.researchloop/scratchpad/papers/2504.67890v2.md"
grep -q "Efficient Learning Rate Schedules" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "Alice Researcher" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "Bob Scientist" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "Published: 2026-03-15" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "cosine decay" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "How to port this" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"

grep -q "scan-papers" "$tmpdir/.researchloop/scratchpad/THREAD.md"

$cli scan-papers --dir "$tmpdir" --cache-dir "$cache_dir" --query "all:attention" --limit 3 >/tmp/researchloop-scan-explicit.log
grep -q "query: all:attention" /tmp/researchloop-scan-explicit.log
grep -q "found: 2" /tmp/researchloop-scan-explicit.log

$cli scan-papers --dir "$tmpdir" --cache-dir "$cache_dir" --since 2026-04 --limit 5 >/tmp/researchloop-scan-since.log
grep -q "found: 1" /tmp/researchloop-scan-since.log
grep -q "2504.67890v2" /tmp/researchloop-scan-since.log

unset RESEARCHLOOP_ARXIV_FIXTURE
set +e
$cli scan-papers --dir "$tmpdir" --cache-dir "$(mktemp -d)" --query "all:offlinemiss" --offline >/tmp/researchloop-scan-offline.log 2>&1
offline_exit=$?
set -e
if [ "$offline_exit" -eq 0 ]; then
  echo "expected offline cache miss to exit nonzero"
  exit 1
fi
grep -q "offline mode" /tmp/researchloop-scan-offline.log

echo "autoresearch test:scan-papers passed"
