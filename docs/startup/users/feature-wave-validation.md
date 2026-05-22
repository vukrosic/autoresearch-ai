# Feature Wave Validation Board

This board turns issue #126 into a real-user workflow. It should help decide the next AutoResearch-AI feature wave without pretending that plausible ideas are evidence.

## Current Status

- Issue: `#126`
- Real conversations logged: `0 / 5`
- Validation state: `not ready to close`
- Source of truth for notes: [`feedback-log.md`](feedback-log.md)

Do not mark a feature as `validated` until a feedback note points to a real repo, a real baseline or eval workflow, and a concrete pain from the user's last research loop.

## Required Conversation Mix

| Slot | Target user | What to learn | Status |
| --- | --- | --- | --- |
| 1 | PhD student doing ablations | How baselines, failed attempts, and paper-driven ideas are tracked. | open |
| 2 | Independent AI researcher | What breaks between solo sessions and agent handoffs. | open |
| 3 | Small lab or startup engineer | Where repeatability matters across teammates or machines. | open |
| 4 | Company prompt/model/eval optimization user | Whether local open core is enough or paid hosted/team support matters. | open |
| 5 | User with an existing ML repo and messy experiment history | Which command helps first: `summary`, `topic`, `propose`, `run`, `report`, `dashboard`, or something missing. | open |

## Evidence Rules

Use these labels in [`../../feature-ideas.md`](../../feature-ideas.md):

- `validated` means at least two independent feedback notes show the same pain, or one high-intent user shows the pain in a real repo and asks to use the fix.
- `needs-validation` means the idea is plausible but still needs real workflow evidence.
- `defer` means the idea may be useful later, but it does not directly improve install-to-first-use, first logged experiment, second experiment, or trustworthy report quality yet.

## Pain Extraction

Fill this table only from anonymized feedback notes.

| Pain | Evidence notes | Product requirement | Candidate feature |
| --- | --- | --- | --- |
| _No repeated pain recorded yet._ |  |  |  |

## Next Issue Format

Every validated implementation issue should include:

```text
## Researcher line
One sentence naming the real workflow pain and target user.

## Demo line
One sentence describing the smallest real demo that proves the feature.

## Evidence
- Conversation IDs:
- Repeated pain:
- Why this beats the current workaround:

## Acceptance criteria
- The command/doc/template change is tested.
- The demo starts from a real repo or fixture that matches the user workflow.
- The feature stays inside the local open-core package unless the evidence requires a paid or hosted layer.
```

## Close Criteria For Issue #126

- Five anonymized conversations are logged in [`feedback-log.md`](feedback-log.md).
- The top five repeated pains are extracted here.
- [`../../feature-ideas.md`](../../feature-ideas.md) uses `validated`, `needs-validation`, or `defer` based on those notes.
- The next three implementation issues have a researcher line, demo line, and evidence references.
- [`../../../ROADMAP.md`](../../../ROADMAP.md) or [`../release-plan.md`](../release-plan.md) names the validated next wave.
