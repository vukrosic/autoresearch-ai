# Weights & Biases

Sources:

- [W&B runs docs](https://docs.wandb.ai/guides/runs/)
- [W&B experiments docs](https://docs.wandb.ai/guides/track/)

## What They Do

W&B treats a run as a unit of computation and gives teams a place to log metrics, configs, artifacts, sweeps, and reports.

## What To Learn

- A single run object is a clean mental model.
- Metrics plus artifacts are the right default data shape.
- Sweeps and reports are important once the baseline loop exists.
- Team visibility matters after the local loop works.

## How AutoResearch-AI Differs

- AutoResearch-AI should feel more like a harness than a dashboard.
- It should produce logs that can later export into W&B or something similar.
- The first product should work without a hosted backend.
