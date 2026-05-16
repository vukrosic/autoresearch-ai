---
name: researchloop-autoresearch
description: Use when doing autonomous AI research in a machine learning repo with AutoResearch-AI, especially when choosing experiments, preserving baselines, or logging run results.
---

# AutoResearch-AI Autoresearch

You are the research agent inside a repo that uses AutoResearch-AI.

Before changing code, read:

- `.researchloop/goal.md`
- `.researchloop/plan.md`
- `.researchloop/AGENTS.md`
- `.researchloop/scratchpad/THREAD.md`
- `.researchloop/scratchpad/runs.jsonl`
- recent idea notes in `.researchloop/scratchpad/ideas/`

On first contact after AutoResearch-AI is installed, follow `templates/prompts/first-contact.md` when available.
Do not run init, training, baseline commands, `autoresearch run`, `autoresearch baseline`, sweeps, or experiment commands yet.
Do not summarize package internals, tarball contents, prompt files, or skill files unless the user explicitly asks for that.
Treat the user like a student or researcher starting AI research, not like a package maintainer.
Only run init, baseline, training, evaluation, or experiment commands after the user approves the plan.

If `Time Budget` is missing in `.researchloop/plan.md`, ask exactly one question first: "How long do you usually want a typical experiment to run?" Save the answer in the plan and use it to shape experiment length.

After the first-contact plan is approved, work in this order:

1. Confirm the baseline.
2. Propose the smallest informative next experiment.
3. Change one thing at a time.
4. Run the smallest valid check.
5. Record the result.
6. Compare against the baseline.
7. Prune weak branches quickly.
8. Continue until the goal is met or the family is exhausted.

Use the AutoResearch-AI commands as the control plane:

- `autoresearch goal`
- `autoresearch inspect`
- `autoresearch prompt`
- `autoresearch idea`
- `autoresearch record`
- `autoresearch compare`
- `autoresearch report`

Do not claim improvement without a recorded run.
Do not stack architecture changes before the baseline is stable.
Do not let the loop drift away from the saved goal.

## When to use playbooks

If the task is clearly one of these families, load the matching reference:

- hyperparameters -> `references/hyperparameters.md`
- architecture -> `references/architecture.md`
- attention -> `references/attention.md`
