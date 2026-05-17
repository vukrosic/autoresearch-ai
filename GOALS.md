# AutoResearch-AI — Development Goals

This is the canonical project build plan. It replaces the older `docs/startup/development-goals.md` (themes) by absorbing its goals into the engineering breakdown here.

**Scope.** These are *development goals for the project* — what we build into the npm package. They are not the runtime goals of an agent using the tool; for that, see [docs/startup/goals.md](docs/startup/goals.md).

**Audience.** Each goal is sized so one AI agent can pick it up independently, with no shared in-flight state required beyond the files in the repo. We run multiple agents in parallel against this list.

---

## Product loop (what we are building toward)

AutoResearch-AI should let an agent take a real ML repo through this loop without human intervention in the steady state:

1. Understand the machine and repo.
2. Establish and protect the baseline.
3. Collect evidence from runs, code, and papers.
4. Generate grounded *or* novel hypotheses.
5. Choose the cheapest meaningful experiment.
6. Run or prepare the experiment within an approved budget.
7. Record, compare, reproduce, and promote results.

Every goal below should strengthen one step of that loop.

---

## How to use this doc

Conventions:

- **Goal ID** is `G##`. Other goals reference it by ID. IDs are stable.
- **Acceptance** lines are written so a reviewer can mechanically check them — every line is either a file/command that must exist or a measurable behavior.
- **Test plan** lines are concrete bash commands or assertions a reviewer (or the agent itself) runs after the goal is "done".
- **Effort**: S = < 1 day, M = 1–3 days, L = > 3 days.
- **Depends on** lists hard prerequisites only.
- **Files owned** lists the files this goal's agent writes to. If two goals own the same file, one of them needs an integration owner (see file ownership map below).

The current shipped surface (do not re-do): `init`, `goal`, `inspect`, `scan-papers`, `idea`, `prompt`, `team`, `baseline`, `run`, `record`, `compare`, `report`, `dashboard` (static), `doctor`. Skill packs under `skills/researchloop-autoresearch/*` are reference docs read by Claude Code and Codex — they are not invoked by the CLI and we are intentionally not wiring them in.

---

## Tiers and parallel-agent cut

Goals are organized into tiers. Tier 0 must land before any tier above it can ship safely. Within a tier, goals can run in parallel up to file-ownership conflicts (see map below).

| Tier | Theme | Goals | Suggested parallel agents |
|---|---|---|---|
| **0** | Safety + foundations | ~~G25~~, ~~G14~~ (both shipped) | — |
| **1** | Loop intelligence (baseline → topic → papers → hypothesis → propose → rank) | G26, G27, G28, G29, G30, G01, G02, G03 | 4–5 |
| **2** | Evaluation layer | G04, G05, G06 | 2 (sequential within: G04 → G05/G06) |
| **3** | Reliability & reproducibility | G09, G10, G11, G12, G31, G32 | 3–4 |
| **4** | Scale (sweeps + multi-agent queue + query) | G07, G08, G18, G19, G13 | 3–4 |
| **5** | Reporting & dashboard | G20, G21, G23, G15, G16, G17 | 3 |
| **6** | Integrations | G22, G24 | 2 |

