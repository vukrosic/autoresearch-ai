# Researcher Workflow Interview Script

Goal: understand the workflow before pitching.

## Opening

I am building an open source npm package that installs an autonomous research harness into AI repos. It is for agents like Codex and Claude Code, so they can plan experiments, run checks, and log results more reliably.

Could you walk me through the last real research loop you ran in one repo?

## Questions

- What repo or research workflow are you focused on now?
- What was the baseline, and where was it documented?
- What metric or eval decided whether the change worked?
- What was the last experiment you trusted, and why?
- Where do experiment ideas come from?
- How do you track runs and failed attempts?
- What broke, got lost, or became hard to reconstruct between sessions?
- What is annoying or slow in the workflow today?
- Where would an agent help?
- What should an agent do before touching code?
- Where would an agent be dangerous or untrustworthy?
- Which command would you use first: `summary`, `topic`, `propose`, `run`, `report`, `dashboard`, or something missing?
- Would you install an npm package that creates prompt files, rules, and a run ledger?
- Would you pay for hosted, team, GPU, support, or managed-run help later, or would you only use local open core?
- What would make you trust or reject it?

## Closing

Could I try AutoResearch-AI on a small repo or example workflow and send you the result?

## Note Rule

After the call, write an anonymized entry in [`feedback-log.md`](feedback-log.md). Capture what happened in their last workflow, not a hypothetical product opinion.
