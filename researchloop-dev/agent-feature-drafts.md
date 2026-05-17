# Agent-feature drafts — wave 1

Source-of-truth for the first 3 issues using the new `agent-feature.yml` template (Researcher / Demo / Composes-with fields). Review here, then `gh issue create` to post.

These are designed so a coding agent (Codex / Claude / Cursor) can implement without follow-up. Every field has been filled to test the template.

---

## Issue 1 — `autoresearch resume`

**Title:** `[agent] resume — reconstruct mid-loop session context`

**Labels:** `agent-friendly`, `claim-next`, `tier-1`, `good first issue`

### Researcher line
An ML researcher coming back the next morning needs `autoresearch` to reconstruct yesterday's state — current goal, baseline, last N runs, open ideas, suggested next experiments — in one command, so their coding agent can pick up the loop without re-reading 200 lines of ledger.

### Demo line
```text
$ autoresearch resume
# RESUME CONTEXT — 2026-05-18 (since 2026-05-17 22:14)

## Goal
lower val_loss (direction: lower)

## Baseline
val_loss: 2.41 — .researchloop/baseline.md

## Last 3 runs
| id          | val_loss | delta  | status  |
| lr-3e-4     | 2.39     | -0.02  | done    |
| lr-1e-4     | 2.43     | +0.02  | done    |
| dropout-0.2 | NaN      | —      | crashed |

## Open ideas (3)
- cosine-scheduler — proposed 2026-05-17
- token-mixer-swap — proposed 2026-05-17

## Next 3 untried, ranked by likely value
1. lr-2e-4 (between 1e-4 and 3e-4, neither beat baseline)
2. dropout-0.1 (smaller than crashed 0.2)
3. cosine-scheduler (from open ideas)
```

Researcher pastes this block into their coding agent prompt and the agent picks up immediately. This is the durable-context promise from VISION.md made real.

### Composes with
- `goal` — reads current goal definition
- `compare` — reads ledger for last N runs
- `idea` — reads open ideas
- `prompt` — `resume` output can be injected into the agent prompt template

### Goal ID
New — propose **G57** in GOALS.md (Tier 1: loop intelligence).

### Acceptance criteria
- [ ] `autoresearch resume` prints markdown to stdout: goal, baseline, last 3 runs, open ideas, 3 ranked next experiments
- [ ] `--since DATE` filters runs to after that timestamp (ISO date)
- [ ] `--write` saves to `.researchloop/RESUME.md` instead of stdout
- [ ] `--last N` configures how many recent runs to show (default 3)
- [ ] Empty ledger prints `no state yet — run autoresearch goal first` and exits 0
- [ ] `scripts/test-resume.sh` covers: happy path, empty ledger, ledger with crashed runs, `--since` filter, `--write`
- [ ] `npm test` is green

### Anti-features (out of scope)
- Does NOT run an LLM call — pure ledger summarization, zero deps
- Does NOT modify ledger / baseline / goal files
- Does NOT replace `report` — `resume` is for mid-loop pickup; `report` is end-state writeup
- "Next 3 untried" is heuristic (gaps in tried hyperparams + open ideas), not ML — no model required

### Files the agent will touch
- `bin/researchloop.js` — add `cmdResume`
- `scripts/test-resume.sh` — new
- `docs/getting-started.md` — add resume to the morning-workflow section
- `templates/prompts/first-contact.md` — reference `autoresearch resume` as first command on returning sessions
- `package.json` — add `test:resume` to npm test script
- `GOALS.md` — add G57 entry

---

## Issue 2 — `autoresearch diff <a> <b>`

**Title:** `[agent] diff — side-by-side run comparison`

**Labels:** `agent-friendly`, `claim-next`, `tier-1`, `good first issue`

### Researcher line
A researcher comparing two runs needs to see code diff + env diff + hyperparam diff + metric delta side-by-side, because today they grep two JSON blobs by hand and miss things.

### Demo line
```text
$ autoresearch diff lr-3e-4 lr-1e-4
# DIFF: lr-3e-4 vs lr-1e-4

## Metrics
| metric     | lr-3e-4 | lr-1e-4 | delta             |
| val_loss   | 2.39    | 2.43    | +0.04 (worse)     |
| train_loss | 2.10    | 2.18    | +0.08             |
| step/s     | 142     | 138     | -4                |

## Command
- python train.py --lr 3e-4
+ python train.py --lr 1e-4

## Env
- CUDA_VISIBLE_DEVICES=0
+ CUDA_VISIBLE_DEVICES=1
(other vars identical)

## Code (git commit at run time)
both: a3f2b1c — identical
```

Researcher reads one screen and knows exactly why the runs differ. This is the everyday-need that `compare` doesn't currently cover (compare shows the table; diff shows the *why*).

### Composes with
- `compare` — diff is the drill-down from compare's table
- `run` — reads recorded env/command/git-commit metadata
- `report` — diff blocks can be embedded in reports
- `leaderboard` — clicking a rank in markdown reports can suggest `diff` between adjacent ranks

### Goal ID
New — propose **G54** in GOALS.md (existing G54 placeholder maps; otherwise G58).