**Gate.** [G00 — Dogfood loop on `llm-research-kit`](#g00--dogfood-loop-on-llm-research-kit) must pass before declaring 0.4.0 done. It uses whatever subset of Tier 1+2 has shipped.

---

## File ownership map (collision avoidance for parallel agents)

`bin/researchloop.js` is touched by almost every CLI goal. Treat it as a shared file with one **integration owner** (reviewer lane). Workers stage their changes and the integration owner merges. Other files have clearer owners:

| File / directory | Goals that touch it | Integration owner |
|---|---|---|
| `bin/researchloop.js` | all CLI goals | reviewer |
| `.researchloop/eval.yaml` (schema) | G04, G05, G06, G09, G10, G11, G12 | G04 worker |
| `.researchloop/sweeps/` | G07, G08 | G07 worker |
| `.researchloop/tasks.jsonl` + claim mutex | G08, G18 | G18 worker (owns the mutex primitive; G08 reuses) |
| `templates/base/baseline.md` | G26, G27 | G26 worker |
| `templates/prompts/` | G01, G28, G30 | each goal owns its own template file |
| `templates/dashboard/` | G15, G16, G17 | G15 worker |
| `scripts/test-*.sh` | each goal adds its own | n/a (no conflict) |
| `examples/fixtures/` | G01, G02, G07, G10, G14, etc. | each goal owns a named subdir |

Two workers may not edit the same template file unless one is the integration owner.

---

## G00 — Dogfood loop on `llm-research-kit`

**Motivation.** The plan below is bottom-up. Before we declare any release done, we need top-down proof: one agent driving a real repo end-to-end through baseline → idea → run → compare → promote without manual rescue in the steady state.

**Deliverables.**
- A transcript + ledger committed under `examples/dogfood/llm-research-kit/` showing the agent completing one full loop using whichever Tier 1+2 commands have shipped.
- A short `RESULT.md` documenting: what worked, what required manual intervention, which goals would have prevented each intervention.
- A short demo recording (asciinema or mp4) under `assets/demo/`.

**Acceptance.**
- The agent ran `baseline`, `propose` (or `idea`), `run`, `compare`, and either `promote` or recorded a discard, with no human prompt-engineering during the steady-state loop.
- Every manual intervention is logged and mapped to an open G## goal.
- The recording shows install → first logged experiment in under 15 minutes.

**Test plan.** Manual — this is the release gate, not a unit test.

**Depends on.** G25, G14, G04 (minimal), and at least one of {G01, G28} from Tier 1.
**Effort.** M. **Agent role.** Reviewer / integration owner.

---

## Tier 0 — Safety + foundations

### G25 — Agent command sandbox / allowlist

**Status.** Shipped. See `loadSafetyPolicy` / `evaluateCommandSafety` in `bin/researchloop.js` (~L204), `templates/base/safety.yaml`, and `scripts/test-safety.sh`. All Acceptance lines pass against current code.

**Motivation.** An autonomous agent will eventually run `rm -rf` or download a 200 GB checkpoint. We need a guardrail in place *before* any sweep runner ships in the wild.

**Deliverables.**
- `.researchloop/safety.yaml`: `allow_prefixes`, `deny_substrings`, `max_minutes_per_run`, `max_cost_usd_per_run`.
- All commands invoked by `run`, `baseline`, `sweep run`, `replay`, `resume` are checked against the policy first.
- Violations exit non-zero with the rule that fired; `--allow-unsafe` is the only bypass and emits a loud warning.

**Acceptance.**
- `autoresearch run --command "rm -rf /tmp/foo"` is blocked by default.
- `autoresearch run --command "python train.py"` is allowed.
- `max_minutes_per_run: 1` kills a 3-minute fixture run at ~60 s with `status: "killed_by_safety"`.

**Test plan.** `scripts/test-safety.sh` covers deny substring, missing prefix, time cap, `--allow-unsafe` bypass.

**Files owned.** `bin/researchloop.js` (safety module), `templates/base/safety.yaml`, `scripts/test-safety.sh`.

**Depends on.** None. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G14 — Environment capture per run

**Status.** Shipped. See `captureEnv` in `bin/researchloop.js` (~L362) and `scripts/test-env.sh`. Env lands in `row.env` of `runs.jsonl`; `replay` and `doctor` warn on mismatch. **G32** persists `env.json` as a standalone file inside the run directory.

**Motivation.** "Reproducible" is a lie without recording git SHA, Python, Torch, GPU, OS, CUDA driver. Today none of this is captured.

**Deliverables.**
- During `run`, capture: git SHA + dirty flag, `python --version`, `pip freeze` hash (sha256 over sorted lines), `torch.__version__`, `cuda` available + version, GPU device names, OS string, hostname.
- Stored under the row's `env` object.
- `doctor` and `replay` consume `env` to warn on mismatches.

**Acceptance.**
- A row in `runs.jsonl` after a real run contains an `env` object with all listed keys; unavailable fields are explicit `null`, not missing.
- `replay` warns (non-fatal) when current `env.git_sha` differs from the stored `env.git_sha`.

**Test plan.** `scripts/test-env.sh` runs a no-op command in a temp git repo and asserts the `env` object schema. Mutates the repo (dirty working tree) and asserts `git_dirty: true`.

**Files owned.** `bin/researchloop.js` (env capture module), `scripts/test-env.sh`.

**Depends on.** None. Pairs with G10. **Effort.** S. **Agent role.** Worker — CLI feature.

---

## Tier 1 — Loop intelligence

### G26 — `autoresearch baseline-status`

**Motivation.** Autonomous research fails when the agent starts optimizing before it knows what it's improving against. Today nothing tells the agent the baseline is missing or incomplete.

**Deliverables.**
- New subcommand `autoresearch baseline-status [--dir PATH] [--format text|json]`.
- Reads `.researchloop/baseline.md` and reports: presence, schema completeness (command, config or artifact, metric, frozen variables, caveats), and a short summary.
- Schema for `templates/base/baseline.md` documented in the file itself as comment headers.

**Acceptance.**
- A blank repo prints a clear `missing baseline` message and exits non-zero.
- A repo with a partial `baseline.md` lists exactly which fields are missing.
- A repo with a complete `baseline.md` prints a one-paragraph summary that does not invent fields not in the file.

**Test plan.** `scripts/test-baseline-status.sh` covers three states: missing, partial, complete.

**Files owned.** `bin/researchloop.js`, `templates/base/baseline.md`, `scripts/test-baseline-status.sh`.

**Depends on.** None. **Effort.** S. **Agent role.** Worker — CLI feature.

---

### G27 — `autoresearch baseline --lock`

**Motivation.** A baseline that quietly drifts mid-experiment invalidates every later claim. Lock it.

**Deliverables.**
- `autoresearch baseline --lock` writes `.researchloop/baseline.lock` (JSON) capturing: baseline command, metric, value, git SHA, env hash (reuses G14), timestamp.
- Subsequent `run`/`compare`/`promote` invocations warn if the lock file's git SHA no longer matches HEAD or if the baseline metric value has drifted.

**Acceptance.**
- After `baseline --lock`, the lock file exists and contains all required keys.
- Changing the baseline command and re-running `compare` prints a clear drift warning, but does not crash.
- `--unlock` flag removes the lock.

**Test plan.** `scripts/test-baseline-lock.sh` exercises lock, drift detection, and unlock.

**Files owned.** `bin/researchloop.js`, `scripts/test-baseline-lock.sh`.

**Depends on.** G26, G14. **Effort.** S. **Agent role.** Worker — CLI feature.

---

### G28 — `autoresearch topic`

**Motivation.** Users give topics like "query/key architectures" — the agent should not jump from a topic straight to random experiments. It should turn the topic into a baseline-aware plan.

**Deliverables.**
- `autoresearch topic "TEXT" [--mode propose|novel|autonomous] [--dir PATH] [--write]`.
- Writes `.researchloop/scratchpad/topics/<slug>.md` containing: baseline-state check, matching paper notes (if any), matching prior runs (if any), three offered next-modes, one suggested smallest experiment, an explicit "needs approval" line.
- Refuses `--mode autonomous` if no baseline is locked (G27).

**Acceptance.**
- Output always starts with the baseline-state section.
- Output lists the three modes (propose / novel / autonomous).
- Output does not recommend training without an approval line.

**Test plan.** `scripts/test-topic.sh` covers a blank repo, a baseline-ready repo, and a repo with paper notes.

**Files owned.** `bin/researchloop.js`, `templates/prompts/topic-intake.md`, `scripts/test-topic.sh`.

**Depends on.** G26 (baseline state). Soft synergy with G29/G30. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G29 — `autoresearch paper-read <paper-id>`

**Motivation.** `scan-papers` saves abstracts. That makes the agent busier, not smarter. We need structured notes that connect papers to the local baseline.

**Deliverables.**
- `autoresearch paper-read <paper-id> [--from arxiv|local] [--dir PATH]`.
- Writes `.researchloop/scratchpad/papers/<id>.md` with five required sections: `claim`, `mechanism`, `limits`, `how to port this`, `baseline relevance`.
- Reuses the existing arXiv fetch path; falls back to cached XML offline.

**Acceptance.**
- A paper note after `paper-read` contains all five section headers, each non-empty.
- Offline mode (`RESEARCHLOOP_OFFLINE=1`) succeeds when XML is cached, fails clearly otherwise.
- Re-running on the same paper-id does not duplicate the file (or merges into it without data loss).

**Test plan.** Extends `test-scan-papers.sh` with a paper-read case against the existing XML fixture.

**Files owned.** `bin/researchloop.js`, `templates/prompts/paper-read.md`, additions to `scripts/test-scan-papers.sh`.

**Depends on.** Existing `scan-papers`. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G30 — `autoresearch hypothesis --from-papers`

**Motivation.** Paper notes are useful only if they turn into testable hypotheses for the local repo. This goal absorbs the old "novel hypothesis" theme: every hypothesis must be mechanism-first, with a kill criterion, not a parameter sweep dressed up.

**Deliverables.**
- `autoresearch hypothesis [--from-papers] [--from-runs] [--novel] [--dir PATH] [--write]`.
- Writes `.researchloop/scratchpad/hypotheses/<slug>.md` with required sections: `mechanism`, `why this beats baseline`, `why this might fail`, `smallest test`, `expected metric movement`, `kill criterion`, `implementation surface (files / configs)`, `evidence source (paper id, run id, or null)`.
- `--novel` requires `mechanism` to differ from prior runs' mechanisms (heuristic: not just a parameter delta on a known mechanism).

**Acceptance.**
- Each hypothesis cites at least one paper note, prior run, or explicit `evidence: null`.
- Every required section is non-empty.
- `--novel` mode rejects hypotheses whose `mechanism` matches `"hyperparameter sweep"`, `"lr search"`, or a documented sweep marker list.

**Test plan.** `scripts/test-hypothesis.sh` covers `--from-papers` (with a frozen paper note fixture), `--from-runs`, and `--novel` rejection of a parameter-sweep proposal.

**Files owned.** `bin/researchloop.js`, `templates/prompts/hypothesis.md`, `scripts/test-hypothesis.sh`, `examples/fixtures/hypotheses/`.

**Depends on.** G29 (papers) and/or existing runs ledger. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G01 — `autoresearch propose`: concrete experiment plans

**Motivation.** Today `autoresearch idea` prints a chat prompt for an agent. There is no command that *itself* writes a structured, ranked list of concrete experiments to disk. Autonomous agents need a machine-readable starting backlog.

**Deliverables.**
- New subcommand `autoresearch propose [--n 10] [--write] [--focus hyperparameters|architecture|attention|data] [--mode propose|novel|autonomous]`.
- Output file `.researchloop/scratchpad/proposals.jsonl` — one JSON object per proposal with keys: `id`, `title`, `hypothesis`, `change` (config / code diff sketch), `metric`, `expected_direction`, `estimated_minutes`, `est_cost_usd_or_null`, `risk` ∈ {low, med, high}, `priors` (array of paper/run refs), `kill_criterion`, `mechanism`, `mode`, `created_at`.
- Reads `goal.md`, `repo-profile.json`, `runs.jsonl`, `scratchpad/papers/*.md`, `scratchpad/hypotheses/*.md`.
- `--mode novel` enforces non-empty `mechanism` + `kill_criterion`; `--mode propose` keeps them optional.

**Acceptance.**
- `autoresearch propose --n 5 --write` in a fixture repo with no prior runs produces 5 valid JSONL rows, each with all required keys, and at least one proposal whose `change` references a real file in the fixture.
- Re-running does **not** duplicate `id`s; ids are content-hashed.
- `proposals.jsonl` is valid newline-delimited JSON (each line parses independently).

**Test plan.** `scripts/test-propose.sh` — runs in a temp dir from `examples/fixtures/minimal/`, asserts row count, schema, id-stability across two runs, and `--mode novel` enforcement.

**Files owned.** `bin/researchloop.js`, `templates/prompts/propose.md`, `scripts/test-propose.sh`, `examples/fixtures/minimal/`.

**Depends on.** G26 (baseline check). Soft synergy with G29/G30 for `--mode novel`. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G02 — Idea/proposal ranking with explainable score

**Motivation.** A backlog without a priority order means agents pick the wrong experiment first. Ranking should be reproducible and explainable, not an opaque LLM judgment.

**Deliverables.**
- `autoresearch rank [--input proposals.jsonl] [--write]`.
- Adds two columns to each proposal: `score` (float 0–1) and `score_breakdown` (object with `impact`, `cost`, `risk`, `novelty_vs_runs`, each 0–1 plus a one-line `why`).
- Sort order: descending `score`.
- Writes `.researchloop/scratchpad/ranked-proposals.jsonl` and a `ranked-proposals.md` human view.

**Acceptance.**
- Given a fixed input file, ranking is deterministic across two invocations on the same machine.
- A proposal that duplicates the goal's already-best run in `runs.jsonl` receives `novelty_vs_runs <= 0.2`.
- `score_breakdown.why` is non-empty for every proposal.

**Test plan.** `scripts/test-rank.sh` runs against a frozen `proposals.jsonl` fixture committed under `examples/fixtures/proposals/`. Asserts ordering and field presence.

**Files owned.** `bin/researchloop.js`, `scripts/test-rank.sh`, `examples/fixtures/proposals/`.

**Depends on.** G01. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G03 — Prior-art lookup per proposal

**Motivation.** `scan-papers` runs once at the goal level. We need a per-proposal arXiv + GitHub-style search to attach priors to each idea before an agent commits to running it.

**Deliverables.**
- `autoresearch priors --proposal <id> [--limit 5]` — appends a `priors` array to that proposal's row and writes per-paper notes under `scratchpad/papers/` if missing (reuses the G29 paper-note schema).
- Reuses the existing arXiv fetch path; falls back gracefully when offline (uses cached XML).

**Acceptance.**
- For a proposal mentioning "learning rate warmup", at least one returned prior contains the substring "warmup" in title or abstract.
- Re-running with the same `--proposal` does not duplicate `priors` entries (deduped by arXiv id).
- Offline mode succeeds when an XML fixture exists, fails clearly otherwise.

**Test plan.** Extend `test-scan-papers.sh` to drive a `priors` lookup against the existing XML fixture; assert dedup on re-run.

**Files owned.** `bin/researchloop.js`, additions to `scripts/test-scan-papers.sh`.

**Depends on.** G01, G29 (shared paper-note schema). **Effort.** S. **Agent role.** Worker — CLI feature.

---

## Tier 2 — Evaluation layer

### G04 — Pluggable evaluation runner (minimal `eval.yaml` schema)

**Motivation.** Today `goal.md` pins a single primary metric parsed via regex from training stdout. Real research tracks several metrics and runs eval scripts separately. We need a structured eval contract — but only the metrics portion lands in G04; curves, gates, early-stop, retry, and checkpoint sections are each owned by their downstream goals.

**Deliverables.**
- File `.researchloop/eval.yaml` declaring: `metrics` (list of `{name, direction, regex_or_jsonpath, source: stdout|file}`), `eval_command`.
- Schema reserves keys `gates`, `curves`, `early_stop`, `retry`, `checkpoint_glob`, `resume_flag_template` for future goals to populate. The file is valid with only `metrics` and `eval_command` present.
- `autoresearch eval [--run-id ID] [--command CMD]` — runs the eval command, parses *all* declared metrics, appends them to the matching row in `runs.jsonl` under a `metrics` object.
- `autoresearch run` automatically calls `eval` post-train if `eval.yaml` exists.

**Acceptance.**
- A run row after `autoresearch run` + auto-eval contains every declared metric, each with a numeric value.
- If a metric regex does not match, that metric's value is `null` and `runs.jsonl` records a `parse_warnings` array on the row — the command does not crash.
- `autoresearch compare --metric val_acc --direction higher` works on rows produced this way.

**Test plan.** `scripts/test-eval.sh` uses a deterministic shell script that prints fake `val_loss=0.42` and writes `eval.json` with `val_acc=0.91`. Negative case: missing regex match yields `null` and a warning, exit 0.

**Files owned.** `bin/researchloop.js`, `templates/base/eval.yaml`, `scripts/test-eval.sh`.

**Depends on.** None. **Effort.** M. **Agent role.** Worker — CLI feature. **Integration owner for `eval.yaml`.**

---

### G05 — Promotion gates: keep / discard runs by rule

**Motivation.** Right now every run is equal in the ledger. Agents need to know "this beat the bar, promote it" vs "this is below baseline, archive it" without human review.

**Deliverables.**
- `gates` section in `eval.yaml`: list of rules like `{metric: val_loss, op: "<", value: "{baseline}-0.02"}`.
- After `autoresearch eval`, each run row gets `status` ∈ {`promoted`, `kept`, `discarded`} and `gate_reasons` (array).
- `autoresearch promote <run-id>` manually flips a row to `promoted` and copies its config + diff snapshot into `.researchloop/winners/<run-id>/`.

**Acceptance.**
- A run that beats baseline by the configured delta auto-flips to `promoted`.
- A run with `val_loss` worse than baseline auto-flips to `discarded` with at least one `gate_reasons` entry.
- `winners/<run-id>/` after promotion contains at minimum `goal.md` snapshot, the row JSON, and a `command.txt`.

**Test plan.** `scripts/test-gates.sh` — three deterministic runs: one above bar, one below, one borderline; assert correct `status` for each.

**Files owned.** `bin/researchloop.js`, `scripts/test-gates.sh`.

**Depends on.** G04. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G06 — Train/val curve capture

**Motivation.** A single end-of-run metric is not enough to debug or compare. We need per-step curves stored in a structured format that the dashboard can plot.

**Deliverables.**
- During `autoresearch run`, parse lines matching declared curve regexes and append each point to `.researchloop/scratchpad/curves/<run-id>.jsonl`.
- Curve regex declared in `eval.yaml` under `curves: [{name, regex, fields: [step, train_loss, val_loss]}]`.
- New API endpoint `/api/curves?run=<id>` on the dashboard returns the parsed series.

**Acceptance.**
- Given a deterministic training script that prints 50 step lines, the corresponding `curves/<run-id>.jsonl` has exactly 50 rows with monotonic `step`.
- `/api/curves?run=<id>` returns a JSON array of the same length.
- Curves persist across CLI process restarts (they are flushed per-step, not at end).

**Test plan.** `scripts/test-curves.sh` — deterministic script emitting 50 step lines; assert row count, schema, and that the dashboard endpoint returns the array.

**Files owned.** `bin/researchloop.js`, `templates/dashboard/api/curves.js` (or equivalent), `scripts/test-curves.sh`.

**Depends on.** G04. **Effort.** M. **Agent role.** Worker — CLI feature.

---

## Tier 3 — Reliability & reproducibility

### G09 — Checkpoint capture and `autoresearch resume`

**Motivation.** Long runs crash. We currently lose all in-flight state. The CLI should be able to resume a partial run from its last checkpoint.

**Deliverables.**
- Declared in `eval.yaml`: `checkpoint_glob: "checkpoints/*.pt"` and `resume_flag_template: "--resume {path}"`.
- During `run`, the CLI records the newest matching checkpoint path on each successful step into the run row's `last_checkpoint`.
- `autoresearch resume <run-id>` re-launches the original command with the resume flag appended.

**Acceptance.**
- After a 50-step run that writes `checkpoints/step_50.pt`, the run row in `runs.jsonl` has `last_checkpoint` ending in `step_50.pt`.
- `autoresearch resume <run-id>` prints the exact command it will execute, including the resume flag; with `--dry-run` it does not execute.
- If no checkpoint exists, `resume` exits non-zero with a clear error.

**Test plan.** `scripts/test-resume.sh` — script `touch`es checkpoint files mid-run; assert `last_checkpoint` and `--dry-run` output.

**Files owned.** `bin/researchloop.js`, `scripts/test-resume.sh`.

**Depends on.** G04. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G10 — Replay and reproducibility diff

**Motivation.** A run's value depends on whether the result is reproducible. Agents need a one-shot to verify.

**Deliverables.**
- `autoresearch replay <run-id> [--n 1] [--tolerance 0.01]`.
- Re-executes the stored command, captures fresh metrics, writes them as a new row tagged `replay_of: <run-id>`, and prints a diff table.
- Exits non-zero if any primary metric differs by more than `--tolerance` (absolute or relative — declared per metric in `eval.yaml`).

**Acceptance.**
- Replaying a deterministic command yields the same metrics; the command exits 0.
- Replaying a deliberately non-deterministic command reports a non-zero diff and exits non-zero.
- Replay rows carry both `replay_of` and a fresh `id`.

**Test plan.** `scripts/test-replay.sh` — deterministic and non-deterministic fixtures; assert exit codes and diff output.

**Files owned.** `bin/researchloop.js`, `scripts/test-replay.sh`.

**Depends on.** G04, G14. **Effort.** S. **Agent role.** Worker — CLI feature.

---

### G11 — NaN / divergence early-stop

**Motivation.** A diverged run wastes hours of compute. The runner should kill it as soon as it can prove it has diverged.

**Deliverables.**
- `eval.yaml` section: `early_stop: [{metric: train_loss, rule: "nan_or_inf", action: kill}, {metric: val_loss, rule: ">10x_baseline_after_step_500", action: kill}]`.
- `autoresearch run` evaluates rules after each parsed curve point; on trigger sends SIGTERM, waits, sends SIGKILL, records `status: "killed_by_rule"` and `kill_reason` on the row.

**Acceptance.**
- A training fixture that prints `train_loss=nan` at step 5 is killed within 2 s and the row carries `kill_reason: "nan_or_inf train_loss"`.
- A normal run is not affected.

**Test plan.** `scripts/test-early-stop.sh` covers the NaN case, the diverged-vs-baseline case, and a normal control.

**Files owned.** `bin/researchloop.js`, `scripts/test-early-stop.sh`.

**Depends on.** G04, G06. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G12 — OOM / hardware retry policy

**Motivation.** OOM and CUDA errors are routine; agents shouldn't manually halve batch size every time.

**Deliverables.**
- `eval.yaml` section: `retry: [{match: "CUDA out of memory|RuntimeError: out of memory", transform: "halve:batch_size", max_retries: 2}]`.
- On match in stderr, the runner mutates the command per the transform and re-runs, recording each attempt as a new row with `retry_of: <original-id>`.

**Acceptance.**
- A fixture command that prints "CUDA out of memory" on first invocation but succeeds on second (driven by an attempt counter file) produces exactly two rows: one failed with `retry_reason`, one succeeded with `retry_of`.
- `max_retries: 0` disables retries.

**Test plan.** `scripts/test-retry.sh` with the attempt-counter fixture.

**Files owned.** `bin/researchloop.js`, `scripts/test-retry.sh`.

**Depends on.** G04. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G31 — `autoresearch doctor --repair-plan`

**Motivation.** `doctor` today reports problems. It should also propose ordered fixes — without auto-installing anything.

**Deliverables.**
- `autoresearch doctor --repair-plan [--dir PATH]` emits an ordered checklist for common issues: missing interpreter, missing dependency, wrong working directory, command timeout, no metric parsed from last run, partial `.researchloop/` scaffold.
- Each item maps to a one-line shell-safe fix. Doctor never executes them; it prints them.

**Acceptance.**
- A repo missing Python prints a top-priority "install Python" item.
- A repo with a run that produced no metric prints a "no metric matched" item with the regex from `eval.yaml`.
- Doctor does not install or change anything; exit code reflects whether *any* issue was found.

**Test plan.** `scripts/test-doctor-repair.sh` covers no-metric, missing-command, partial-scaffold cases.

**Files owned.** `bin/researchloop.js`, `scripts/test-doctor-repair.sh`.

**Depends on.** None. **Effort.** S. **Agent role.** Worker — CLI feature.

---

### G32 — Per-run artifact directory contract

**Motivation.** Every `run` and `baseline` already creates a per-run directory at `.researchloop/scratchpad/runs/<id>/`, but writes only `log.txt` into it. "Reproducible" needs more than env capture in a JSONL row — it needs a self-describing on-disk artifact bundle that downstream tools (replay, promote, dashboard, external trainers) can consume without re-parsing `runs.jsonl`.

**Deliverables.** After every `run` / `baseline`, the run directory contains:

- `log.txt` — already exists, unchanged.
- `env.json` — standalone copy of the same `env` object already written to `row.env` (dual-write).
- `code.diff` — `git diff HEAD` captured at run start; empty file when working tree is clean.
- `config.json` — autoresearch invocation context: inner command, run id, metric, metric regex, timeout, allow_unsafe flag, baseline-vs-run, started_at.
- `metrics.jsonl` — one line per parsed metric sample (`{step, metric, value}`); dual-write of `row.metric_history`.
- `system.jsonl` — periodic `os.loadavg()` + `os.totalmem()` + `os.freemem()` samples while the command runs (default every 5s; opt out with `--no-system-sampling`).
- `MANIFEST.json` — inventory of every file in the directory with `{path, size_bytes, sha256}`, plus `generated_at`. Written last.

The child process receives `RESEARCHLOOP_RUN_DIR` as an environment variable so training scripts can write their own artifacts (e.g. `predictions.jsonl`, custom configs) into the same directory; the manifest will pick them up automatically.

**Acceptance.**
- After a successful `autoresearch run --command "echo val_loss=0.42"` against a temp repo, the run directory contains exactly: `log.txt`, `env.json`, `code.diff`, `config.json`, `metrics.jsonl`, `system.jsonl`, `MANIFEST.json`.
- `MANIFEST.json` lists each of those files with a real size and a valid sha256 hex digest; the hash of `log.txt` re-computed by an external tool matches the manifest.
- `env.json` parses as JSON and contains the same keys as `row.env` in `runs.jsonl`.
- `--no-system-sampling` suppresses `system.jsonl` entirely.
- `code.diff` is empty for a clean tree; non-empty when an unstaged file change is present.
- Existing tests (`npm test`) continue to pass; no schema changes to `runs.jsonl` (this goal is additive on disk).

**Test plan.** `scripts/test-artifact-contract.sh` runs a fake command in a temp git repo, asserts the file list, validates JSON shape of `env.json` / `config.json` / `MANIFEST.json`, recomputes sha256 for one file and compares, exercises the `--no-system-sampling` flag, exercises the dirty-tree `code.diff` case.

**Files owned.** `bin/researchloop.js` (artifact writer functions + integration in `cmdRunOrBaseline`), `scripts/test-artifact-contract.sh` (new), `package.json` (wire test into `npm test`).

**Depends on.** None. Builds on G14 (env capture, shipped). Forward-compatible with G06 (curves), G09 (checkpoints), G30 (provenance) — those goals add files into the same dir, the manifest captures them. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

## Tier 4 — Scale (sweeps, multi-agent, query)

### G07 — Sweep generator (grid / random / list)

**Motivation.** Agents hand-write `--lr 1e-3`, `--lr 3e-3` runs one at a time. A sweep spec turns one declarative file into a queue of concrete runs.

**Deliverables.**
- File `.researchloop/sweeps/<name>.yaml` with shape:
  ```yaml
  base_command: "python train.py"
  strategy: grid  # grid | random | list
  budget: 12      # max runs (random) or hard cap (grid)
  params:
    lr: {type: log_uniform, min: 1e-5, max: 1e-2}
    batch_size: {type: choice, values: [32, 64, 128]}
  ```
- `autoresearch sweep generate <name>` — emits `.researchloop/sweeps/<name>.queue.jsonl`, one row per planned run with the resolved command, id, and param dict.
- `autoresearch sweep status <name>` — counts queued / running / done / failed by joining queue against `runs.jsonl`.

**Acceptance.**
- A grid sweep with `lr ∈ {1e-4, 1e-3}` and `batch_size ∈ {32, 64}` produces exactly 4 unique rows with stable ids.
- A random sweep with `budget=10` produces 10 rows; re-running with the same `seed` field produces identical rows.
- Queue file is valid JSONL.

**Test plan.** `scripts/test-sweep.sh` covers grid, random+seed, and list strategies against committed spec fixtures.

**Files owned.** `bin/researchloop.js`, `templates/base/sweeps/example.yaml`, `scripts/test-sweep.sh`.

**Depends on.** None. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G08 — Parallel run scheduler

**Motivation.** A queue with no runner is useless. We need a worker that consumes the queue and executes runs with bounded concurrency.

**Deliverables.**
- `autoresearch sweep run <name> [--workers N] [--max-failures K]`.
- Workers are Node child processes. Each claims one queue row using the shared filesystem-mutex primitive defined in G18, runs the command, parses metrics via the existing pipeline, marks the row `done` or `failed`.
- Live progress to stdout: `[3/12] lr=3e-4 batch=64 -> val_loss=0.41 (28s)`.

**Acceptance.**
- A 12-row queue runs to completion under `--workers 4` with no double-claims (each row appears exactly once in `runs.jsonl`).
- Killing the runner mid-sweep (SIGINT) leaves claim files such that a re-run resumes only the unfinished rows.
- `--max-failures 2` stops the sweep after the second failure.

**Test plan.** `scripts/test-sweep-run.sh` — queue of 6 deterministic shell commands, 2 of which exit non-zero. Assert ledger has 6 rows, 4 success / 2 failure, and that a follow-up `sweep run` is a no-op.

**Files owned.** `bin/researchloop.js`, `scripts/test-sweep-run.sh`. Mutex primitive lives in the G18 module.

**Depends on.** G07, G18 (shared mutex). **Effort.** M–L. **Agent role.** Worker — CLI feature.

---

### G18 — Worker daemon: agents pull from a shared task queue

**Motivation.** Multi-agent today is a static markdown board. We need a real queue that multiple agent processes can claim from without stepping on each other. The mutex primitive built here is reused by G08.

**Deliverables.**
- `autoresearch tasks add <description> [--lane worker|reviewer|orchestrator] [--depends <task-id>]` writes to `.researchloop/tasks.jsonl`.
- `autoresearch tasks claim --agent <name> --lane <lane>` atomically claims the next unblocked task and prints it as JSON. Claim semantics use a filesystem-mutex pattern (writing to `.researchloop/<scope>.lock/<row-id>` files, no external dep). The same primitive is exposed as a small internal module reused by G08.
- `autoresearch tasks done <task-id> [--note "..."]` marks a task done.
- `autoresearch tasks status` prints the board grouped by lane.

**Acceptance.**
- Two simultaneous `claim` invocations against a single-task queue: exactly one wins, the other returns `no-task`.
- A task with an unmet dependency is not claimable.
- The board view shows all three lanes and per-lane counts.

**Test plan.** `scripts/test-tasks.sh` spawns two background `claim` calls and asserts the win/no-task pattern; covers deps and done.

**Files owned.** `bin/researchloop.js` (mutex module + tasks subcommand), `scripts/test-tasks.sh`.

**Depends on.** None. Replaces the static `team` board over time but does not delete it. **Effort.** M. **Agent role.** Worker — CLI feature. **Integration owner for the mutex primitive.**

---

### G19 — Auto-reviewer gate before promotion

**Motivation.** The reviewer lane today is a markdown brief. We want an automated review step a winning run must pass before `promote` succeeds.

**Deliverables.**
- `autoresearch review <run-id>` runs configured checks declared in `.researchloop/review.yaml`:
  - All declared metrics present and finite.
  - Env captured (G14) and `git_dirty: false`.
  - Curve length ≥ minimum (G06).
  - Replay within tolerance (G10) — opt-in via flag, since it spends compute.
- Outputs a markdown report `winners/<run-id>/review.md` and exits non-zero on failure.
- `promote` is blocked unless `review` has succeeded for the run.

**Acceptance.**
- A run with a dirty git tree fails review with a clear reason.
- A run that passes all checks gets a green `review.md` and is promotable.
- `promote --skip-review` is the only bypass and emits a loud warning.

**Test plan.** `scripts/test-review.sh` covers pass case, dirty-tree fail case, missing-metric fail case.

**Files owned.** `bin/researchloop.js`, `templates/base/review.yaml`, `scripts/test-review.sh`.

**Depends on.** G05, G06, G14. Optional G10. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G13 — `autoresearch query` over runs.jsonl

**Motivation.** `compare` and `report` are fixed views. Agents need ad-hoc filters: "show all runs where lr > 1e-3 AND val_loss < 0.5 sorted by val_acc desc".

**Deliverables.**
- `autoresearch query "<expression>" [--format jsonl|table]`.
- Expression grammar: `where <predicate> [and <predicate>...] sort-by <metric> [asc|desc] limit <n>`.
- Predicates support `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `between a..b` on any field in a row including nested `metrics.*` and `params.*`.

**Acceptance.**
- `autoresearch query "where metrics.val_loss < 0.5 sort-by metrics.val_loss asc limit 3"` returns 0–3 rows in valid JSONL.
- Invalid syntax produces a clear one-line error and exits non-zero.
- Empty result set exits 0 with no output (table format prints an empty header row).

**Test plan.** `scripts/test-query.sh` against a frozen `runs.jsonl` fixture; cover positive match, no match, syntax error, nested field, limit.

**Files owned.** `bin/researchloop.js`, `scripts/test-query.sh`, `examples/fixtures/runs/`.

**Depends on.** None (works against the existing ledger; works *better* with G04 metrics). **Effort.** M. **Agent role.** Worker — CLI feature.

---

## Tier 5 — Reporting & dashboard

### G20 — Auto-generated experiment report

**Motivation.** A scientist's deliverable is a report, not a JSONL. We should be able to render the current state of the loop into a paper-shaped markdown.

**Deliverables.**
- `autoresearch report --format markdown --out report.md [--include-plots]`.
- Sections: Goal, Baseline, Best run, Sweep summary, Loss curves (referencing SVGs written to `report-assets/`), Discarded results, Open questions.
- Plots are simple SVGs written via the same code path as G15's charts (no Python, no extra dep).

**Acceptance.**
- Running on a populated ledger produces a `report.md` ≥ 50 lines with every section header present.
- All claims about runs in the report reference a real run id present in the ledger.
- `--include-plots` writes at least one SVG into `report-assets/`.

**Test plan.** `scripts/test-report.sh` against a frozen ledger; assert section headers, run-id references, SVG file count.

**Files owned.** `bin/researchloop.js`, `templates/prompts/report.md`, `scripts/test-report.sh`.

**Depends on.** G04. **Effort.** M. **Agent role.** Worker — CLI feature.

---

### G21 — Claim audit

**Motivation.** Agent-written reports often hallucinate gains. Every numeric claim should resolve to a ledger row.

**Deliverables.**
- `autoresearch audit <file.md>` scans the file for patterns like `\b(\d+\.\d+|\d+%)\b` near keywords (loss, accuracy, perplexity, F1) and tries to match each to a ledger row's metric within tolerance.
- Output: a markdown table of `claim_line, claim_value, matched_run_id_or_null`. Exits non-zero if any claim is unmatched.

**Acceptance.**
- A report that says "val_loss=0.42 on run lr-3e-4" with a matching ledger row passes audit.
- The same report with a fabricated 0.31 fails audit with one unmatched claim.

**Test plan.** `scripts/test-audit.sh` covers both cases.

**Files owned.** `bin/researchloop.js`, `scripts/test-audit.sh`.

**Depends on.** G20. The existing skill pack `claim-audit/SKILL.md` is the spec source for tolerances. **Effort.** S–M. **Agent role.** Worker — CLI feature.

---

### G23 — Cost and wall-clock accounting

**Motivation.** "What did this experiment cost?" should be answerable. Today we have no time recorded per run.

**Deliverables.**
- During `run`, record `started_at`, `ended_at`, `wall_seconds`.
- Optional `.researchloop/cost.yaml`: `gpu: H100, hourly_usd: 2.50` — multiplied by `wall_seconds / 3600` to populate `est_cost_usd` per row.
- `autoresearch report` adds a "Cost" row to the per-run section.

**Acceptance.**
- Every new run row carries `wall_seconds`.
- With `cost.yaml` present, `est_cost_usd` is non-null and equals `wall_seconds / 3600 * hourly_usd` to 4 decimal places.
- Without `cost.yaml`, `est_cost_usd` is `null` and no error is raised.

**Test plan.** `scripts/test-cost.sh` with a 2-second deterministic run; assert wall time bounds and cost arithmetic.

**Files owned.** `bin/researchloop.js`, `scripts/test-cost.sh`.

**Depends on.** None. **Effort.** S. **Agent role.** Worker — CLI feature.

---

### G15 — Live charts on the dashboard

**Motivation.** The current dashboard is a static HTML page that polls JSON. It does not plot. Agents and humans need at minimum a metric-over-runs scatter and a per-run loss curve.

**Deliverables.**
- Add two charts to `templates/dashboard/index.html`:
  1. **Run scatter** — x = run index (chronological), y = primary metric, color = `status`.
  2. **Curve overlay** — per-run loss curves from `/api/curves`, multi-select up to 5 runs.
- No external CDN dependency at install time — vendor a small chart lib (or hand-rolled SVG) into `templates/dashboard/`.
- Auto-refresh every 5 s while charts are visible.

**Acceptance.**
- With 6 rows in `runs.jsonl` (3 done, 2 failed, 1 running), the scatter shows 6 dots in 3 colors.
- Selecting 2 runs in the curve overlay renders 2 lines; selecting "none" shows an empty plot, not an error.
- The dashboard works fully offline (no network requests after page load).

**Test plan.** `scripts/test-dashboard.sh` extended: spin up the server, fetch `/`, assert the chart container IDs are present and the vendored asset is shipped in the npm tarball. Manual: open `http://127.0.0.1:8787` against a seeded fixture and screenshot.

**Files owned.** `templates/dashboard/`, additions to `scripts/test-dashboard.sh`.

**Depends on.** G06 (curves endpoint) for the second chart; first chart can ship without G06. **Effort.** M. **Agent role.** Worker — frontend.

---

### G16 — Run-diff view

**Motivation.** "Why did run B beat run A?" needs a side-by-side of config + metrics + env + curve.

**Deliverables.**
- Dashboard route `/diff?a=<id>&b=<id>` rendering a two-column table: params, metrics, env, with cells highlighted where values differ.
- JSON endpoint `/api/diff?a=<id>&b=<id>` returning `{shared, only_in_a, only_in_b, differences: [{path, a, b}]}`.

**Acceptance.**
- Diffing a run against itself returns `differences: []`.
- Diffing two runs that only differ in `params.lr` returns exactly one differences row with path `params.lr`.
- 404 for unknown run ids.

**Test plan.** Extend `test-dashboard.sh` with three HTTP cases.

**Files owned.** `templates/dashboard/`, additions to `scripts/test-dashboard.sh`.

**Depends on.** G14 for env diff to be meaningful; G15 visual layer. **Effort.** S–M. **Agent role.** Worker — frontend.

---

### G17 — Experiment lineage view

**Motivation.** Runs branch — a promoted run is the parent of next-iteration runs. Today this lineage is invisible.

**Deliverables.**
- Each run row gains an optional `parent_id` (auto-set by `replay`, `resume`, and by `propose` when a proposal references a prior run; otherwise `null`).
- Dashboard route `/lineage` renders a simple tree (indented list is acceptable; SVG tree is bonus).
- API: `/api/lineage` returns `{roots: [{id, children: [...]}]}`.

**Acceptance.**
- A ledger with one root and two children renders one tree of depth 2.
- Orphans (no parent, no children) appear as their own one-node trees.
- The API output is stable across requests for a fixed ledger.

**Test plan.** `scripts/test-lineage.sh` seeds a frozen ledger, hits the API, asserts tree shape.

**Files owned.** `templates/dashboard/`, `scripts/test-lineage.sh`.

**Depends on.** G09 + G10 (populate `parent_id`). **Effort.** S. **Agent role.** Worker — frontend.

---

## Tier 6 — Integrations

### G22 — Optional Weights & Biases / MLflow export

**Motivation.** Many users already have a tracker. Don't force them off it; offer one-way export.

**Deliverables.**
- `autoresearch export --to wandb [--project X]` and `--to mlflow [--uri ...]`.
- Each row in `runs.jsonl` becomes one external run; metrics, params, env, curves all pushed. Idempotent.
- Both integrations are *optional* runtime imports — the CLI does not list them as deps.

**Acceptance.**
- Without `wandb` installed, the command prints a clear "install with `pip install wandb`" message and exits non-zero.
- With it installed and `WANDB_API_KEY` set, a 3-row ledger pushes 3 W&B runs; a second invocation pushes 0 new runs.

**Test plan.** Mocked: a fake `wandb` python module that records calls to a temp file; assert call counts.

**Files owned.** `bin/researchloop.js`, `scripts/test-export.sh`.

**Depends on.** G04, G06, G14. **Effort.** M. **Agent role.** Worker — integrations.

---

### G24 — Slack / webhook notifications

**Motivation.** A long sweep finishing while you're at lunch is invisible. A webhook fixes that.

**Deliverables.**
- `.researchloop/notify.yaml`: `webhooks: [{url: ..., events: [run_done, run_failed, sweep_done, promotion]}]`.
- Posts a JSON body per event; payload includes `event`, `run_id`, `metrics`, `goal`, `link` (to local dashboard if reachable).

**Acceptance.**
- A test webhook (local netcat or a fixture HTTP receiver) receives exactly one payload per matching event.
- Webhook failure does not crash the CLI; it logs to stderr and continues.

**Test plan.** `scripts/test-notify.sh` spins up a Node HTTP server, runs an event-emitting flow, asserts the bodies received.

**Files owned.** `bin/researchloop.js`, `scripts/test-notify.sh`.

**Depends on.** None. **Effort.** S. **Agent role.** Worker — integrations.

---

## Cross-cutting rules (apply to every goal)

- **Do not break existing tests.** Every goal here must keep `npm test` green. New tests under `scripts/test-*.sh` must be added to the aggregate in `package.json` and to the matrix expected by CI.
- **No new runtime dependencies** unless the goal genuinely cannot be done with stdlib Node. The package is currently zero-dep and that is a feature.
- **Keep file formats simple.** Prefer JSONL + YAML/JSON config over invented binary or database formats. SQLite is acceptable only inside `dashboard` if read-only views become unwieldy.
- **Every goal adds at least one test file under `scripts/`** matching the existing bash-integration-test style. Do not introduce a new test framework.
- **Update `docs/getting-started.md` and any affected skill pack under `skills/researchloop-autoresearch/`** when shipping a new command. The skill pack is the spec; the CLI is the execution.
- **One integration owner per shared file.** Workers stage changes; the integration owner merges. Default integration owner for `bin/researchloop.js` is the reviewer lane.

---

## Suggested run order

1. **Tier 0 first**, in parallel: G25 (safety) + G14 (env). Two agents.
2. **Tier 1 in parallel**: G26 → G27 (sequential within baseline lane). G28 (topic). G29 → G30 (sequential within paper lane). G01 → G02 → G03 (sequential within ideation lane). Up to ~5 agents.
3. **Tier 2 sequentially within itself**: G04 (eval.yaml minimal) first. Then G05 + G06 in parallel.
4. **G00 dogfood pass.** Run the loop end-to-end on `llm-research-kit` with whatever has shipped. Pin shortcomings to specific G##s in Tiers 3+ — promote whatever is most painful first.
5. **Tier 3**, in parallel: G09, G10, G11, G12, G31. Up to 4 agents.
6. **Tier 4**, sequentially within sweeps + queue lane: G18 (mutex first) → G08. G07 in parallel. G19 once G05+G06+G14 are in. G13 anytime.
7. **Tier 5**, in parallel after Tier 2/3 stable.
8. **Tier 6** last, only if a user asks.

---

## Release rule

Each release ships one visible improvement to the research loop. Before publishing:

- README and getting-started docs match the behavior.
- Prompt templates match the behavior.
- Tests cover the new command or workflow.
- Packed package includes the right templates and excludes local-only files.
- The copy-paste agent prompt still starts with first-contact and baseline state.
- The dogfood loop (G00) still completes for whichever subset of features is current.
