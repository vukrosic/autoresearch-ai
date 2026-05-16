# AutoResearch-AI Templates Rules

You are editing `templates/`.

## Scope

These files are the source of truth for generated harness files, prompts, team boards, and scratchpad state.

## Rules

1. Treat template edits as behavior changes.
2. Keep `templates/base/`, `templates/prompts/`, and `templates/team/` consistent with each other.
3. If you change a generated file shape, update the CLI, docs, and tests that consume it.
4. Keep templates short, durable, and easy for an agent to follow.
5. Do not add ceremony that is not needed for the actual research loop.

