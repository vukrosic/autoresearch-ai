# AutoResearch-AI Dev Control Room

This folder is local-only.

It is the control room for developing, deploying, and testing AutoResearch-AI without mixing those assets into the published npm package.

## What belongs here

- rules for how AutoResearch-AI should be deployed and tested
- prompts for fresh onboarding agents
- skills for supervising onboarding and first-experiment runs
- tests for install, setup, dashboard, and first-run behavior
- fixtures for empty repos and sample repos
- deploy helpers for packing and installing the current local build
- transcripts and summaries from simulated user runs

## Why this exists

The published `autoresearch-ai` package should stay lean.
This folder carries the extra harness around it.

## Layout

```text
researchloop-dev/
  rules/
  prompts/
  skills/
  tests/
  fixtures/
  deploy/
  transcripts/
  summaries/
```

## Main flow

1. Pack the current local AutoResearch-AI checkout.
2. Install that tarball into the isolated test environment.
3. Point a fresh agent at a clean lab folder.
4. Give it only the onboarding prompt.
5. Save the transcript and a short summary here.

## Quick commands

Pack the current build:

```bash
./deploy/pack-current-build.sh
```

Create a clean lab folder:

```bash
./deploy/create-lab.sh
```

## Agent prompt

The default first prompt is stored in [`prompts/onboarding.md`](./prompts/onboarding.md).
