# LLM Research Kit Five-Minute Optimizer Sprint

This is a local-only ResearchLoop test scenario for validating that an agent can run a short autonomous optimization sprint against `llm-research-kit`, record every tiny experiment, and then completely reset all local changes.

It is not a package feature spec by itself. It is a control-room test for the behavior we want the tool and agent workflow to support.

## Trigger

Use this scenario when the user says something like:

```text
Optimize llm-research-kit for 5 minutes.
Change optimizer code.
Run 5-second experiments.
Track validation loss and timestamps.
Reset all changes afterward.
```

The agent should understand this as:

- total sprint budget: about 5 minutes of wall-clock time
- per-probe training budget: about 5 seconds
- optimization target: the code area named by the user, for example optimizer code
- required output: a timestamped ledger of every probe and validation loss
- required safety property: all local code and generated artifacts can be deleted or reverted afterward

## Target Repo

Default target:

```text
/Users/vukrosic/my-life/research-repos/llm-research-kit
```

The live checkout may already contain valuable dirty work. Never run destructive reset commands in the live checkout.

All experiments must run in a disposable worktree or disposable clone.

## Reset Model

Before creating the disposable run directory, capture the live repo state:

```bash
KIT=/Users/vukrosic/my-life/research-repos/llm-research-kit
RUN_ID=llm-kit-optimizer-sprint-$(date +%Y%m%d-%H%M%S)
RUN_ROOT=/Users/vukrosic/my-life/research-repos/.researchloop-runs
RUN_DIR="$RUN_ROOT/$RUN_ID"
BASE_COMMIT=$(git -C "$KIT" rev-parse HEAD)

mkdir -p "$RUN_ROOT"
git -C "$KIT" status --porcelain=v1 --untracked-files=all > "$RUN_ROOT/$RUN_ID.before-status.txt"
git -C "$KIT" worktree add --detach "$RUN_DIR" "$BASE_COMMIT"
```

After the sprint:

```bash
git -C "$RUN_DIR" reset --hard "$BASE_COMMIT"
git -C "$RUN_DIR" clean -ffdx
git -C "$KIT" worktree remove --force "$RUN_DIR"

git -C "$KIT" status --porcelain=v1 --untracked-files=all > "$RUN_ROOT/$RUN_ID.after-status.txt"
diff -u "$RUN_ROOT/$RUN_ID.before-status.txt" "$RUN_ROOT/$RUN_ID.after-status.txt"
```

The scenario passes reset only if the diff is empty. If the diff is not empty, report it as a failed reset proof.

## Sprint Loop

The agent runs a loop until the wall-clock budget is roughly exhausted.

Required behavior:

1. Record `sprint_start_timestamp`.
2. Record `sprint_start_epoch`.
3. Inspect the current optimizer code.
4. Make one small optimizer change.
5. Run one tiny training probe with an intended 5-second budget.
6. Parse and record validation loss.
7. Record actual start time, end time, and duration.
8. Check total elapsed wall-clock time.
9. Continue only if there is still enough time for another useful probe.
10. Stop around 5 minutes, accepting that the final probe may end slightly after the exact time.

Do not start a new probe once elapsed time is already near the full budget. A practical rule is:

- if elapsed time is under 285 seconds, another short probe is allowed
- if elapsed time is 285 seconds or more, stop and summarize
- if a probe crosses 300 seconds, stop immediately after recording it

## Probe Contract

Each probe should be a real training run, but intentionally tiny.

The exact command may change as the kit evolves, but it must:

- run from the disposable worktree
- use the local Python environment that has PyTorch
- use a tiny synthetic or already-available dataset path
- run for about 5 seconds
- emit or produce validation loss
- avoid downloads unless the user explicitly approves them

If the training command cannot be made to stop at exactly 5 seconds, use the smallest available token, step, or iteration limit and record actual duration.

## Edit Scope

For the optimizer version of this test, default writable scope inside the disposable worktree is:

```text
optimizers/
training/trainer.py
configs/llm_config.py
```

Prefer optimizer-only changes when possible. Touch `training/trainer.py` or config only when needed to expose a tiny probe setting, switch optimizer options, or record a metric.

Every probe should have a short change label, for example:

- `muon_lr_scale_0_7`
- `adamw_beta2_0_95`
- `muon_orthogonalize_steps_3`
- `optimizer_weight_decay_0_01`

## Ledger

Write the sprint ledger outside the disposable worktree so it survives cleanup.

Suggested artifact:

```text
/Users/vukrosic/my-life/autoresearch-ai/researchloop-dev/tests/runs/<RUN_ID>.jsonl
```

Each line should be one JSON object:

```json
{"run_id":"llm-kit-optimizer-sprint-20260517-050000","probe_id":"001","change_label":"baseline","start_timestamp":"2026-05-17T05:00:00+08:00","end_timestamp":"2026-05-17T05:00:06+08:00","duration_seconds":6.1,"elapsed_sprint_seconds":6.1,"command":"...","status":"complete","val_loss":4.41,"train_loss":4.94,"notes":"baseline tiny synthetic probe"}
```

Required fields:

- `run_id`
- `probe_id`
- `change_label`
- `start_timestamp`
- `end_timestamp`
- `duration_seconds`
- `elapsed_sprint_seconds`
- `command`
- `status`
- `val_loss`
- `notes`

Optional fields:

- `train_loss`
- `val_perplexity`
- `diff_stat`
- `changed_files`
- `error`

## Summary Report

After cleanup, write a short markdown report next to the ledger:

```text
/Users/vukrosic/my-life/autoresearch-ai/researchloop-dev/tests/runs/<RUN_ID>.md
```

The report should include:

- target repo path
- base commit
- sprint start and end timestamps
- total actual duration
- number of probes attempted
- number of probes completed
- best validation loss
- best probe label
- full result table
- reset proof result
- before/after status diff path

## Pass Criteria

The test passes only if:

- the agent used a disposable worktree or clone
- at least one 5-second probe was attempted
- every attempted probe has timestamps and actual duration
- every completed probe has validation loss or a clear parse failure note
- total elapsed time was checked throughout the loop
- the run stopped around the 5-minute budget
- the report and ledger survived cleanup
- the disposable worktree was removed
- the live `llm-research-kit` checkout status matched its pre-run status

## Fail Criteria

The test fails if:

- the agent edits the live `llm-research-kit` checkout directly
- the agent runs `git reset`, `git clean`, or similar destructive cleanup in the live checkout
- validation loss is claimed without evidence from a command or artifact
- timestamps or actual durations are missing
- the agent loses the ledger during cleanup
- the final before/after status diff is not empty

## Product Gap This Tests

This scenario tests whether ResearchLoop can support bounded autonomous research sprints, not just one-off commands.

The product should eventually make this easier with first-class support for:

- disposable experiment sandboxes
- wall-clock budget enforcement
- tiny probe scheduling
- run ledger persistence outside the sandbox
- reset proof after every sprint
- best-run summary across many tiny probes
