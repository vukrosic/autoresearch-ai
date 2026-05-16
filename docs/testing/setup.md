# Setup Test Plan

## Scenario 1 - Blank Repo

Create a temporary empty repo and run:

```bash
autoresearch init --agent codex
autoresearch inspect
autoresearch prompt --goal "improve validation loss"
autoresearch doctor
autoresearch record --id setup-001 --status complete --metric val_loss=1.23 --note "blank repo setup smoke"
autoresearch report
```

Expected:

- harness files exist
- adapter defaults to `generic`
- prompt is emitted
- doctor prints the local environment
- record appends to `runs.jsonl`
- report shows one run

## Scenario 2 - Minimal ML Fixture

Create a repo with `train.py`, `pyproject.toml`, and a log folder, then run `autoresearch inspect`.

Expected:

- `pytorch` adapter is detected
- train file is listed
- config files are detected

## Scenario 3 - Real Local LLM Repo

Run the same flow against `/Users/vukrosic/my-life/research-repos/llm-research-kit`.

Expected:

- `generic`, `pytorch`, `huggingface`, and `llm-research-kit` adapters are detected
- `doctor` confirms MPS on this Mac
- a tiny synthetic training loop can run when we want a real product proof

## Why This Matters

The first failure mode of startup software is not model quality. It is setup friction. The setup tests should stay fast and simple enough to run often.
