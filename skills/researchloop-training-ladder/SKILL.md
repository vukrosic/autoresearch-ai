---
name: researchloop-training-ladder
description: Use when planning a staged training ladder that starts with many small runs, prunes the worst, and then lengthens the surviving runs over 3-4 rounds.
---

# AutoResearch-AI Training Ladder

Use this when the user wants a separate training mode, not the default experiment loop.

Before proposing a ladder, read:

- `.researchloop/goal.md`
- `.researchloop/plan.md`
- `.researchloop/AGENTS.md`
- `.researchloop/scratchpad/THREAD.md`
- `.researchloop/scratchpad/runs.jsonl`
- recent idea notes in `.researchloop/scratchpad/ideas/`

If `Time Budget` is missing in `.researchloop/plan.md`, ask exactly one question first: "How long do you usually want a typical experiment to run?" Save the answer in the plan and use it to choose the stage lengths.

Then:

1. Propose the smallest cheap batch first.
2. Eliminate the worst runs.
3. Lengthen only the survivors.
4. Repeat 3-4 times total.
5. Give the user a realistic time range for each stage.
6. Keep the history, pruning, and reproduction rules explicit.

Use with `autoresearch prompt --focus training-ladder` when the user wants the staged mode as a prompt overlay.
