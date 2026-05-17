<!--
Thanks for the PR. Keep it focused: one G## goal or one bug per PR. Architecture changes need an issue first.
-->

## What this changes

<!-- One paragraph. What and why. -->

## Linked issue / goal

<!-- One of:
  Closes #123
  Implements G07 from GOALS.md
  Fixes #45
-->

## Acceptance check

<!-- If this implements a G## goal, copy each Acceptance line from GOALS.md and tick it. -->

- [ ]
- [ ]

## How you verified it works

<!-- Concrete commands / output. The Test plan lines from GOALS.md plus any extra checks. -->

```bash
npm test
# ...
```

## Demo (required for `[agent]` / feature PRs)

<!--
Paste a terminal session showing this feature used in a realistic workflow — not just the test passing.
Bare minimum: the commands a researcher would actually type, with real (not 1-line synthetic) ledger/state.
For `fix` / refactor PRs, write "N/A — bug fix" and explain.
-->

```text
$ autoresearch ...
...
```

This demo matches the Demo line on the linked issue: yes / no / N/A.

## Agent attribution

<!-- If an AI coding agent wrote any of this PR, name it (Codex / Claude / Cursor / Hermes / other) and roughly which parts. -->

## Pre-flight

- [ ] `npm test` is green locally.
- [ ] I have not added a runtime dependency to the npm package (the CLI is intentionally zero-dep). If I did, I explained why above.
- [ ] If I changed CLI behavior, I updated the relevant `scripts/test-*.sh` and docs.
- [ ] If I changed prompts or templates, I updated the matching tests and docs.
- [ ] I read [AGENTS.md](../AGENTS.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
- [ ] Single focused change — not bundled with unrelated refactors.
