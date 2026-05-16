# Competitors And Adjacent Projects

This folder tracks the landscape around autonomous AI research, prompt/eval tooling, and agent harnesses.

The point is not to copy them blindly. The point is to learn which parts of the workflow are already solved, which parts are missing, and where AutoResearch-AI should stay simpler.

## Main Buckets

- `prime-intellect.md` - durable autonomous research harness and scratchpad discipline.
- `promptfoo.md` - prompt/model/agent evals, red teaming, CI, and local private testing.
- `langsmith.md` - eval types, annotation queues, heuristic checks, and online/offline measurement.
- `wandb.md` - run tracking, artifacts, sweeps, reports, and project dashboards.
- `openhands.md` - broader agent runtime, local GUI, SDK, and hosted/cloud split.
- `swe-agent.md` - issue-to-fix coding agent and benchmark-first framing.
- `adjacent-autoresearch.md` - the wider autoresearch ecosystem and skill-first loop tools.

## What We Learn

- Keep the first product a plain CLI plus files, not a giant platform.
- Make runs first-class and structured.
- Support both local experimentation and later hosted collaboration.
- Keep the loop visible in files so agents can recover after context loss.
- Make onboarding/test/setup a product surface, not just an internal convenience.
