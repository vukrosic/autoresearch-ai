# Feature ideas for AI researchers

Brainstorm of features beyond what's already in [GOALS.md](../GOALS.md). Not a commitment — a backlog of "would this help a researcher?" ideas, grouped by the phase of work they support. Promote items into `GOALS.md` as G## entries when we're ready to build them.

---

## 1. Evidence & literature

- **`paper-graph`** — build a local citation graph from `scratchpad/papers/`, render as DOT/markdown. Lets the agent see clusters of related work.
- **`paper-reread <id> --against <run-id>`** — re-read a paper note in the context of a finished run. Forces the agent to ask "did this result actually match what the paper predicted?"
- **`lit-diff`** — given two paper notes, produce a 1-paragraph "what's actually different about these methods" summary. Cheap antidote to surface-level novelty claims.
- **Negative-results archive** — `autoresearch archive <run-id> --reason "..."` writes to `.researchloop/dead-ends/`, queryable so the agent doesn't re-try the same failed mechanism.
- **Contamination check** — scan eval datasets against a list of known-leaked corpora (MMLU, HumanEval, etc.). Warn if overlap detected.

## 2. Hypothesis & experiment design

- **Power / sample-size calculator** — given a baseline metric and its noise, estimate how many seeds are needed to detect a delta of X with 95% confidence. Stops underpowered claims.
- **Ablation generator** — `autoresearch ablate <run-id>` emits N proposals each turning off one component of the winning config. Forces structured ablation instead of vibes.
- **Compute-optimal calculator** — Chinchilla-style: given a parameter count and FLOPs budget, suggest tokens/batch/steps. Or invert: given a dataset size, suggest a model size.
- **Sensitivity analysis** — for a finished sweep, report which params actually mattered (variance contribution per param). Replaces "I tried a bunch of things, lr seems important."
- **Pre-flight cost forecast** — `autoresearch forecast <command>` reads the command + config and estimates wall-clock and $ before running. Refuses experiments that exceed budget without `--confirm`.

## 3. Running & monitoring

- **Hyperparameter optimizer plugins** — beyond grid/random (G07): ASHA, Hyperband, simple Bayesian (Gaussian process or TPE). Each ships as an opt-in strategy in `sweeps/*.yaml`.
- **Multi-objective / Pareto sweeps** — when two metrics matter (loss + latency, acc + size), emit the Pareto frontier instead of a single winner.
- **Gradient / activation health probe** — opt-in hook that logs grad-norm, NaN counts, dead-neuron %. Surfaces in the dashboard as a per-step series.
- **Tensor stats dump on crash** — when `run` hits a crash, write a `tensors.json` (last-known shapes, dtypes, norms from any tagged module) into the run dir.
- **Preemption-safe resume** — handle SIGTERM gracefully: flush curves, write `last_checkpoint`, exit 0 with `status: preempted` so cluster schedulers can requeue.
- **GPU / memory profiler** — sample `nvidia-smi` (or rocm-smi) into `gpu.jsonl` next to `system.jsonl`. Compute MFU if model FLOPs are declared.
- **Energy / carbon tracking** — extend `cost.yaml` with `kwh_per_gpu_hour` + grid region; per-run kWh and gCO2e in the report.
- **Live `tail` for the dashboard** — websocket stream of stdout so researchers don't ssh into the box.

## 4. Reproducibility & determinism

- **Global seed control** — `autoresearch seed N` writes a seed config consumed via env vars by training scripts (Python, NumPy, Torch, JAX). Records seed lineage.
- **Determinism audit** — `autoresearch determinism <run-id>` runs the same command 3× and reports the metric variance. Flags non-determinism (cudnn, dataloader workers, etc.) with likely causes.
- **Hardware-aware replay** — when `replay` runs on a different GPU than the original, widen the tolerance and label the result `replay_cross_hardware`.
- **Container snapshot** — opt-in `--snapshot-container` writes the active `pip freeze` + `requirements.lock` + a Dockerfile fragment into the run dir. Doesn't run Docker; just records what would reproduce it.

## 5. Statistical rigor

- **Confidence intervals everywhere** — `compare` and `report` show bootstrap 95% CI on every metric delta. A single-seed win is shown as a single-seed win.
- **Significance test** — `autoresearch test <run-a> <run-b> [--metric] [--n-seeds-required]` — refuses to declare a winner without enough seeds, prints the t-test or Mann-Whitney result with effect size.
- **Multi-seed runner** — `autoresearch run --seeds 5` produces 5 child rows + 1 aggregate row with mean ± std. `promote` requires multi-seed for "real" wins.
- **Variance-aware ranking** — extend G02 ranking with a `risk_of_noise` factor: a 0.005 improvement on a 0.01-noise baseline scores low even if the mechanism is interesting.

## 6. Evaluation & benchmarks

- **Benchmark suite presets** — `autoresearch bench add mmlu|humaneval|gsm8k|...` drops a ready-to-run eval config that plugs into `eval.yaml`.
- **LLM-as-judge harness** — for open-ended tasks, declare a judge model in `eval.yaml`; results land in `metrics` like any other.
- **Bias / fairness probe** — optional metric category that runs a fairness-eval suite over slices of the eval set.
- **Held-out canary set** — declare a "never-train-on" canary in `eval.yaml`; the runner warns/fails if any tokens from canary appear in training data hashes.