### Acceptance criteria
- [ ] `autoresearch diff <a> <b>` prints markdown with sections: Metrics, Command, Env, Code
- [ ] Missing run id exits non-zero with clear message naming which id is missing
- [ ] `--write FILE` saves to disk; default stdout
- [ ] If both runs share git commit, Code section says `both: <sha> — identical`
- [ ] Env section shows only differing variables, not full dump
- [ ] Metrics present in one run but not the other are flagged `(only in a)` / `(only in b)`
- [ ] `scripts/test-diff.sh` covers: two-different-runs, identical-runs, missing-id, missing-metric, env-difference
- [ ] `npm test` is green

### Anti-features (out of scope)
- Does NOT do statistical significance (see #16 G33)
- Does NOT pull or diff binary artifacts / checkpoints
- Does NOT support diffing more than 2 runs at a time (use `compare` for N-way)
- Does NOT shell out to `git diff` against the working tree — only compares recorded commits

### Files the agent will touch
- `bin/researchloop.js` — add `cmdDiff`
- `scripts/test-diff.sh` — new
- `docs/getting-started.md` — add `diff` to commands cheatsheet
- `package.json` — add `test:diff` to npm test script
- `GOALS.md` — confirm/add goal entry

---

## Issue 3 — `autoresearch budget`

**Title:** `[agent] budget — halt the loop on run/cost/time limits`

**Labels:** `agent-friendly`, `claim-next`, `tier-5`

### Researcher line
A researcher running an unattended overnight sweep needs `autoresearch` to halt the loop when run-count / cost / wall-clock crosses a threshold, because otherwise the GPU budget burns by morning with no human in the loop and they can't trust the tool for autonomous use.

### Demo line
```text
$ autoresearch budget --max-runs 5 --max-cost 4.00 --max-hours 6
Budget written: halt on 5 runs OR $4.00 OR 6h (whichever first)

$ autoresearch team --workers 4
[worker-1] run lr-2e-4 → val_loss 2.40
[worker-2] run dropout-0.1 → val_loss 2.41
[worker-1] run cosine-sched → val_loss 2.38
[worker-2] run lr-5e-5 → val_loss 2.45
[worker-1] run momentum-0.95 → val_loss 2.39
BUDGET HALT: max-runs reached (5/5)
Wrote .researchloop/BUDGET_HALT.md

$ cat .researchloop/BUDGET_HALT.md
# Budget halt — 2026-05-18 02:14
- Reason: max-runs reached
- Runs executed: 5 / 5
- Cost spent: $2.40 / $4.00
- Wall-clock: 3h 22m / 6h
```

Researcher wakes up to a halted loop and a readable summary instead of a $200 bill.

### Composes with
- `team` — checks budget before spawning new workers; halts between runs
- `run` — records cost/duration into ledger for budget to read
- `report` — final report includes "budget consumed: X of Y"
- `dashboard` — surfaces budget remaining as a visible stat

### Goal ID
Maps to existing **G23** (cost & wall-clock accounting, [#12](https://github.com/vukrosic/autoresearch-ai/issues/12)) but goes further — adds the enforcement layer on top of G23's tracking. If G23 not yet merged, ship `--max-runs` and `--max-hours` first; `--max-cost` depends on G23 ledger fields.

### Acceptance criteria
- [ ] `autoresearch budget --max-runs N --max-cost X --max-hours H` writes `.researchloop/budget.json` (at least one limit required, others optional)
- [ ] `autoresearch budget --status` prints current consumption vs. each set limit
- [ ] `autoresearch budget --clear` removes the budget file
- [ ] `autoresearch team` checks budget before each spawn; if any limit exceeded, writes `BUDGET_HALT.md`, exits non-zero, halts further spawns
- [ ] `BUDGET_HALT.md` contains reason + each-limit-spent vs. set
- [ ] `--max-cost` is a no-op (with friendly warning) if ledger has no `cost_usd` field (G23 not merged)
- [ ] `scripts/test-budget.sh` covers: each limit type triggers halt, status command, clear command, missing-cost-field warning
- [ ] `npm test` is green

### Anti-features (out of scope)
- Does NOT fetch real billing from cloud providers — reads cost from logged `cost_usd` per run
- Does NOT halt mid-run — halts between runs only (mid-run halt requires signal handling, separate issue)
- Does NOT support per-experiment budget overrides
- Does NOT auto-resume after a halt — researcher must explicitly clear or raise budget

### Files the agent will touch
- `bin/researchloop.js` — add `cmdBudget`, modify `cmdTeam` to check budget pre-spawn
- `scripts/test-budget.sh` — new
- `docs/getting-started.md` — new section "Unattended runs"
- `package.json` — add `test:budget` to npm test script
- `GOALS.md` — extend G23 entry or add G59 for the enforcement layer

---

## Posting plan

When approved:

```bash
# Create the labels first
gh label create claim-next --color 0e8a16 --description "Hand-pinned ready queue for agents" || true
gh label create needs-validation --color cccccc --description "Speculative — parked until real-user request" || true
gh label create in-progress --color fbca04 --description "Agent is actively working on this" || true
gh label create ready-for-human-review --color 0075ca --description "Agent + reviewer agent approved; awaiting human" || true

# Post each issue body via gh issue create with --body-file
gh issue create --title "[agent] resume — reconstruct mid-loop session context" \
  --label "agent-friendly,claim-next,tier-1,good first issue" \
  --body-file researchloop-dev/issue-bodies/resume.md
# (repeat for diff and budget)
```

The per-issue body files are extracted from the sections above. We'll generate them when this draft is approved so the posting is one command per issue.
