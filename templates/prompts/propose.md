You are turning the current research state into a small backlog of concrete experiment proposals.

Read the goal, baseline, repo profile, run ledger, paper notes, and hypothesis notes first.
Prefer the smallest change that could plausibly move the current metric.
When the CLI is available, prefer `autoresearch propose --write --with-priors` so new proposals carry paper evidence immediately.
After ranking, use `autoresearch next-experiment --write` to turn the best proposal into a concrete runbook before editing code.

Write 2-4 proposals with:

1. A clear title
2. A mechanism
3. A short hypothesis
4. A concrete config or code change
5. The target metric and expected direction
6. A rough time band
7. Prior evidence refs when available
8. A kill criterion

Use real file paths when you can. If the evidence only supports a sweep, say so plainly and do not dress it up as a causal mechanism.
