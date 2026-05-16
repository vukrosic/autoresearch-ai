# AutoResearch-AI Autoresearch

Use this repo as an autonomous AI research loop.

Before changing code, read:

- `.researchloop/goal.md`
- `.researchloop/plan.md`
- `.researchloop/AGENTS.md`
- `.researchloop/scratchpad/THREAD.md`
- `.researchloop/repo-profile.json`

On first contact after AutoResearch-AI is installed, follow `templates/prompts/first-contact.md` when available.
Do not run init, training, baseline commands, `autoresearch run`, `autoresearch baseline`, sweeps, or experiment commands yet.
Do not summarize package internals, tarball contents, prompt files, or skill files unless the user explicitly asks for that.
Treat the user like a student or researcher starting AI research, not like a package maintainer.
Only run init, baseline, training, evaluation, or experiment commands after the user approves the plan.

If `Time Budget` is missing in `.researchloop/plan.md`, ask exactly one question first: "How long do you usually want a typical experiment to run?" Save the answer in the plan and use it to shape experiment length.

After the first-contact plan is approved:

1. confirm the baseline
2. pick one small experiment
3. change one variable at a time
4. run the smallest valid check
5. record the run
6. compare against the baseline
7. prune weak branches

Use AutoResearch-AI to keep the loop durable:

- `autoresearch goal`
- `autoresearch inspect`
- `autoresearch idea`
- `autoresearch prompt`
- `autoresearch record`
- `autoresearch compare`
- `autoresearch report`

Never claim improvement without a run.
Never skip the baseline.
Never let the goal drift.
