#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
cache_dir="$(mktemp -d)"
trap 'rm -rf "$tmpdir" "$cache_dir"' EXIT

cli="node $repo_root/bin/researchloop.js"
export RESEARCHLOOP_ARXIV_FIXTURE="$repo_root/examples/fixtures/arxiv-sample.xml"

# Setup
$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-pr-init.log
$cli goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-pr-goal.log

# Test 1: Read a paper by ID
$cli paper-read 2503.12345v1 --dir "$tmpdir" --cache-dir "$cache_dir" >/tmp/researchloop-pr-read1.log

# Check output
grep -q "paper-id: 2503.12345v1" /tmp/researchloop-pr-read1.log
grep -q "Efficient Learning Rate" /tmp/researchloop-pr-read1.log
grep -q "Alice Researcher" /tmp/researchloop-pr-read1.log

# Check the paper file exists with all 5 sections
paper_file="$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
test -f "$paper_file"

grep -q "## Claim" "$paper_file"
grep -q "## Mechanism" "$paper_file"
grep -q "## Limits" "$paper_file"
grep -q "## How to port this" "$paper_file"
grep -q "## Baseline relevance" "$paper_file"

# Verify Claim is non-empty (has content after the header)
grep -A1 "## Claim" "$paper_file" | grep -qv "^## Claim$"

# Verify Mechanism mentions cosine decay
grep -q "cosine decay" "$paper_file"

# Verify Baseline relevance mentions the goal
grep -q "val_loss" "$paper_file"

# Verify THREAD.md was updated
grep -q "paper-read" "$tmpdir/.researchloop/scratchpad/THREAD.md"

# Test 2: Re-run on same paper — should not error and should merge
$cli paper-read 2503.12345v1 --dir "$tmpdir" --cache-dir "$cache_dir" >/tmp/researchloop-pr-read2.log
grep -q "merged" /tmp/researchloop-pr-read2.log

# Verify no duplicate sections
section_count=$(grep -c "^## Claim" "$paper_file")
if [ "$section_count" -ne 1 ]; then
  echo "ERROR: expected 1 Claim section, got $section_count"
  exit 1
fi

# Test 3: Read second paper
$cli paper-read 2504.67890v2 --dir "$tmpdir" --cache-dir "$cache_dir" >/tmp/researchloop-pr-read3.log
grep -q "Attention Variants" /tmp/researchloop-pr-read3.log
test -f "$tmpdir/.researchloop/scratchpad/papers/2504.67890v2.md"
grep -q "## Claim" "$tmpdir/.researchloop/scratchpad/papers/2504.67890v2.md"
grep -q "## Mechanism" "$tmpdir/.researchloop/scratchpad/papers/2504.67890v2.md"

# Test 4: Offline mode with cached data should work
$cli paper-read 2503.12345v1 --dir "$tmpdir" --cache-dir "$cache_dir" --offline >/tmp/researchloop-pr-offline.log
grep -q "paper-id: 2503.12345v1" /tmp/researchloop-pr-offline.log

# Test 5: Offline mode without cache should fail
set +e
$cli paper-read 9999.99999v1 --dir "$tmpdir" --cache-dir "$(mktemp -d)" --offline >/tmp/researchloop-pr-offline-miss.log 2>&1
offline_exit=$?
set -e
if [ "$offline_exit" -eq 0 ]; then
  echo "ERROR: expected offline cache miss to exit nonzero"
  exit 1
fi
grep -q "offline" /tmp/researchloop-pr-offline-miss.log

# Test 6: Missing paper-id should fail with usage
set +e
$cli paper-read --dir "$tmpdir" >/tmp/researchloop-pr-noargs.log 2>&1
noargs_exit=$?
set -e
if [ "$noargs_exit" -eq 0 ]; then
  echo "ERROR: expected missing paper-id to exit nonzero"
  exit 1
fi
grep -q "missing" /tmp/researchloop-pr-noargs.log

echo "autoresearch test:paper-read passed"
