# Site Test Plan

Purpose:

Make sure the public landing page still says the right things.

## Commands

```bash
npm run test:site
```

## Checks

- The title still names AutoResearch-AI.
- The install command is visible.
- The page says it is MacBook-tested.
- The page mentions the open source core.
- The page points people toward the real first-run commands.

## Why It Matters

This site is part of the product funnel. If it drifts away from the actual CLI, people will land in the wrong mental model.
