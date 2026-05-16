# Prompt Template Test Plan

Purpose:

Make sure the generated prompt stays clean and the focus overlays still work.

## Commands

```bash
npm run test:prompts
```

## Checks

- `autoresearch` prompt includes the goal and the durable working-memory instructions.
- the prompt includes the repo-memory and experiment-history instructions.
- the prompt includes realistic time-band guidance.
- the prompt includes exactly one upfront time-budget question when missing.
- the prompt includes the target-selection fallback wording.
- the focus overlays still append cleanly.
- the training-ladder mode is available as a focus overlay.
- No prompt contains the raw `{{GOAL}}` placeholder.

## Why It Matters

Prompt drift is the kind of bug that quietly breaks the product without breaking the CLI. This test keeps the packaging honest.
