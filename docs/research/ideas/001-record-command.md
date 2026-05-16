# Idea 001 - Add `autoresearch record`

Status: shipped in the local repo.

## Hypothesis

Users will trust the tool more if it can append a structured run result without requiring manual JSONL editing.

## Command

```bash
autoresearch record \
  --id mac-e2e-002 \
  --status complete \
  --metric val_loss=4.4157 \
  --metric tokens_seen=128 \
  --note "Tiny Mac smoke loop"
```

## Why It Matters

The harness currently creates a run ledger, but recording is still manual. A first-class command makes the loop feel more like a product and less like a folder template.

## Kill Criteria

Do not build a large experiment runner yet. If `record` turns into a full orchestration framework, stop and reduce it.
