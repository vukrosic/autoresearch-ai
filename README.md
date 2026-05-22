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
autoresearch paper-read 2503.12345v1 --write
autoresearch hypothesis --from-papers --write
autoresearch propose --n 5 --write --with-priors
autoresearch rank --write
autoresearch next-experiment --write
autoresearch priors --proposal proposal-warmup-1
autoresearch idea --write
autoresearch prompt --agent codex
autoresearch team --workers 8
autoresearch tasks status
autoresearch summary
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
    hypotheses/
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
- `autoresearch priors --proposal <id>` attaches arXiv priors to one existing proposal, deduped by arXiv id, and writes any missing paper notes under `.researchloop/scratchpad/papers/`.
- `autoresearch next-experiment [PROPOSAL_ID]` turns the top ranked proposal, or one explicit proposal, into a concrete markdown runbook under `.researchloop/scratchpad/experiments/` with preflight, smoke, run, compare, story, and promote commands. Add `--script FILE.sh` when you want a reviewable shell wrapper.
- `autoresearch paper-read <paper-id>` turns a paper note into structured claim / mechanism / limits / port / baseline-relevance sections.
- `autoresearch paper-reread <paper-id> --against <run-id>` compares a paper note against a finished run and writes the takeaway into `.researchloop/scratchpad/paper-rereads/`.
- `autoresearch hypothesis --from-papers|--from-runs|--paper-id ID|--run-id ID|--novel` writes mechanism-first hypotheses into `.researchloop/scratchpad/hypotheses/`.
- `autoresearch idea` opens a chat-first research prompt that reads the repo history, asks for the time budget if needed, and can write the prompt into an idea note.
- `autoresearch prompt` prints an agent-ready autonomous research prompt, with optional focus playbooks.
- `autoresearch team` generates a local multi-agent development board for the AutoResearch-AI repo or another project.
- `autoresearch tasks` manages a claimable multi-agent queue in `.researchloop/tasks.jsonl` so parallel agents do not step on each other.
- `autoresearch baseline` runs the baseline command, parses the metric, and locks it into `goal.md` and `plan.md`.
- `autoresearch run` executes a training or eval command, streams the log, parses the metric, and records the run. Add `--seeds N` to run the same command across N seeds (substituted as `{seed}` and exported as `$RESEARCHLOOP_SEED`) and record a mean/std aggregator row.
- `autoresearch eval --run-id <run-id>` runs the configured eval command for one recorded run, parses declared metrics from stdout or a file, and updates that ledger row. If `eval.yaml` declares `metrics` and `eval_command`, `run` and `baseline` call it automatically after the training command finishes.
- `autoresearch sweep generate|status|run <name>` manages queue-based sweeps from `.researchloop/sweeps/<name>.yaml` (`grid`, `list`, or `random` strategies). Use `generate` to write `.queue.jsonl`, `status` to inspect queued/running/done/failed rows, and `run` to execute the queue with bounded workers. The legacy `--spec FILE.json` one-shot path still works for simple ad hoc sweeps.
- `autoresearch loop --command CMD [--iters N]` closes the ratchet — runs N iterations, keeps the best by metric in `loop_state.json`, with optional `--patch-cmd`, `--revert-on-regression`, and `--commit-on-win`.
- `autoresearch anomalies [--id RUN_ID]` scans recorded metric history for divergence (NaN/inf), spikes, and plateaus.
- `autoresearch verify --id <run-id>` re-runs a recorded run from the ledger and reports `deterministic` / `drifted` based on the metric delta. Tolerance via `--tolerance N`; refuses to launch when the source metric is missing or invalid.
- `autoresearch replay [RUN_ID] [--n N]` re-executes a recorded run, appends fresh `replay_of` rows to the ledger, and prints a metric diff table. Exits non-zero when the primary metric drifts beyond `--tolerance`; refuses to launch when the source metric is missing or replay arguments are invalid.
- `autoresearch significance <run-a> <run-b>` runs a permutation test plus bootstrap CI on the metric delta between two runs. `--direction lower|higher`, `--require-significant`, and `--format json` are supported; alias: `sig`.
- `autoresearch determinism --command CMD [--n N]` re-runs the same command multiple times and reports whether the metric stays within tolerance. Useful when you want to catch flaky training or nondeterministic evals early; alias: `det`.
- `autoresearch preflight` checks command/safety/metric/disk/RAM/GPU/baseline before you `run`. `--require-gpu`, `--min-disk-gb`, `--min-mem-gb` for hard gates; `--format json` for scripting.
- `autoresearch resume [RUN_ID] [--dry-run]` re-launches a failed or timed-out run. Exposes `$RESEARCHLOOP_RESUME=1`, `$RESEARCHLOOP_RESUME_FROM=<source-id>`, `$RESEARCHLOOP_RESUME_DIR=<prior-run-dir>`, and, when configured, `$RESEARCHLOOP_RESUME_CHECKPOINT(_REL)` so your training script can load its last checkpoint. With `checkpoint_glob` + `resume_flag_template` in `eval.yaml`, it appends the resume flag to the original command and prints the exact command before running. Auto-picks the latest resumable run when no id is provided.
- `autoresearch inspect` now writes a `multi_gpu` block into `repo-profile.json` that detects torchrun, accelerate, deepspeed, and pytorch-lightning launchers and emits suggested command shapes.
- `autoresearch record` appends a structured run result to `runs.jsonl` (use for manual rows).
- `autoresearch compare` ranks runs by a chosen metric and reports GPU-hours and peak memory when present.
- `autoresearch report` summarizes the run ledger, including total wall time and estimated cost when `.researchloop/cost.yaml` is configured. Use `--format markdown --out report.md --include-plots` to write a shareable experiment report with SVG plots.
- `autoresearch audit <file.md>` checks numeric metric claims in a markdown report against `runs.jsonl` and exits non-zero on unmatched claims.
- `autoresearch curves --id <run-id>` prints the streamed metric series as a unicode sparkline plus min/max/final stats. `--format json|jsonl` for scripting. Curves are now written live to `metrics.jsonl` during the run; the dashboard exposes them at `/api/curves?run=<id>`.
- `autoresearch promote --id <run-id> [--note TEXT]` copies a winning run's artifacts (env, config, metrics, code diff, log) into `.researchloop/winners/<id>/`, snapshots `goal.md`, writes `PROMOTION.md` + `review.md`, and flips the row's `status` to `promoted`. Refuses to promote a `failed | timeout | killed_by_*` row unless `--force`. Auto-runs the same checks as `autoresearch review` and blocks on failure unless `--force` or `--skip-review`.
- `autoresearch review --id <run-id>` runs programmatic checks against a recorded run (status healthy, primary metric finite, env captured, working tree not explicitly dirty, curve present, artifact bundle intact). `--format text|json|markdown`, `--out FILE.md` to persist. Exits non-zero on failure. Used as the gate inside `promote`.
- `autoresearch dashboard` starts a local localhost dashboard for experiment tracking. The dashboard now shows a run scatter, curve overlay, `/lineage` and `/api/lineage` for the parent-child run chain created by `replay`, `resume`, and `verify`, and `/diff?a=<id>&b=<id>` for side-by-side run comparisons.
- `autoresearch doctor` checks basic local tooling.
- `autoresearch doctor --repair-plan` prints an ordered checklist of likely fixes without changing anything.

