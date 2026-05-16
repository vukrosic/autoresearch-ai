# AutoResearch-AI Hub

This folder is the working home base for the startup.

Canonical pieces:

- Site: `/Users/vukrosic/my-life/projects/research-loop-site/index.html`
- npm CLI: `/Users/vukrosic/my-life/projects/researchloop-cli`
- Mac-safe model repo: `/Users/vukrosic/my-life/research-repos/llm-research-kit`
- Reference archive: `/Users/vukrosic/my-life/research-repos/experiments-autonomous-speedrunning`

Current status:

- The site is served on localhost.
- The `autoresearch` CLI initializes the harness, inspects a repo, prints an agent prompt, runs a doctor check, and summarizes the run ledger.
- The MacBook-safe runtime branch in `llm-research-kit` can run a tiny smoke training loop on MPS.

What still matters:

- Keep the product narrow: install a research harness, then let Codex / Claude Code / Hermes drive experiments.
- Keep the startup grounded in real user workflows, not abstract AI tooling.
- Keep the Mac path working, even if the bigger training runs live on NVIDIA later.

## E2E Test Status

Verified end to end on this machine:

1. `autoresearch init --agent codex`
2. `autoresearch inspect`
3. `autoresearch prompt --agent codex --goal "improve validation loss"`
4. `autoresearch doctor --python /Users/vukrosic/miniconda3/bin/python3`
5. `autoresearch report`

The CLI created the harness files, detected the generic adapter in a blank repo, printed a usable prompt, and confirmed local Python / torch / MPS support.

The landing page at `http://localhost:8000/projects/research-loop-site/index.html` also serves the current startup copy.

## User Touchpoint Plan

Goal: stay in regular contact with PhD students, labs, and early customers so the product reflects real research pain.

Cadence:

- Weekly: send 3 short check-ins to active testers or interested researchers.
- Biweekly: do 1 live demo or office-hour style call.
- Monthly: ask for 1 repo walkthrough from a PhD student or lab user.

Questions to ask:

- What repo are you trying to improve?
- What is the baseline metric?
- What does a good first week look like?
- Which part of the workflow is annoying today: setup, experiment design, logging, comparison, or follow-up?
- Would you use a CLI that writes the harness and prompt files for you?

Channels:

- Email for direct follow-up.
- Short demo calls for labs and serious users.
- A small feedback note inside the repo or CLI output for fast reactions.
- A simple waitlist or beta form on the site once the product is ready.

What to look for:

- Time saved on first setup.
- Whether the harness survives one full experiment loop.
- Whether users come back for a second run without being chased.
- Whether they want the prompt files copied into their own repo.

Next proof:

- Run AutoResearch-AI on a real small repo and write down the first useful experiment idea.
