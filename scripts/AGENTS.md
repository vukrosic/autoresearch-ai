# AutoResearch-AI Scripts Rules

You are editing `scripts/`.

## Scope

These scripts are the fast checks and release helpers for the package.

## Rules

1. Keep scripts small and explicit.
2. Prefer deterministic smoke checks over broad ad hoc automation.
3. If a script verifies a user-visible contract, keep a matching doc or test nearby.
4. Do not add slow setup unless it is part of a clear release or onboarding gate.
5. When a script fails, surface the first actionable error.