### Evaluation rules (`.researchloop/eval.yaml`)

The minimal eval surface is active today: `metrics` and `eval_command` are the core contract, and `run` / `baseline` call `eval` automatically after training when they are present. The remaining sections are optional and owned by later goals.

```yaml
# Parse metrics after training or from a separate eval script.
metrics:
  - {name: val_loss, direction: lower, regex_or_jsonpath: 'val_loss=([0-9.]+)', source: stdout}
  - {name: val_acc, direction: higher, regex_or_jsonpath: '$.val_acc', source: file, file: eval.json}

eval_command: "python eval.py"

# Kill a diverged run before it burns the full timeout.
early_stop:
  - {metric: train_loss, rule: nan_or_inf, action: kill}
  - {metric: val_loss,   rule: ">10x_baseline_after_step_500", action: kill}

# Auto-flip each run's status after it ends.
gates:
  - {metric: val_loss, op: "<", value: "{baseline}-0.02", action: promote}
  - {metric: val_loss, op: ">", value: "{baseline}",      action: discard}

# Auto-mutate the command and re-launch on matching errors (OOM, etc.).
retry:
  - {match: "CUDA out of memory|RuntimeError: out of memory",
     transform: "halve:batch_size", max_retries: 2}

# Record newest checkpoints during a run and build the resume command from it.
checkpoint_glob: "checkpoints/*.pt"
resume_flag_template: "--resume {path}"
```

