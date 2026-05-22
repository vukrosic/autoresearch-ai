# Roadmap

## Now

- Keep `/Users/vukrosic/my-life/autoresearch-ai` as the single repo home.
- Make the npm package useful before adding hosted infrastructure.
- Validate the loop on `llm-research-kit` and one outside repo.
- Talk to PhD students and lab users before expanding adapters.
- Use a small orchestrator / worker / reviewer hierarchy when developing the repo itself.

## MVP

- Install harness with `autoresearch init`.
- Inspect repo structure with `autoresearch inspect`.
- Generate agent prompts with `autoresearch prompt`.
- Check local environment with `autoresearch doctor`.
- Summarize run ledger with `autoresearch report`.
- Provide templates for Codex, Claude Code, Hermes, Cursor, PyTorch, Hugging Face, and generic repos.
- Keep `docs/startup/goals.md` as the source of truth for what autonomous research should do at runtime.
- Keep `GOALS.md` (repo root) as the canonical project build plan with numbered, parallelizable goals.

## Done (0.3.1)

- Canonical `templates/prompts/first-contact.md` for first-run onboarding.
- `autoresearch prompt` includes first-contact rules automatically.
- README copy-paste prompt now starts from `npm install -g autoresearch-ai`.
- First-contact behavior is baseline-first: inspect and document the baseline before recommending experiments.
- Prompt and packed-package tests cover the onboarding guardrails.

## Done (0.3.0)

- `autoresearch --version`.
- `autoresearch team` multi-agent dev board with orchestrator, reviewer, and worker briefs; `--force` required to overwrite.
- `autoresearch dashboard --host` warns when bound beyond loopback.
- `npm test` aggregate plus new `test:adapters`, `test:packed`, and a noisy-log case in `test:run`.
- `test:site` and `test:setup` no longer depend on machine-specific state.
- GitHub Actions CI on Node 18 / 20 / 22 across ubuntu and macos.
- `package.json` declares `engines.node >= 18` and a `repository` field.

## Done (0.2.0)

- `autoresearch run` and `autoresearch baseline` execute commands and parse metrics into the ledger.
- `autoresearch scan-papers` pulls arXiv abstracts for the goal and writes per-paper notes.
- `autoresearch idea` now surfaces paper-derived ideas alongside the adapter playbook.
- Adapter detection no longer false-positives on filename substrings.

## Next Product Work

- Validate the next feature wave through issue #126 before promoting more ideas into `GOALS.md`.
- `autoresearch topic` or equivalent topic-intake helper for baseline-aware idea generation.
- `autoresearch team` polish: better lane splitting, branch/worktree helpers, and a machine-readable board.
- `autoresearch replay <run-id>` re-executes a stored run and flags reproducibility deltas.
- `autoresearch scan-github` for repos with similar training scripts.
- `autoresearch promote <run-id>` copies a winning config/diff into `winners/`.
- Public demo repo that shows one full autonomous research loop end to end.

## Startup Work

- Record 5 anonymized repo walkthroughs in `docs/startup/users/feedback-log.md` and extract the repeated pains in `docs/startup/users/feature-wave-validation.md`.
- Recruit 5 PhD students or independent AI researchers for repo walkthroughs.
- Recruit 2 small-company users with prompt/model/eval optimization pain.
- Ship small releases every few days, with one visible user-facing improvement per release.
- Ship one public demo video showing install to first logged experiment.
- Publish the open source repo when the CLI has one polished loop.
