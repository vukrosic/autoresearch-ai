# Testing

This folder defines the setup and onboarding tests for AutoResearch-AI.

The goal is to prove that a new user can:

1. install the package
2. initialize the harness
3. inspect the repo
4. generate a prompt
5. check the environment
6. record a run
7. produce a report

## Test Types

- `setup` - blank repo install/init flow
- `fixture` - minimal ML repo shape with `train.py`
- `llm-kit` - the real local `llm-research-kit` adapter and MPS sanity check

## Commands

- `npm run smoke`
- `npm run smoke:e2e`
- `npm run test:setup`
- `npm run test:prompts`
- `npm run test:site`

## What We Measure

- Did the package install?
- Did the harness files get created?
- Did repo inspection identify the right adapter?
- Did the prompt mention the actual goal?
- Did the ledger accept a structured record?
- Did the report summarize runs correctly?
