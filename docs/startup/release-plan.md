# Release Plan

AutoResearch-AI should ship like a living developer tool, not a one-time launch.

The release rhythm should be small and frequent: every few days when there is a real improvement, and never only for ceremony.

## What We Release

Each release should ship one or more of these:

- better onboarding
- a clearer prompt
- a stronger adapter
- a more useful dashboard
- a better experiment command
- a more trustworthy test or log
- a real benchmark or proof on `llm-research-kit`

Do not release vague "startup progress." Release a concrete user-visible change.

## Release Cadence

Use a lightweight cadence:

- `0.1.x` for the first public loop
- prereleases like `0.1.1-beta.1` when the package is moving fast
- full patch releases when the loop and tests are stable

The goal is to make shipping normal. Small releases create trust because users can see momentum.

## GitHub Setup

The GitHub repo should be simple and public:

- default branch protected
- CI required on pull requests
- issue templates for bugs, adapter requests, and user feedback
- labels for `release`, `adapter`, `onboarding`, `docs`, `bug`, `good first issue`
- release drafts enabled
- a changelog or release note file in the repo

The repo should make the product legible to outside users:

- one README
- one getting-started guide
- one roadmap
- one place for startup notes
- one place for competitor notes
- one place for release notes

## Release Process

1. Pick one user-visible improvement.
2. Verify it locally on a clean temp repo.
3. Verify `npm test` is green and `npm run test:packed` succeeds.
4. Bump the version.
5. Write a short release note with:
   - what changed
   - why it matters
   - what was tested
   - any limitations
6. Tag the release on GitHub.
7. Publish the npm package.
8. Post the release on X.
9. Ask one or two users to try the new loop.

## Pre-Publish Checklist

Run this literal checklist for every release. Tick each box in the release PR description.

```text
[ ] git status clean, on main, up to date with origin
[ ] CHANGELOG "Unreleased" promoted to the new version with concrete entries
[ ] ROADMAP "Done (X.Y.Z)" updated; "Next" still accurate
[ ] package.json version bumped
[ ] npm test passes locally (all fast tests green)
[ ] npm run test:packed passes (tarball installs and boots from an isolated prefix)
[ ] npm pack --dry-run: file count looks right, no researchloop-dev/, no scripts/, no docs/competitors/, no docs/startup/
[ ] autoresearch --version prints the new version (from the packed tarball, not just the linked checkout)
[ ] README install/quickstart copy-pasted into a fresh shell still works end-to-end
[ ] docs/site/index.html mentions the new headline feature, if any
[ ] One LLM-driven onboarding scenario run against the packed tarball; transcript saved in researchloop-dev/transcripts/
[ ] CI green on the release commit (Node 18 / 20 / 22 on ubuntu + macos)
[ ] git tag vX.Y.Z, git push --follow-tags
[ ] npm publish
[ ] post-publish: install from npm in a fresh shell (npm install -g autoresearch-ai), run autoresearch --version and autoresearch --help
[ ] GitHub release draft published with the CHANGELOG entry
```

The "LLM-driven onboarding scenario" uses `researchloop-dev/skills/researchloop-onboarding-tester/SKILL.md`. It is slow and flaky, so it is not part of CI. It is part of the release gate.

## Regression Gate

Three layers, smallest to largest:

1. **`npm test`** runs every fast script in `scripts/test-*.sh`. Every PR must keep this green. CI enforces this on Node 18 / 20 / 22 against ubuntu + macos.
2. **`npm run test:packed`** packs the tarball, installs it into an isolated npm prefix, and runs the harness end-to-end. Catches `files:` whitelist drift and ESM resolution issues that the linked-checkout path silently masks.
3. **LLM onboarding scenario** (manual) — a fresh agent in a clean lab folder runs the published onboarding prompt against the packed tarball. Saves the transcript and a short summary into `researchloop-dev/transcripts/` and `researchloop-dev/summaries/`. This catches behavioral regressions (prompt drift, missing target-selection question, sweep-first defaults) that the file-based tests do not see.

If a regression is found, write a failing test for it before fixing it.

## Release Note Style

Keep release notes short and concrete.

Good release notes mention:

- the feature name
- the user problem it solves
- the exact command or workflow it improves
- the test or proof that backs it up

Bad release notes talk about "vision" without showing a user-facing change.

## Launch Sequence

The first launch should be:

1. Public GitHub repo for `autoresearch-ai`
2. First npm publish
3. Short demo video or screen recording
4. X post announcing the loop
5. 3 to 5 direct messages to PhD students or lab users
6. One public request for feedback

The launch is not finished when the package is published. It is finished when someone else tries the loop and gives usable feedback.

## What To Improve Next

The next improvements should be boring and practical:

- better first-run onboarding
- a more obvious `autoresearch goal`
- one more adapter if a user actually needs it
- better `autoresearch compare` output
- a richer dashboard view
- a clearer `autoresearch idea` flow that starts from repo history and chat, then suggests real research ideas instead of defaulting to sweeps

The first release after launch should focus on removing friction from the first 10 minutes.