Runs that trigger an early-stop rule end with `status: "killed_by_rule"` and a `kill_reason` field on the row. Runs that match a gate end with `status: promoted | kept | discarded` and `gate_reasons`. Runs with `checkpoint_glob` record `last_checkpoint`; `autoresearch resume --dry-run` is the safe way to inspect the exact checkpoint restart command before spending GPU time.

GPU stats are captured automatically per run when `nvidia-smi` is present: `gpu_util_max_pct`, `gpu_util_mean_pct`, `gpu_memory_peak_mb`, `gpu_memory_total_mb`, and `gpu_hours` are written into the ledger row. The fields exist (null) on non-GPU hosts so the schema stays stable.

Run timing is captured automatically for every `run` and `baseline`: `started_at`, `ended_at`, and `wall_seconds` are written to `runs.jsonl`. To estimate cost, add `.researchloop/cost.yaml`:

```yaml
gpu: H100
hourly_usd: 2.50
```

New run rows then include `est_cost_usd`, computed as `wall_seconds / 3600 * hourly_usd`.

### Proposal and analysis

- `autoresearch propose` proposes N grounded experiments in `propose`, `novel`, or `autonomous` mode, with optional focus (`hyperparameters`, `architecture`, `attention`, `data`); it reads the goal/baseline, repo profile, runs, paper notes, and hypothesis notes, and writes `.researchloop/scratchpad/proposals.jsonl`. Add `--with-priors` to attach arXiv evidence and write missing paper notes while proposals are generated.
- `autoresearch rank` scores those proposals with explainable `impact`, `cost`, `risk`, `novelty_vs_runs`, and `evidence` values, then writes `.researchloop/scratchpad/ranked-proposals.jsonl` plus a `ranked-proposals.md` summary when `--write` is set.
- `autoresearch suggest` suggests next experiments based on the existing run ledger.
- `autoresearch topic "<text>"` runs the baseline-aware intake for a research topic and surfaces the nearest paper notes or run ledger rows with exact follow-up commands.
- `autoresearch summary` / `autoresearch status` prints the one-screen project state, best completed experiment, and next concrete command to run; add `--out summary.md` to save it.
- `autoresearch query "<expression>"` queries the run ledger and prints `jsonl` or `table`.
- `autoresearch failures` surfaces the top failure patterns across runs.
- `autoresearch diff-runs --id-a <id> --id-b <id>` diffs two runs across config and metrics, in text / json / markdown.
- `autoresearch param-importance` ranks which params moved the metric most.

### Run lifecycle and ledger hygiene

- `autoresearch baseline-status` shows the current baseline lock state.
- `autoresearch baseline --lock` / `--unlock` locks or unlocks the baseline.
- `autoresearch replay --id <run-id>` replays a recorded run and records replay rows.
- `autoresearch prune` prunes runs by age or status, with `--dry-run` and `--no-keep-promoted`.
- `autoresearch tag --id <run-id> --add/--remove/--list` manages tags on a run.

### Reproducibility and reporting

