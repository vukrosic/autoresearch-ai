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

rm "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
$cli paper-read 2503.12345v1 --dir "$tmpdir" --from arxiv --cache-dir "$cache_dir" --write >/tmp/researchloop-paper-read.log
test -f "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "^## Claim$" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "^## Mechanism$" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "^## Limits$" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "^## How To Port This$" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "^## Baseline Relevance$" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "learning-rate schedule" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"

rm "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"

grep -q "scan-papers" "$tmpdir/.researchloop/scratchpad/THREAD.md"

priors_fixture="$tmpdir/arxiv-priors.xml"
sed '$d' "$repo_root/examples/fixtures/arxiv-sample.xml" > "$priors_fixture"
cat >> "$priors_fixture" <<'XML'
  <entry>
    <id>http://arxiv.org/abs/2505.00001v1</id>
    <updated>2026-05-01T09:30:00Z</updated>
    <published>2026-05-01T09:30:00Z</published>
    <title>Learning Rate Warmup for Stable Optimization</title>
    <summary>We study a short learning rate warmup stage that stabilizes early optimization and improves validation loss on transformer training runs.</summary>
    <author>
      <name>Dana Optimizer</name>
    </author>
  </entry>
</feed>
XML

cat > "$tmpdir/.researchloop/scratchpad/proposals.jsonl" <<'JSONL'
{"id":"proposal-warmup-1","title":"Warmup for stable training","hypothesis":"Learning rate warmup should lower validation loss on short transformer runs.","change":"Add a short learning rate warmup stage to the optimizer schedule.","metric":"val_loss","expected_direction":"lower","mechanism":"learning rate warmup","priors":[],"created_at":"2026-05-21T00:00:00Z"}
JSONL

RESEARCHLOOP_ARXIV_FIXTURE="$priors_fixture" $cli priors --proposal proposal-warmup-1 --dir "$tmpdir" --limit 5 --offline --cache-dir "$cache_dir" >/tmp/researchloop-priors.log
grep -q "priors attached to: proposal-warmup-1" /tmp/researchloop-priors.log
grep -q "warmup" /tmp/researchloop-priors.log
test -f "$tmpdir/.researchloop/scratchpad/papers/2505.00001v1.md"

priors_count="$(node -e 'const fs=require("node:fs");const file=process.argv[1];const row=JSON.parse(fs.readFileSync(file,"utf8").trim().split(/\n+/)[0]);if(!Array.isArray(row.priors)||row.priors.length===0)process.exit(1);if(new Set(row.priors.map((p)=>`${p.type}:${p.id}`)).size!==row.priors.length)process.exit(1);process.stdout.write(String(row.priors.length));' "$tmpdir/.researchloop/scratchpad/proposals.jsonl")"
RESEARCHLOOP_ARXIV_FIXTURE="$priors_fixture" $cli priors --proposal proposal-warmup-1 --dir "$tmpdir" --limit 5 --offline --cache-dir "$cache_dir" >/tmp/researchloop-priors-rerun.log
priors_count_rerun="$(node -e 'const fs=require("node:fs");const file=process.argv[1];const row=JSON.parse(fs.readFileSync(file,"utf8").trim().split(/\n+/)[0]);if(!Array.isArray(row.priors)||row.priors.length===0)process.exit(1);if(new Set(row.priors.map((p)=>`${p.type}:${p.id}`)).size!==row.priors.length)process.exit(1);process.stdout.write(String(row.priors.length));' "$tmpdir/.researchloop/scratchpad/proposals.jsonl")"
test "$priors_count_rerun" = "$priors_count"

$cli scan-papers --dir "$tmpdir" --cache-dir "$cache_dir" --query "all:attention" --limit 3 >/tmp/researchloop-scan-explicit.log
grep -q "query: all:attention" /tmp/researchloop-scan-explicit.log
grep -q "found: 2" /tmp/researchloop-scan-explicit.log

$cli scan-papers --dir "$tmpdir" --cache-dir "$cache_dir" --since 2026-04 --limit 5 >/tmp/researchloop-scan-since.log
grep -q "found: 1" /tmp/researchloop-scan-since.log
grep -q "2504.67890v2" /tmp/researchloop-scan-since.log

unset RESEARCHLOOP_ARXIV_FIXTURE
RESEARCHLOOP_OFFLINE=1 $cli paper-read 2503.12345v1 --dir "$tmpdir" --from arxiv --cache-dir "$cache_dir" --write >/tmp/researchloop-paper-read-offline.log
test -f "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
grep -q "paper note written to:" /tmp/researchloop-paper-read-offline.log

set +e
$cli scan-papers --dir "$tmpdir" --cache-dir "$(mktemp -d)" --query "all:offlinemiss" --offline >/tmp/researchloop-scan-offline.log 2>&1
offline_exit=$?
set -e
if [ "$offline_exit" -eq 0 ]; then
  echo "expected offline cache miss to exit nonzero"
  exit 1
fi
grep -q "offline mode" /tmp/researchloop-scan-offline.log

set +e
RESEARCHLOOP_OFFLINE=1 $cli paper-read 2501.00000v1 --dir "$tmpdir" --from arxiv --cache-dir "$(mktemp -d)" >/tmp/researchloop-paper-read-miss.log 2>&1
paper_read_miss_exit=$?
set -e
if [ "$paper_read_miss_exit" -eq 0 ]; then
  echo "expected paper-read offline cache miss to exit nonzero"
  exit 1
fi
grep -q "offline mode: no cached arXiv paper" /tmp/researchloop-paper-read-miss.log

echo "autoresearch test:scan-papers passed"
