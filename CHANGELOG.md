# Changelog

## Unreleased

New:

- **Checkpoint-aware `autoresearch resume` (G09).** `eval.yaml` can now declare `checkpoint_glob` and `resume_flag_template`. `run` records the newest matching checkpoint as `last_checkpoint`; `resume [RUN_ID] --dry-run` prints the exact restart command with the resume flag appended without executing it; configured checkpoint resumes fail clearly when no checkpoint exists.
- **`autoresearch replay <run-id>` (G10).** Re-executes a recorded command, writes fresh ledger rows carrying `replay_of` and `parent_id`, supports `--n`, prints a metric diff table, and exits non-zero when the replayed primary metric drifts beyond `--tolerance`.
- **`autoresearch review --id <run-id>` (G19 minimal).** Runs five programmatic checks against a recorded run: `status_ok` (status ∈ complete | promoted | kept), `metric_finite` (primary metric present and finite), `env_captured` (G14 fields populated), `git_clean` (not explicitly dirty; null git context allowed), `curve_present` (at least one streamed sample), and `artifacts_present` (env.json + config.json + MANIFEST.json exist). `--format text|json|markdown` and `--out FILE.md` for persistence. Exits non-zero on any failure. `promote` now invokes this review automatically and blocks unless `--force` or `--skip-review`. A passing review is written to `winners/<id>/review.md`.
- **`autoresearch promote --id <run-id>` (G05 completion).** Copies the run's `env.json`, `code.diff`, `config.json`, `metrics.jsonl`, `system.jsonl`, `MANIFEST.json`, `log.txt`, plus a snapshot of `goal.md` and `command.txt`, into `.researchloop/winners/<id>/`. Writes `PROMOTION.md` and `row.json`. Flips the ledger row's `status` to `promoted` and appends a `gate_reasons` entry with the prior status. Refuses to promote `failed | timeout | killed_by_safety | killed_by_rule | discarded` rows unless `--force`. `--note TEXT` attaches a free-form note.
- **OOM / hardware retry (G12).** New `.researchloop/eval.yaml` section `retry:`. When a run ends with `failed | timeout | spawn_error`, the captured output is scanned for matching rules; the first match runs `transform` on the command (today: `halve:<flag>` and `set:<flag>=<value>`) and re-launches as a new ledger row with `retry_of: <original-id>` and `parent_id: <previous-attempt-id>`. The original failed row gets a `retry_reason` field. `max_retries: 0` disables retries for the rule.
- **Streaming metric capture (G06 minimal).** `autoresearch run` and `baseline` now parse the primary metric line-by-line as the child process runs, and stream every sample to `metrics.jsonl` in the run directory while the process is still alive. Final `metric_history` is derived from the streamed series — log-rescan only kicks in as a fallback.
- **NaN / divergence early-stop (G11).** New `.researchloop/eval.yaml` section `early_stop:` with `nan_or_inf` and `>Nx_baseline_after_step_K` rules. On trigger the runner SIGTERMs the entire process group and SIGKILLs after 2 s, then writes `status: "killed_by_rule"` and `kill_reason: "<rule>"` on the row. Saves real GPU-hours when a learning rate diverges training.
- **Promotion gates (G05).** New `eval.yaml` section `gates:` with rules like `{metric: val_loss, op: "<", value: "{baseline}-0.02", action: promote|discard}`. After a run completes, the row's `status` auto-flips to `promoted | kept | discarded` and `gate_reasons` records which gate fired.
- **`eval.yaml` schema (G04 minimal).** New template `.researchloop/eval.yaml` is now scaffolded by `autoresearch init`. Reserves `metrics` and `curves`, and now powers `early_stop`, `gates`, `retry`, `checkpoint_glob`, and `resume_flag_template`.
- **`autoresearch curves --id <run-id>`.** Prints the streamed metric series as a unicode sparkline plus summary stats (min, max, final, non-finite count). `--format json|jsonl` for scripting.
- **`/api/curves?run=<id>`** endpoint on the dashboard server returns the streamed series as JSON, ready for chart UIs.

Process:

- `spawnCommand` now starts the child in its own process group (`detached:true`) so SIGTERM/SIGKILL reach grandchildren (e.g. `python` spawned by a shell wrapper). Previously a `sleep` in a wrapper could hold the stdout pipe open after the parent shell exited.

Improved:

- `autoresearch report` now prints total estimated cost when any run row has `est_cost_usd`.
- `autoresearch report --format markdown --out report.md --include-plots` now writes a shareable experiment report with required research sections and SVG plots in `report-assets/`.
- `autoresearch audit <file.md>` now checks numeric metric claims in markdown against `runs.jsonl` and exits non-zero on unsupported claims.
- G23 cost accounting is now fully documented: every run records `started_at`, `ended_at`, and `wall_seconds`; optional `.researchloop/cost.yaml` populates `est_cost_usd`.

Tests:

