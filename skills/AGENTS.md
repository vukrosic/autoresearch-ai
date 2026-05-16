# AutoResearch-AI Skills Rules

You are editing `skills/`.

## Scope

This folder ships the agent-side instructions that mirror the AutoResearch-AI loop.

## Rules

1. Keep the skill pack aligned with the CLI and docs.
2. Update agent-specific mappings when adding or renaming skill entrypoints.
3. Keep the core research loop small and reusable.
4. Do not add a new skill surface unless it has a clear user or agent payoff.
5. Prefer separate entry files for separate agents, but keep the shared instructions identical where possible.
6. If a skill is meant to be copied into an agent-specific location, say so explicitly in `skills/README.md`.

