#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"
proposals_path="$tmpdir/.researchloop/scratchpad/proposals.jsonl"

echo "=== Test G01 propose command ==="

cp -R "$repo_root/examples/fixtures/minimal-pytorch/." "$tmpdir/"
mkdir -p "$tmpdir/.researchloop/scratchpad/papers" "$tmpdir/.researchloop/scratchpad/hypotheses"

cat > "$tmpdir/.researchloop/baseline.md" <<'EOF'
# Baseline

## What To Record

- Baseline artifact: artifacts/baseline_run/model.pt
- Metric: val_loss
- Direction: lower
- Command or config: python train.py --epochs 4

## Frozen Surfaces

- Dataset: ./data/train.txt
- Model size: tiny
- Seed: 42
EOF

$cli goal --dir "$tmpdir" "lower validation loss" --metric val_loss --direction lower --baseline "python train.py --epochs 4" --evaluation "python eval.py" >/tmp/researchloop-propose-goal.log

cat > "$tmpdir/.researchloop/repo-profile.json" <<'EOF'
{
  "candidate_train_files": ["train.py"],
  "candidate_eval_files": ["eval.py"],
  "candidate_config_files": ["pyproject.toml"]
}
EOF

: > "$tmpdir/.researchloop/scratchpad/runs.jsonl"
cp "$repo_root/examples/fixtures/hypotheses/paper-read-note.md" "$tmpdir/.researchloop/scratchpad/papers/2503.12345v1.md"
cp "$repo_root/examples/fixtures/hypotheses/sweep-note.md" "$tmpdir/.researchloop/scratchpad/papers/2509.00001v1.md"

cat > "$tmpdir/.researchloop/scratchpad/hypotheses/lr-warmup.md" <<'EOF'
# Hypothesis: Warmup stabilizes early steps

## Mechanism

learning-rate schedule

## Why This Beats Baseline

A short warmup should reduce early optimization instability without changing the model.

## Why This Might Fail

If the current instability comes from data or batch size, schedule changes will not help.

## Smallest Test

Add a 50-step warmup to `train.py` and keep the baseline otherwise frozen.

## Expected Metric Movement

val_loss should decrease slightly.

## Kill Criterion

val_loss does not improve after one baseline-sized run.

## Implementation Surface (Files / Configs)

train.py

## Evidence Source

paper:2503.12345v1
EOF

echo "--- Test 1: propose emits five grounded proposals ---"
OUT1="$($cli propose --n 5 --dir "$tmpdir")"
printf '%s\n' "$OUT1" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
required = [
    "id",
    "title",
    "hypothesis",
    "change",
    "metric",
    "expected_direction",
    "estimated_minutes",
    "est_cost_usd_or_null",
    "risk",
    "priors",
    "kill_criterion",
    "mechanism",
    "mode",
    "created_at",
    "source_type",
    "source_id",
]
assert isinstance(rows, list)
assert len(rows) == 5, len(rows)
assert any(row["source_type"] == "paper" for row in rows)
assert any(row["source_type"] == "hypothesis" for row in rows)
assert any(row["source_type"] == "generic" for row in rows)
assert any("train.py" in row["change"] for row in rows)
for row in rows:
    for key in required:
        assert key in row, key
    assert row["metric"] == "val_loss", row["metric"]
    assert row["expected_direction"] == "lower", row["expected_direction"]
print("OK: grounded proposal rows validated")
' || { echo "FAIL: proposal JSON invalid"; exit 1; }

echo "--- Test 2: propose --write is id-stable and dedupes ---"
$cli propose --n 5 --write --dir "$tmpdir" >/tmp/researchloop-propose-write-1.log
test -f "$proposals_path" || { echo "FAIL: proposals.jsonl not created"; exit 1; }
line_count_1="$(wc -l < "$proposals_path" | tr -d ' ')"
test "$line_count_1" -eq 5 || { echo "FAIL: expected 5 proposals, got $line_count_1"; exit 1; }
hash_1="$(sha256sum "$proposals_path" | awk '{print $1}')"
$cli propose --n 5 --write --dir "$tmpdir" >/tmp/researchloop-propose-write-2.log
line_count_2="$(wc -l < "$proposals_path" | tr -d ' ')"
test "$line_count_2" -eq 5 || { echo "FAIL: duplicate proposals were appended"; exit 1; }
hash_2="$(sha256sum "$proposals_path" | awk '{print $1}')"
test "$hash_1" = "$hash_2" || { echo "FAIL: proposals.jsonl changed on rerun"; exit 1; }
python3 -c '
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
assert len(rows) == 5, len(rows)
assert all("id" in row for row in rows)
assert all(row["id"].startswith("prop_") for row in rows)
print("OK: proposals.jsonl is valid NDJSON with stable ids")
' "$proposals_path"

echo "--- Test 3: novel mode keeps mechanisms and kill criteria explicit ---"
NOVEL_OUT="$($cli propose --mode novel --n 5 --dir "$tmpdir")"
printf '%s\n' "$NOVEL_OUT" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
assert isinstance(rows, list) and rows, "no novel proposals"
assert all(row["mechanism"] for row in rows)
assert all(row["kill_criterion"] for row in rows)
assert not any("sweep" in " ".join([row["title"], row["mechanism"], row["change"]]).lower() for row in rows)
print("OK: novel proposals are mechanism-first and sweep-free")
' || { echo "FAIL: novel mode validation failed"; exit 1; }

echo "--- Test 4: propose --with-priors attaches paper evidence automatically ---"
priors_fixture="$tmpdir/arxiv-propose-priors.xml"
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

WITH_PRIORS_OUT="$(RESEARCHLOOP_ARXIV_FIXTURE="$priors_fixture" $cli propose --n 5 --with-priors --prior-limit 5 --offline --cache-dir "$tmpdir/arxiv-cache" --dir "$tmpdir")"
printf '%s\n' "$WITH_PRIORS_OUT" | python3 -c '
import json, sys
rows = json.load(sys.stdin)
assert isinstance(rows, list) and rows, "no proposals"
assert any(any(prior.get("id") == "2505.00001v1" for prior in row.get("priors", [])) for row in rows), "warmup prior missing"
assert all("id" in row for row in rows)
print("OK: propose --with-priors attached arXiv evidence")
' || { echo "FAIL: propose --with-priors did not attach priors"; exit 1; }
test -f "$tmpdir/.researchloop/scratchpad/papers/2505.00001v1.md" || { echo "FAIL: prior paper note not written"; exit 1; }

echo "=== All G01 propose tests passed ==="
