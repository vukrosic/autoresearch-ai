# AutoResearch-AI Onboarding Tester

## Purpose

Test AutoResearch-AI as a fresh user would see it.

## Workflow

1. Create or pick a clean empty lab folder.
2. If needed, install the current local AutoResearch-AI tarball instead of the published release.
3. Let the agent inspect the filesystem and figure out whether it has a real repo.
4. Make the agent ask the target-selection question if no repo is obvious.
5. Make the agent ask the time-budget question once if the plan does not have a real answer yet.
6. Let the agent propose a first research plan based on the discovered repo history.
7. Save the raw transcript and a short summary into the dev control room.

## Output

- transcript
- short summary
- onboarding failures
- first experiment suggestion
- setup gaps to fix next

## Rules

- Do not give the tester hidden product-development context.
- Do not default to sweep-only suggestions.
- Keep the first run cheap and realistic.
- Keep the result local-only.
