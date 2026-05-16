# AutoResearch-AI Agent Ops

This is the operating model for building AutoResearch-AI itself with multiple agents.

The goal is not a flat swarm.
The goal is a small hierarchy that stays legible:

- human owns release direction
- orchestrator owns decomposition
- workers own features
- reviewer owns merge safety
- GitHub owns branch and pull request history

## Why this shape

A flat swarm gets noisy once tasks touch shared files.

A small hierarchy keeps parallelism useful:

- workers stay narrow
- branches stay reviewable
- merge risk stays visible
- the human still controls the release

## Default roles

### Human

- decides the release target
- chooses what ships
- approves merges
- changes direction only when there is evidence

### Orchestrator

- splits the release goal into lanes
- assigns one lane per worker
- keeps the board current
- prevents file overlap when possible

### Worker

- owns one branch or worktree
- changes only the assigned files
- records commands, results, and failures
- hands back a diff that is easy to review

### Reviewer

- checks scope, tests, and overlap
- rejects vague or unverified claims
- decides whether a branch is merge-ready

## Suggested lanes for AutoResearch-AI

Use these lanes when developing the package itself:

1. CLI and runtime
2. Dashboard and state API
3. Prompt packs and skills
4. Docs and onboarding
5. Tests and CI
6. Release and publishing
7. Competitor and user research
8. Public site and launch copy
9. Repo detection and adapters
10. Integration and merge safety
11. Examples and fixtures
12. Research logs and evidence

## How to run it

1. Set the goal.
2. Generate a team board.
3. Create one branch or worktree per worker.
4. Let the orchestrator assign the lanes.
5. Review each diff before merge.
6. Merge only the branches with evidence.

The generated team pack also includes a `setup.sh` helper with one `git worktree add -b ...` command per lane.

## Branching rule

Use one branch per worker and keep the branch name tied to the lane.

Example:

```bash
codex/autoresearch-cli-runtime
codex/autoresearch-dashboard
codex/autoresearch-tests-ci
```

## Merge rule

Do not merge two agents into the same file at the same time unless the reviewer explicitly takes over the integration step.

## Practical rule for us

If we want 10 agents in parallel, we do not need 10 equal voices.

We need:

- 1 human
- 1 orchestrator
- 8 to 10 workers
- 1 reviewer

That is enough to move fast without losing the plot.