## 7. Data pipeline

- **Dataset versioning** — `autoresearch data snapshot <path>` writes a content hash + row count + schema hash. Runs reference the snapshot id; mismatch warns on replay.
- **Sample inspector** — `autoresearch data sample <path> --n 20` shows a random N rows + token-length distribution + class balance. Saves the inspection report in the run dir.
- **Tokenizer report** — `autoresearch data tokstats <path> --tokenizer X` — counts tokens, OOV rate, length percentiles.

## 8. Authoring & publication

- **Paper draft generator** — `autoresearch draft --template neurips|workshop --out paper.md` fills in baseline, best run, sweep table, curves, ablations. Pure markdown; nothing fancy.
- **LaTeX export** — same as above but emits `.tex` with a minimal preamble. No new dependency unless invoked.
- **Model card generator** — `autoresearch modelcard <run-id>` emits a model card with eval results, training data summary, intended use, limitations.
- **Notebook export** — `autoresearch notebook <run-id>` produces a `.ipynb` that walks through the run with code, params, and chart cells.
- **Citation collector** — every paper note carries a BibTeX block; `autoresearch bib --used-in report.md` collects exactly the entries the report references.

## 9. Knowledge persistence

- **Run similarity search** — `autoresearch similar <run-id> [--k 5]` finds nearest neighbors by param + metric vector. Useful for "have I done this before?"
- **Mechanism dictionary** — `.researchloop/mechanisms.jsonl` (one row per distinct mechanism the agent has tried) so `--mode novel` actually has a corpus to check against.
- **Learning log** — at promotion/discard time, the agent is required to write one paragraph: "what did this experiment teach us?" — stored under `.researchloop/learnings/`.
- **Memory export for agents** — `autoresearch export-memory --to claude-md` writes a CLAUDE.md fragment summarizing baseline, top 3 runs, top 3 dead ends, so a fresh agent starts informed.

## 10. Compute & infrastructure

- **Slurm submit** — `autoresearch submit --to slurm --partition X` wraps any `run`/`sweep run` invocation as an sbatch job. Captures `slurm_job_id` in the row.
- **Ray / Kubernetes runner** — same idea, different backend. Opt-in.
- **Spot instance survival** — `--preemptible` flag enables checkpoint-every-N-minutes + auto-resume on restart.
- **Multi-node detection** — `doctor` notices `WORLD_SIZE > 1` env and verifies NCCL config, expected GPU count per node, etc.

## 11. Developer ergonomics

- **`autoresearch watch`** — file-system watcher: re-run `eval` whenever a results file is updated. Useful when training writes incrementally.
- **`autoresearch diff <run-a> <run-b> --code`** — show the actual git diff between two runs' commits, not just config diff.
- **Plug-in hooks** — `.researchloop/hooks/{pre_run,post_run,on_promote}.sh` execute around lifecycle events. Sandbox-checked by G25.
- **VS Code task generator** — `autoresearch ide vscode` writes `.vscode/tasks.json` with the most common commands.
- **`autoresearch undo`** — revert the last promotion (move the winner back to `runs.jsonl`, restore baseline lock). Hard to do safely; might just be `promote --revert`.

## 12. Collaboration & sharing

- **Run share link** — `autoresearch share <run-id>` packages the run dir into a `.tar.gz` with a manifest. No upload; just a portable bundle.
- **Read-only public dashboard mode** — flag to serve `dashboard` without write endpoints, so collaborators can browse but not promote.
- **Diff-against-main-branch** — for repos with a main/dev branch, show how this branch's best run compares to main's best run.
- **PR-ready bundle** — `autoresearch pr-bundle <run-id>` writes a markdown summary suitable for pasting into a GitHub PR description (with curve images inlined as base64).

## 13. Safety & sanity

- **Pre-flight smoke test** — before launching a 12-hour run, `autoresearch smoke <command>` runs 1 step + 1 eval batch in a sandbox and confirms metrics parse correctly. Cheap insurance.
- **Disk-space guard** — block `run` if free disk < N GB (configurable). Common cause of silent corruption.
- **Stale lock detector** — if a `tasks.jsonl` lock is older than X minutes and the claiming PID is dead, auto-release with a warning.
- **Data leak detector** — at promotion time, check whether any eval-set hashes appear in training data shards. Block promotion if so.

---

## How to use this list

These are seeds for new G## entries, not commitments. When picking the next thing to build:

1. Does it strengthen one of the 7 product-loop steps in [GOALS.md](../GOALS.md#product-loop-what-we-are-building-toward)?
2. Does it create durable evidence (a file, a metric, a check) — or only add orchestration?
3. Could a researcher get the value today without this feature, just with more discipline? If yes, deprioritize.

Bias the next pick toward **statistical rigor** (section 5) and **reproducibility** (section 4) — those are the features that turn the existing loop from "fast experiments" into "trustworthy experiments."