- `autoresearch data-fingerprint` hashes input data for reproducibility.
- `autoresearch model-card --id <run-id>` emits a model-card markdown for a run.
- `autoresearch digest --since <duration>` summarizes recent activity in text / json / markdown.
- `autoresearch report --format markdown --out report.md --include-plots` writes a lab-note-ready experiment report with Goal, Baseline, Best run, Sweep summary, Loss curves, Discarded results, Open questions, and an Appendix of run ids. Includes auto-generated MFU and Overfit-Watch tables when the underlying fields are populated.
- `autoresearch audit report.md` verifies that numeric loss/accuracy/perplexity/F1-style claims resolve to ledger metrics or metric deltas.

### Resource planning & hardware

Pre-flight every run so OOMs and "this is going to take four days" surface before the GPU spins.

- `autoresearch gpu-fit --params 7B [--gpu H100]` (alias `vram-fit`, `vram`) — VRAM breakdown per GPU SKU, with `--zero`, `--tp`, `--dp`, `--grad-checkpoint`, and Korthikanti activation accounting. Auto-runs inside `preflight` when arch hints are present.
- `autoresearch kv-cache --params 7B --batch 32 --context 8192 [--gpu H100]` (alias `kv`) — inference VRAM estimator with explicit GQA via `--n-kv-heads`; reports max batch, max context, and weights/KV split.
- `autoresearch mfu [--id <run>]` — Model FLOPs Utilization per ledger row with verdicts (< 20% likely dataloader-bound; ≥ 45% well-tuned).
- `autoresearch compute-budget --params 7B [--gpus N]` — Chinchilla-style tokens/FLOPs/gpu-days calculator across H100 BF16 × 50% MFU.
- `autoresearch shard-plan --params 7B --gpus 64 --layers L` (alias `shard`, `parallelism`) — recommends `(TP, PP, DP)` against feasibility, NVLink domain, and PP-bubble cost.
- `autoresearch sweep-projection --name <sweep>` (alias `sweep-project`) — projects sweep wall time and cost from the local ledger; warns at > $100 or > 1 day.
- `autoresearch headroom` — gap-to-perfect / gap-to-SoTA reality check, σ-units when seed variance is known.
- `autoresearch gpu-report` (alias `gpu`) — aggregates per-run `system.jsonl` load and memory pressure samples.
- `autoresearch hardware` (alias `hw`) — distributions of GPU model / CUDA / Python / Torch across the ledger; warns when more than one GPU model or CUDA version appears in a single sweep.
- `autoresearch disk-check [--path P --min-free-gb N]` (alias `disk`) — exits non-zero when free space is below the threshold.
- `autoresearch eta <run-id>` — best-effort time-to-completion off the streamed metrics.
- `autoresearch ablate <run-id>` — turns a winning config into `halve` / `double` / `remove` / `flip` ablation proposals; `--write` persists them into the same backlog `rank` reads.
- `autoresearch container-snapshot --id <run-id>` (alias `container`) — Dockerfile + `requirements.lock` repro kit under the run dir.

### Statistical rigor

Honest claims about wins, instead of single-seed point estimates.

- `autoresearch significance <run-a> <run-b>` (alias `sig`) — permutation test + bootstrap 95% CI on the metric delta. Multi-seed aggregate rows feed every seed; scalars contribute one point. `--require-significant` exits non-zero so it can gate promotion. Auto-fires inside `compare` whenever at least two finite-metric runs differ.
- `autoresearch determinism --command CMD --n N` (alias `det`) — re-runs the same command and reports whether the metric stays within tolerance.
- `autoresearch power --detect-delta D` — required sample size for a given effect size.
- `autoresearch sample-efficiency <run-id>` (alias `se`) — step at which a run hit 50/75/90/95/99% of its total improvement; `--vs <baseline>` reports speedup ratio.
- `autoresearch rl-stats <run-id>` (alias `rl`) — Agarwal-2021 robust aggregator (mean, IQM, median + stratified bootstrap CIs) for episode returns.
- `autoresearch scaling-fit` (alias `scaling`) — fits a Kaplan/Chinchilla power law on the ledger; `--with-offset` for the Hoffmann form; `--target N` projects forward.
- `autoresearch grad-noise` (alias `gns`, `gradient-noise`) — McCandlish-2018 critical-batch estimator, both two-batch exact and sample-variance proxy.
- `autoresearch overfit-watch <run-id>` (alias `overfit`) — val-min step, divergence point, and wasted-compute fraction. Auto-fires inside `run`/`baseline`; surfaces a one-line summary post-run.
- `autoresearch memorization` (alias `memo`, `verbatim-check`) — verbatim training-data leakage check on model outputs (Carlini family); flags > 5% aggregate.
- `autoresearch canary --eval EVAL.jsonl --train TRAIN.jsonl` — data-leak detector across eval/train; exits 2 on any overlap.

