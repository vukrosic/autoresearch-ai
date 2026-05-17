<p align="center">
  <img src="./assets/autoresearch-banner.webp" alt="AutoResearch-AI banner" width="100%" />
</p>

[![CI](https://github.com/vukrosic/autoresearch-ai/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/vukrosic/autoresearch-ai/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/autoresearch-ai.svg)](https://www.npmjs.com/package/autoresearch-ai)
[![npm downloads](https://img.shields.io/npm/dm/autoresearch-ai.svg)](https://www.npmjs.com/package/autoresearch-ai)
[![License: MIT](https://img.shields.io/npm/l/autoresearch-ai.svg)](./LICENSE)
[![Node version](https://img.shields.io/node/v/autoresearch-ai.svg)](https://nodejs.org)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](#)

AutoResearch-AI is an open source npm package for autonomous AI research workflows, published on npm as `autoresearch-ai`.

> **Status: alpha (pre-1.0).** The CLI surface is stabilizing but breaking changes are still possible between minor versions. Pin a specific version in production use and watch [CHANGELOG.md](./CHANGELOG.md) before upgrading.

If you want the full step-by-step usage and publish guide, read [docs/getting-started.md](./docs/getting-started.md).

It installs a durable research harness into a machine learning repo so agents like Codex, Claude Code, Hermes, Cursor, and similar tools can inspect the code, propose experiments, run small checks, log results, and continue the loop without losing context.

## Give This Prompt To Your Agent

Copy this into Codex, Claude Code, Hermes, Cursor, or another coding agent:

```text
npm install -g autoresearch-ai. Act as an automated AI researcher. This package contains the tools and prompts. Follow `templates/prompts/first-contact.md` and `templates/prompts/topic-intake.md`: only talk to me first, explain my system/GPU/repo in simple language, check whether a baseline exists and where it is documented, and wait for approval before init, training, baselines, sweeps, or experiments. When I give a research topic, use the existing baseline if it exists; if it does not, propose documenting `.researchloop/baseline.md` first. Then offer propose, novel, or autonomous mode.
```

---

Manual Installation:

```bash
npm install -g autoresearch-ai
```

The package name is `autoresearch-ai`; the primary CLI command is `autoresearch`, with `researchloop` kept as a legacy alias.

Local development from this checkout:

```bash
git clone https://github.com/vukrosic/autoresearch-ai.git
cd autoresearch-ai
npm link
autoresearch --help
```

## Quick Start

```bash
autoresearch init --agent codex
autoresearch goal "lower validation loss" --metric val_loss --direction lower \
  --baseline "python train.py" --evaluation "python eval.py"
autoresearch inspect
autoresearch scan-papers --limit 10
autoresearch idea --write
autoresearch prompt --agent codex
autoresearch team --workers 8
autoresearch baseline
autoresearch run --id lr-3e-4 --command "python train.py --lr 3e-4"
autoresearch compare --metric val_loss --direction lower
autoresearch report
autoresearch dashboard
autoresearch doctor
```

Then paste the generated prompt into the coding agent. On first contact, the agent should explain the system and repo context in plain language before asking for approval to run anything.

## What It Creates

```text
.researchloop/
  AGENTS.md
  baseline.md
  goal.md
  plan.md
  repo-profile.json
  team/
  adapters/
  scratchpad/
    THREAD.md
    runs.jsonl
    memory.md
    ideas/
    papers/
    variants/
    sweeps/
```

The package does not claim to magically train every model. It gives an agent the operating system for serious research: constraints, baseline-first behavior, experiment logs, idea files, and reproducible reports.

## Research Topics

When you give the agent a topic like "query/key architectures", it should not jump straight into training ideas.

The expected flow is:

1. Check whether a usable baseline already exists and where it is documented.
2. If no clear baseline markdown note exists, propose creating or updating `.researchloop/baseline.md` first.
3. After the baseline is clear, offer three modes:

```text
propose     suggest 2-4 grounded experiments for me to choose from
novel       reason about genuinely different hypotheses, not just parameter tweaks
autonomous  after I approve it, run the loop within the agreed budget
```

Paper search is optional. The agent should offer it when it would improve the decision, and use it in autonomous mode when useful, but the first experiment should still stay small and baseline-aware.

## Repo Layout

```text
bin/                  CLI entrypoint
templates/            Harness, adapters, and agent prompts
skills/               Downloadable agent research skill packs
docs/site/            Landing page
docs/research/        Local testing notes and research logs
docs/competitors/     Competitor and adjacent-project research
docs/testing/         Setup and onboarding test plans
docs/startup/         Users, customers, open source, and go-to-market
examples/             Copyable end-to-end usage examples
examples/fixtures/    Minimal repo fixtures used by setup tests
scripts/              Smoke tests for the npm package
```

## Current Evidence

Tested on this MacBook:

- `autoresearch init`, `inspect`, `prompt`, `doctor`, and `report` pass in a clean temp repo.
- `autoresearch inspect` correctly detects `llm-research-kit` as `generic`, `pytorch`, `huggingface`, and `llm-research-kit`.
- `autoresearch doctor` confirms local torch 2.8.0, CUDA false, MPS true.
- A tiny synthetic LLM training run completed locally through `llm-research-kit` on MPS.

See `docs/research/experiments/macbook-e2e-2026-05-15.md`.

## Product Thesis

Autonomous AI research is bottlenecked less by model access than by research discipline. Most repos lack a stable loop for:

- clear goals
- baselines
- small experiments
- run logs
- comparison
- pruning
- continuation

AutoResearch-AI packages that loop as an open source npm tool.

## Users

Primary users:

- PhD students running ablations
- small AI labs
- independent AI researchers
- companies with model, prompt, or eval optimization work

The startup plan is in `docs/startup/`.

## Commands

- `autoresearch init` creates `.researchloop/` and agent instruction files.
- `autoresearch goal` saves a durable research objective in `.researchloop/goal.md`.
- `autoresearch inspect` writes `.researchloop/repo-profile.json`.
- `autoresearch scan-papers` fetches relevant arXiv abstracts into `.researchloop/scratchpad/papers/`.
- `autoresearch idea` opens a chat-first research prompt that reads the repo history, asks for the time budget if needed, and can write the prompt into an idea note.
- `autoresearch prompt` prints an agent-ready autonomous research prompt, with optional focus playbooks.
- `autoresearch team` generates a local multi-agent development board for the AutoResearch-AI repo or another project.
- `autoresearch baseline` runs the baseline command, parses the metric, and locks it into `goal.md` and `plan.md`.
- `autoresearch run` executes a training or eval command, streams the log, parses the metric, and records the run.
- `autoresearch record` appends a structured run result to `runs.jsonl` (use for manual rows).
- `autoresearch compare` ranks runs by a chosen metric.
- `autoresearch report` summarizes the run ledger.
- `autoresearch dashboard` starts a local localhost dashboard for experiment tracking.
- `autoresearch doctor` checks basic local tooling and can print a repair plan with `--repair-plan`.
- `npm test` runs every fast check below in sequence. CI runs this on Node 18 / 20 / 22 against ubuntu and macos for every push and PR.
- `npm run test:release` adds the packed-tarball install check on top of `npm test`. Run this before publishing.
- `npm run test:setup` runs the blank-repo and minimal-fixture setup checks.
- `npm run test:compare` checks comparison output for a few recorded runs.
- `npm run test:run` checks `run` and `baseline` against deterministic shell commands, including a noisy-log case.
- `npm run test:scan-papers` checks the arXiv scan path against a recorded XML fixture (no network).
- `npm run test:goal` checks goal saving and prompt handoff.
- `npm run test:idea` checks the chat-first idea prompt for a blank repo, an llm-research-kit-shaped repo, and a paper-augmented repo.
- `npm run test:team` checks the multi-agent development board and worker files.
- `npm run test:dashboard` checks the local dashboard server and API.
- `npm run test:prompts` checks prompt templates for placeholder drift.
- `npm run test:focus-prompts` checks the hyperparameter, architecture, and attention playbooks.
- `npm run test:site` checks the public landing page copy (reads the file directly; no server needed).
- `npm run test:adapters` checks repo-shape adapter detection against negative cases.
- `npm run test:packed` packs the tarball, installs into an isolated npm prefix, and runs the harness end-to-end.

## Contributing

AutoResearch-AI is built in the open by humans and AI coding agents working in parallel.

Every shippable unit of work is a numbered goal in [GOALS.md](./GOALS.md) — sized so one agent can pick it up independently, with acceptance criteria, a test plan, file ownership, and explicit dependencies. To contribute:

1. Read [AGENTS.md](./AGENTS.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).
2. Pick a `G##` goal from [GOALS.md](./GOALS.md) that has no open issue / PR against it and whose `Depends on` goals are already merged.
3. Open a [Contribute-a-Goal issue](./.github/ISSUE_TEMPLATE/contribute-goal.yml) to claim it.
4. Branch, implement, run `npm test`, open a PR using the [PR template](./.github/PULL_REQUEST_TEMPLATE.md).

PRs written wholly or partly by AI coding agents are welcome — name the agent in the PR description so reviewers know what kind of review the change needs.

See also: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md), [SECURITY.md](./SECURITY.md), [GOVERNANCE.md](./GOVERNANCE.md), [SUPPORT.md](./SUPPORT.md), [RELEASING.md](./RELEASING.md).

## Citing

If you use AutoResearch-AI in a paper, ablation study, or experiment writeup, please cite it via [CITATION.cff](./CITATION.cff) (GitHub renders a "Cite this repository" button in the sidebar).

## Parallel Agent Tooling

Local helper for running many coding agents in parallel against the same repo:

```bash
./researchloop-dev/tools/codex-swarm.sh           # opens a 3x2 grid of Terminal.app windows, each running `codex`
```

Full options and patterns: [researchloop-dev/tools/README.md](./researchloop-dev/tools/README.md). macOS only today.

## Open Source

AutoResearch-AI should stay open source at the core. The npm package, prompts, adapters, and run ledger format should be inspectable and forkable.

The package also ships optional skill packs under `skills/` so teams can copy the same research rules into Codex, Claude Code, or other agent-specific folders.

Possible paid layers later:

- hosted dashboard
- team run history
- managed GPU runners
- private lab templates
- compliance/export support
- priority support for labs and companies
