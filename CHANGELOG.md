# Changelog

## Unreleased

New:

- Renamed the npm package from `researchloop` to `autoresearch-ai`.
- Updated the README and local install examples to use the new package/repo name.
- Added `templates/prompts/topic-intake.md` for baseline-aware research topics like query/key architecture work.
- Added `.researchloop/baseline.md` to new harness installs.

Improved:

- README, getting-started, site copy, and onboarding prompts now point to `npm install -g autoresearch-ai`.
- Research idea prompts now offer `propose`, `novel`, and `autonomous` modes after the baseline is clear.
- Topic recommendations now require grounded hypotheses with mechanisms and failure modes instead of random tweak menus.

## 0.3.1

New:

- Added a canonical first-contact prompt at `templates/prompts/first-contact.md`.
- `researchloop prompt` now includes the first-contact prompt automatically before the main research prompt.

Improved:

- First-run onboarding now tells agents to talk to the user first, inspect system/GPU/repo context read-only, and wait for approval before init, baselines, training, sweeps, or experiments.
- First-run research advice is now baseline-first: agents must check whether a baseline exists, explain where it is documented, and propose a baseline markdown note before recommending optimizer, architecture, sweep, or training changes.
- README and getting-started now include a copyable npm handoff prompt for GitHub users.
- Agent-specific skill files now point back to the canonical first-contact prompt instead of duplicating the full behavior.

Tests:

- `test:prompts` and `test:packed` now assert the first-contact, no-Docker, no-run-before-approval, and baseline-first onboarding rules.

## 0.3.0

New:

- `researchloop --version` prints the installed CLI version.
- `researchloop team` writes a local multi-agent development board with orchestrator, reviewer, and worker briefs. Now refuses to overwrite an existing `.researchloop/team/` without `--force`.
- `researchloop dashboard --host` prints a loud warning when bound beyond loopback (no auth, anyone on the network could read the run ledger).
- `templates/team/` ships role templates for the development hierarchy.
- `docs/startup/agent-ops.md` explains the human / orchestrator / worker / reviewer flow.

Tests and CI:

- New `npm test` aggregate runs every fast check (smoke, smoke:e2e, setup, compare, run, scan-papers, goal, idea, team, dashboard, prompts, focus-prompts, site, adapters).
- New `test:adapters` covers adapter detection negative cases — filename substrings, missing deps, partial `llm-research-kit` shape.
- New `test:packed` packs the tarball, installs it into an isolated npm prefix, asserts the file whitelist, and runs `init → goal → prompt → record → report` from the packed binary. Catches `files:` regressions that local-link testing hides.
- `test:run` now covers the noisy-log case (multiple metric mentions; non-numeric values that should not match).
- `test:site` no longer depends on a running localhost server.
- `test:setup` no longer hardcodes a developer's python path.
- New `.github/workflows/ci.yml` runs `npm test` on Node 18 / 20 / 22 against ubuntu-latest and macos-latest for every push and PR, plus a packed-install job and a pack dry-run assertion job.

Docs:

- README and getting-started point users to the prompt first and include the team board flow.
- CONTRIBUTING now gates PRs on `npm test`.
- `docs/startup/release-plan.md` has an explicit pre-publish checklist.

Package:

- `package.json` declares `engines.node >= 18` and a `repository` field, so `npm view` / `npm bugs` work and the CLI fails clearly on unsupported Node.

## 0.2.0

ResearchLoop becomes a runtime, not just a folder.

New:

- `researchloop run` executes a command, streams output to a per-run log, parses a metric (default regex on `metric=N` or `"metric": N`, plus last-line JSON fallback), and auto-appends a row to `runs.jsonl`. No more manual `record`.
- `researchloop baseline` is `run` for the baseline command and also updates `goal.md` Current Best and `plan.md` Current State.
- `researchloop scan-papers` queries the arXiv API for papers relevant to the goal, writes one markdown note per result to `scratchpad/papers/`, caches responses to `~/.cache/researchloop/arxiv/`, supports `--offline`, `--since YYYY-MM`, `--limit`, `--query`, `--cache-dir`.
- `researchloop idea` now reads `scratchpad/papers/` and adds paper-derived ideas alongside the adapter playbook.

Improvements:

- Tighter adapter detection: pytorch needs a real `train*.py` script or `torch` in deps; huggingface needs `transformers` in deps. No more false positives from filename substrings.
- `candidate_config_files` no longer matches every `.json`/`.yaml`/`.toml` in the repo.
- README install command no longer hardcodes a developer machine path.
- New tests: `test:run`, `test:scan-papers`. arXiv test uses a recorded XML fixture and never hits the network.

Cleanup:

- Removed misleading `projects/researchloop` and `projects/researchloop-cli` symlinks.

## 0.1.0

First public ResearchLoop release.

Includes:

- `researchloop init`
- `researchloop goal`
- `researchloop inspect`
- `researchloop idea`
- `researchloop prompt`
- `researchloop doctor`
- `researchloop record`
- `researchloop compare`
- `researchloop dashboard`
- `researchloop report`

Also includes:

- local-first dashboard
- MacBook / MPS smoke path
- startup docs
- onboarding tests
- competitor research notes
- open source release plan