### API / LLM evals

Plan and price eval runs before paying for them.

- `autoresearch api-budget` (alias `api-cost`, `tokens-cost`) — projects $ cost across a baked-in pricing registry (Anthropic Opus/Sonnet/Haiku, GPT-5/4o/o3, Gemini Pro/Flash, DeepSeek V3, Together). Cross-checks `.researchloop/budget.json`.
- `autoresearch judge --candidates pairs.jsonl --mode pairwise|scalar|reference --judge MODEL` — LLM-as-judge harness. Generates judge prompts you can ship to any provider; `--parse outputs.jsonl` reads the answers back into ratings.
- `autoresearch elo --file wins.jsonl` (alias `arena`) — pairwise model ratings (online Elo + Bradley-Terry MLE with bootstrap 95% CIs); accepts both per-match and count rows.
- `autoresearch eval-diff --a runA/predictions.jsonl --b runB/predictions.jsonl` (alias `predictions-diff`) — flip analysis between two predictions files; surfaces the "same metric, different behavior" case.
- `autoresearch lr-finder` (alias `lrfinder`, `find-lr`) — analyzes a Smith-style LR range test and reports the elbow + suggested `max_lr`.

### Run lifecycle add-ons

The unglamorous-but-essential drawer: inspect, fork, share, schedule, tag.

