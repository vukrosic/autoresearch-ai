# AutoResearch-AI Skills

This folder ships downloadable agent skills for autonomous AI research.

The package keeps the core product in the CLI, dashboard, prompts, and run ledger.
These skills are the agent-side memory layer that makes the research loop stick.

## What is in here

- `researchloop-autoresearch/` - the main research skill pack
- `researchloop-autoresearch/references/` - focused playbooks for common experiment families
- `researchloop-autoresearch/*/SKILL.md` - focused skills for search, ablation, training, research, and ops
- `researchloop-autoresearch/local-install/SKILL.md` - local npm tarball handoff string and optional smoke-test command for a separate agent
- `researchloop-training-ladder/` - a staged small-to-long training mode for pruning and promotion

## How users use it

Users copy the right file into the skill folder their agent expects.

Typical mapping:

- Codex: copy `researchloop-autoresearch/codex/SKILL.md` into the local Codex skills directory
- Claude Code: copy `researchloop-autoresearch/claude-code/CLAUDE.md` into the Claude Code instructions or skill location they use
- Hermes: copy `researchloop-autoresearch/hermes/HERMES.md` into the Hermes instructions or skill location they use
- Cursor: copy `researchloop-autoresearch/cursor/researchloop.mdc` into `.cursor/rules/` or the Cursor rules location they use

## How distribution works

AutoResearch-AI keeps the core loop in the npm package, and the skill pack stays here as a portable agent-side copy.

That means:

- the package can still install and run without a separate skills repo
- users can copy the files into their own agent setup immediately
- a separate skills registry or repo is optional later if the skill set grows enough to justify independent release cadence

For now, the packaged skills are the lightweight path. Split them out only if you want a community-maintained skill catalog with its own install/update flow.

## Focused skill families

The repo now includes focused skills for:

- core loop setup
- repo inspection and adapters
- goal and metric definition
- time-budget planning
- run logging, compare, and reporting
- hyperparameter and learning-rate search
- optimizer, schedule, batch-size, weight-decay, and warmup search
- architecture, attention, depth-width, normalization, and loss ablations
- data quality, data ablation, augmentation, evaluation, metric, and generalization checks
- sweep management, pruning, reproducibility, checkpointing, and failure analysis
- paper review, idea ranking, mechanism hypotheses, ablation planning, and claim audits
- orchestration, review, handoff, release proof, and onboarding/demo work
- local install, linked checkout testing, and packed-tarball smoke checks

## What the skill pack does

- keeps the goal visible
- forces baseline-first behavior
- asks for one small experiment at a time
- records runs and comparisons
- prunes weak ideas instead of spiraling

The CLI prints prompts and creates `.researchloop/` state.
The skills make the agent remember how to behave while doing the work.
