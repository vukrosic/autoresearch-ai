#!/usr/bin/env bash
set -e
cd /Users/vukrosic/my-life/autoresearch-ai

echo "=== Test G28 topic command ==="

FIXTURE=$(mktemp -d)
trap "rm -rf $FIXTURE" EXIT

mkdir -p "$FIXTURE/.researchloop"

# Create a complete baseline.md
cat > "$FIXTURE/.researchloop/baseline.md" << 'EOF'
# Baseline

## What To Record

- Baseline artifact: artifacts/baseline_run/model.pt
- Metric: val_loss
- Direction: lower
- Command or config: python train.py --epochs 100

## Frozen Surfaces

- Dataset: ./data/train.txt
- Model size: 124M params
- Seed: 42

## Notes

Baseline established 2026-05-17.
EOF

echo "--- Test 1: topic with complete baseline ---"
OUT1=$(node bin/researchloop.js topic "attention mechanisms" --dir "$FIXTURE" 2>&1)
echo "$OUT1"
echo "$OUT1" | grep -q "Baseline State" || { echo "FAIL: missing baseline section"; exit 1; }
echo "$OUT1" | grep -q "complete" || { echo "FAIL: should show complete baseline"; exit 1; }
echo "$OUT1" | grep -q "Needs approval" || { echo "FAIL: should include approval line"; exit 1; }
echo "$OUT1" | grep -q "propose" || { echo "FAIL: should show propose mode"; exit 1; }
echo "$OUT1" | grep -q "novel" || { echo "FAIL: should show novel mode"; exit 1; }
echo "$OUT1" | grep -q "autonomous" || { echo "FAIL: should show autonomous mode"; exit 1; }

echo "--- Test 2: topic with --write ---"
OUT2=$(node bin/researchloop.js topic "lr scheduling" --write --dir "$FIXTURE" 2>&1)
echo "$OUT2"
echo "$OUT2" | grep -q "Topic note written" || { echo "FAIL: --write should confirm"; exit 1; }
test -f "$FIXTURE/.researchloop/scratchpad/topics/lr-scheduling.md" || { echo "FAIL: topic file not created"; exit 1; }

echo "--- Test 3: topic missing baseline ---"
FIXTURE2=$(mktemp -d)
mkdir -p "$FIXTURE2/.researchloop"
OUT3=$(node bin/researchloop.js topic "whatever" --dir "$FIXTURE2" 2>&1)
echo "$OUT3"
echo "$OUT3" | grep -q "missing" || { echo "FAIL: should show missing baseline"; exit 1; }
rm -rf "$FIXTURE2"

echo "--- Test 4: topic --mode autonomous without lock ---"
OUT4=$(node bin/researchloop.js topic "test" --mode autonomous --dir "$FIXTURE" 2>&1; echo "exit: $?")
echo "$OUT4"
echo "$OUT4" | grep -q "requires a locked baseline" || { echo "FAIL: autonomous without lock should error"; exit 1; }

echo "--- Test 5: topic with prior runs ---"
mkdir -p "$FIXTURE/.researchloop/scratchpad/papers"
cat > "$FIXTURE/.researchloop/scratchpad/papers/2504.11111v1.md" << 'EOF'
# Attention Routing for Transformers

- Paper id: 2504.11111v1
- Source: local
- Published: 2026-05-01
- Authors: Reviewer One
- Link: https://arxiv.org/abs/2504.11111v1

## Claim

Attention routing reduces wasted compute.

## Mechanism

The mechanism is attention sparsity.

## Limits

This is architecture-specific.

## How To Port This

Change attention masking in the model.

## Baseline Relevance

This targets lower validation loss with a small change to attention.
EOF

cat > "$FIXTURE/.researchloop/scratchpad/runs.jsonl" << 'EOF'
{"id":"r1","status":"completed","value":0.42,"metrics":{"val_loss":0.42},"params":{"attention":"sparse"},"note":"attention routing baseline"}
{"id":"r2","status":"completed","value":0.31,"metrics":{"val_loss":0.31},"params":{"optimizer":"adam"},"note":"baseline comparison"}
EOF
OUT5=$(node bin/researchloop.js topic "scaling" --dir "$FIXTURE" 2>&1)
echo "$OUT5"
echo "$OUT5" | grep -q "Prior runs: 2" || { echo "FAIL: should count prior runs"; exit 1; }
echo "$OUT5" | grep -q "Best run: r2" || { echo "FAIL: should show best run by metric"; exit 1; }

echo "--- Test 6: topic with matching evidence ---"
OUT6=$(node bin/researchloop.js topic "attention routing" --dir "$FIXTURE" 2>&1)
echo "$OUT6"
echo "$OUT6" | grep -q "Relevant Evidence" || { echo "FAIL: should show relevant evidence"; exit 1; }
echo "$OUT6" | grep -q "paper:2504.11111v1" || { echo "FAIL: should surface matching paper"; exit 1; }
echo "$OUT6" | grep -q "run:r1" || { echo "FAIL: should surface matching run"; exit 1; }
echo "$OUT6" | grep -q "autoresearch paper-read 2504.11111v1 --write" || { echo "FAIL: should suggest paper-read"; exit 1; }
echo "$OUT6" | grep -q "autoresearch hypothesis --paper-id 2504.11111v1 --write" || { echo "FAIL: should suggest paper-backed hypothesis"; exit 1; }
echo "$OUT6" | grep -q "autoresearch hypothesis --run-id r1 --write" || { echo "FAIL: should suggest run-backed hypothesis"; exit 1; }

echo "--- Test 7: topic --mode propose ---"
OUT7=$(node bin/researchloop.js topic "test" --mode propose --dir "$FIXTURE" 2>&1)
echo "$OUT7"
echo "$OUT7" | grep -q "Mode: propose" || { echo "FAIL: mode should be propose"; exit 1; }

echo "--- Test 8: topic with --mode novel ---"
OUT8=$(node bin/researchloop.js topic "transformer scaling" --mode novel --dir "$FIXTURE" 2>&1)
echo "$OUT8"
echo "$OUT8" | grep -q "Mode: novel" || { echo "FAIL: mode should be novel"; exit 1; }

echo "=== All G28 topic tests passed ==="