- `autoresearch search "TEXT"` (alias `grep`) — full-text grep across papers, hypotheses, proposals, learnings, archive, winners, goal/plan, optionally the ledger.
- `autoresearch tail <run-id> [--follow] [--metrics]` — wraps `tail -f` on the run log or streams parsed metrics.
- `autoresearch story <run-id>` — narrates a run's ancestry, config diff vs parent, descendants, lesson, and kill reason.
- `autoresearch fork <run-id> --bump key=value` — emits a ready-to-modify `run` snippet from a known-good config.
- `autoresearch warmstart <run-id>` — generates a launch snippet that uses the run's final checkpoint as starting weights for a new experiment.
- `autoresearch smoke --command CMD` — actually-run smoke test (distinct from static `preflight`) with a tight 60s budget; lands in the ledger.
- `autoresearch share <run-id>` — packages a run as a portable `.tar.gz` with full reproduction instructions.
- `autoresearch pr-bundle <run-id>` (alias `pr`) — renders a PR-ready markdown body; pipes to `gh pr create --body-file -`.
- `autoresearch seed --set N | --bump | --env` — single source of truth for "what seed are we running today," with a Python/NumPy/PyTorch seeding-ritual snippet.
- `autoresearch bibtex` (alias `bib`) — extracts BibTeX from paper notes; `--file report.md` filters to cited entries.
- `autoresearch agent-memory` (alias `memory`) — distills the project into a CLAUDE.md-sized fragment so a fresh agent walks in informed.
- `autoresearch hooks` (alias `hook`) — manages `pre_run` / `post_run` / `on_promote` / `on_failure` / `on_archive` shell hooks under `.researchloop/hooks/`.
- `autoresearch retrospective --since 7d` (alias `retro`) — weekly synthesis: counts, top runs, lessons, dead ends, mechanisms, spend.
- `autoresearch lit-diff <paper-a> <paper-b>` (alias `litdiff`) — section-by-section diff of two paper notes with Jaccard similarity per section.
- `autoresearch slurm --command CMD` (alias `sbatch`) — generates a `.sbatch` wrapping `autoresearch run`; post-run hook patches `slurm_job_id` back into the ledger.
- `autoresearch similar --id <run-id>` — finds the most-similar runs by config and metric proximity.
- `autoresearch validate-config` (alias `validate`) — schema lint for `.researchloop/*.yaml` (`eval`, `safety`, `cost`, `review`, `notify`).
- `autoresearch mechanisms` — collects every distinct mechanism string across the ledger and hypothesis notes; `--check "TEXT"` is the dedup gate for `propose --novel`.
- `autoresearch leaderboard` (alias `top`) — status-update-shaped top-N table with deltas, status, wall time, and USD.
- `autoresearch paper-reread <paper-id> --against <run-id>` — compares a paper note against a finished run and writes the takeaway.
- `autoresearch archive <run-id> --reason "…"` — marks a dead-end with a reason so future agents don't re-walk it.
- `autoresearch learn <run-id> "lesson"` — captures a transferable lesson off a run.
- `autoresearch reset --id <run-id>` — removes a row from `runs.jsonl` and side-archives the run dir for the session.
- `autoresearch question add|list|answer|close` (alias `q`) — open-research-questions parking lot at `.researchloop/questions.jsonl`.
- `autoresearch stale-locks [--clean]` (alias `locks`) — finds and removes zombie sweep/task lock files from dead workers.
- `autoresearch budget --set USD | --check` — cost guardrail. `--check` exits 2 over-budget so a pre-run hook can short-circuit experiments that would blow the spend cap.
- `autoresearch data-sample --path FILE` (alias `sample-data`) — autodetects JSONL/CSV/TSV/text, reservoir-samples N rows, reports length percentiles and class balance.
- `autoresearch bench list|info|add` (alias `benchmark`) — registry of MMLU / HumanEval / GSM8K / ARC / TruthfulQA / HellaSwag / MBPP / BBH presets; `add` patches the metric stanza into `eval.yaml`.
- `autoresearch forecast` — projects metric trajectory forward from the ledger.
- `autoresearch pareto` — Pareto-front view across two competing metrics (e.g. quality vs cost).

### Tests

- `npm test` runs every fast check below in sequence. `npm run test:site` verifies this checked list against `package.json` so docs fail when the suite drifts.
- `npm run test:release` adds `npm run test:packed` on top of `npm test`. Run this before publishing to verify the packed tarball installs in an isolated prefix.

<!-- AUTO-TEST-SUITE:START -->
- `smoke`
- `smoke:e2e`
- `test:commands`
- `test:safety`
- `test:env`
- `test:setup`
- `test:baseline-status`
- `test:baseline-lock`
- `test:doctor-repair`
- `test:compare`
- `test:run`
- `test:eval`
- `test:scan-papers`
- `test:paper-reread`
- `test:topic`
- `test:hypothesis`
- `test:propose`
- `test:rank`
- `test:next-experiment`
- `test:goal`
- `test:idea`
- `test:team`
- `test:tasks`
- `test:summary`
- `test:dashboard`
- `test:prompts`
- `test:focus-prompts`
- `test:site`
- `test:adapters`
- `test:artifact-contract`
- `test:sweep`
- `test:sweep-run`
- `test:seeds`
- `test:significance`
- `test:determinism`
- `test:power`
- `test:anomalies`
- `test:loop`
- `test:gpu-ledger`
- `test:cost`
- `test:query`
- `test:report`
- `test:audit`
- `test:verify`
- `test:replay`
- `test:preflight`
- `test:multi-gpu-detect`
- `test:resume`
- `test:early-stop`
- `test:gates`
- `test:curves`
- `test:promote`
- `test:retry`
- `test:review`
- `test:prune`
- `test:tag`
- `test:suggest`
- `test:failures`
- `test:digest`
- `test:model-card`
- `test:data-fingerprint`
- `test:diff-runs`
- `test:param-importance`
<!-- AUTO-TEST-SUITE:END -->

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
