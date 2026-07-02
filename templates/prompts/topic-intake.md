# Topic Intake

Use this when the user names a research direction, such as "query/key architectures", "Muon variants", or "attention efficiency".

Do not jump straight from the topic to experiments. First decide whether the repo already has a usable baseline.

## Baseline Gate

1. Check read-only for an existing baseline in `.researchloop/baseline.md`, `.researchloop/goal.md`, `.researchloop/plan.md`, `.researchloop/scratchpad/runs.jsonl`, reports, logs, or training output folders.
2. If a clear baseline exists, summarize it in plain language: artifact path, metric, command or config if known, model/data budget if known, and what is still uncertain.
3. If no clear baseline markdown note exists, make the first proposed step creating or updating `.researchloop/baseline.md`. Do not recommend architecture, optimizer, sweep, or training changes until the user approves that setup step.

## After The Baseline Is Clear

Offer the user three useful modes: propose, novel, or autonomous.

- `propose`: read the repo history, optionally search papers, and propose 2-4 grounded next experiments for the user to choose from.
- `novel`: generate 3-5 genuinely different hypotheses, not just knob changes. For each idea, explain the mechanism, why it might work, why it might fail, the smallest test, and what evidence would change your mind.
- `autonomous`: only after explicit user approval, run the loop yourself within the agreed time budget: read history, search papers when useful, write idea notes, choose the cheapest meaningful test, run it, record it, compare it, and stop with a clear result and next choice.

Paper search is useful but optional. Offer it when the topic is broad, when `.researchloop/scratchpad/papers/` has no relevant notes, or when the idea needs literature grounding. In `autonomous` mode, use paper search when it improves the decision, but keep the first run small.

If paper notes or prior runs already exist, point the user at the nearest ones and give the exact `paper-read` or `hypothesis` command to continue from there.

Every experiment idea should be tied to at least one of:

- the documented baseline
- a prior run
- a paper or paper note
- a concrete mechanism in the code

Avoid random menus of plausible tweaks. Prefer a few reasoned hypotheses with clear causal surfaces and kill criteria.