- New: `test:early-stop`, `test:gates`, `test:curves`, `test:promote`, `test:retry`, `test:review`, all wired into `npm test`.
- New: `test:replay`, wired into `npm test`.
- Expanded: `test:resume` now covers checkpoint capture, dry-run command output, and the no-checkpoint failure path.
- New: `test:cost`, wired into `npm test`.
- New: `test:query`, wired into `npm test`; also fixes empty table results to print a header row instead of placeholder text.
- New: `test:report`, wired into `npm test`.
- New: `test:audit`, wired into `npm test`.

## 0.5.1 — 2026-05-20

New commands:

- `autoresearch resume [--id RUN_ID]` — re-launches a failed / timeout / spawn-error / killed-by-safety run from the ledger. Sets `$RESEARCHLOOP_RESUME=1`, `$RESEARCHLOOP_RESUME_FROM=<source-id>`, `$RESEARCHLOOP_RESUME_DIR=<abs path to prior run dir>` so the user's training script can detect resume mode and load its last checkpoint. If `--id` is omitted, auto-picks the most recent resumable run from the ledger. Records `resume_of` pointer in the child config and `parent_id` in the ledger row.

Tests:

- New: `test:resume`, wired into `npm test`.

## 0.5.0 — 2026-05-20

New commands:

- `autoresearch verify --id <run-id>` re-runs a previously recorded run from the ledger and reports `deterministic` / `drifted` based on the metric delta vs the recorded value. Supports `--metric`, `--tolerance N`, `--timeout`, and env-mismatch warnings.
- `autoresearch preflight` runs a fail-fast check before training: command exists and is on PATH, safety policy allows it, metric is set, data fingerprint, free disk vs `--min-disk-gb`, free RAM vs `--min-mem-gb`, GPU presence (`--require-gpu` to assert), baseline-lock state. `--format json` for scripting.

Improved:

- `inspect` now writes a `multi_gpu` block into `repo-profile.json` that detects torchrun, accelerate, deepspeed, and pytorch-lightning launchers in the user repo and emits suggested command shapes. Counts local GPUs via `nvidia-smi` so propose / suggest can recommend correct `--nproc-per-node` etc.

Tests:

- New: `test:verify`, `test:preflight`, `test:multi-gpu-detect`, all wired into `npm test`.

## 0.4.0 — 2026-05-20

New commands:

- `autoresearch sweep --spec FILE.json` — declarative variant queue. Supports `variants` (explicit list) or `grid` (cross-product), `command_template` with `{param}` placeholders, optional `--seeds N` per variant, `--dry-run`, and a `summary.json` written to `.researchloop/scratchpad/sweeps/<id>/`.
- `autoresearch run --seeds N` — runs the command N times under different seeds (substituted as `{seed}` in the command, also exported as `$RESEARCHLOOP_SEED`). Records one child run per seed plus an aggregator row carrying `mean`, `std`, `min`, `max`, and `child_run_ids` in the ledger.
- `autoresearch loop --command CMD [--iters N]` — closed ratchet loop: runs the command N times, tracks the running-best metric in `.researchloop/scratchpad/loop_state.json`. Optional `--patch-cmd CMD`, `--revert-on-regression`, `--commit-on-win`, and `--keep-if better|same`.
- `autoresearch anomalies [--id RUN_ID] [--format text|json]` — scans recorded `metric_history` for divergence (NaN/inf), spikes (>5× median prior), and plateaus (last 8 steps within 0.5% range).

Improved:

- Every `run` and `baseline` now records GPU stats when `nvidia-smi` is available: `gpu_present`, `gpu_count`, `gpu_util_max_pct`, `gpu_util_mean_pct`, `gpu_memory_peak_mb`, `gpu_memory_total_mb`, and `gpu_hours`. The fields are present (and null) on non-GPU hosts so the ledger schema stays stable.
- `compare` now emits `gpu_runs`, `gpu_hours_total`, and `gpu_memory_peak_mb` summary lines when any compared run has GPU stats.
- `cmdRun` body is now factored through an `executeRun(opts)` helper used by `run`, `baseline`, `sweep`, `loop`, and `--seeds` — no behavioral change for the existing two commands.

Tests:

- New: `test:sweep`, `test:seeds`, `test:anomalies`, `test:loop`, `test:gpu-ledger`, all wired into `npm test`.

## 0.3.2 — 2026-05-20

New:

- Added `templates/prompts/topic-intake.md` for baseline-aware research topics like query/key architecture work.
- Added `.researchloop/baseline.md` to new harness installs.
- README now documents the full CLI surface (`propose`, `rank`, `suggest`, `topic`, `query`, `failures`, `diff-runs`, `param-importance`, `baseline-status`, `baseline --lock/--unlock`, `replay`, `prune`, `tag`, `data-fingerprint`, `model-card`, `digest`).

Improved:

- README, getting-started, site copy, and onboarding prompts now point to `npm install -g autoresearch-ai` (rename from `researchloop` shipped on npm in 0.3.1; README copy now matches).
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
