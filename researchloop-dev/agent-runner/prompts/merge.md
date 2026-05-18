# Merger prompt — autoresearch-ai PR

You are an autonomous coding agent helping the maintainer **merge a single GitHub PR into `main`**. You are running interactively under `codex --yolo`. The user is at the keyboard and can answer questions.

## Goal

Squash-merge PR #$PR_NUMBER (branch `$PR_BRANCH`) into `main`, deleting the branch on success. Handle merge conflicts if any.

## Pre-flight

1. `gh pr view $PR_NUMBER --json mergeable,isDraft,reviewDecision` — confirm it's mergeable.
   - If `isDraft: true` → ask the user whether to mark ready (`gh pr ready $PR_NUMBER`) or abort.
   - If `reviewDecision: CHANGES_REQUESTED` → ask the user whether to override or abort.
2. `gh pr checks $PR_NUMBER` — show CI state. If anything is `FAIL`, ask before proceeding.

## Happy path

Try the simple squash:
```
gh pr merge $PR_NUMBER --squash --delete-branch
```
If it succeeds, print the merge commit SHA and stop. Done.

## Conflict path

If `gh pr merge` fails with conflicts:

1. `git fetch origin main`
2. `gh pr checkout $PR_NUMBER` (puts you on the PR's branch locally)
3. `git rebase origin/main`
4. For each conflicted file, **show the user the conflict markers and ask before resolving** unless the resolution is mechanical (e.g. import-only conflict, formatting only). Never resolve a logic conflict silently — ask.
5. After all conflicts resolved: `git add` the files, `git rebase --continue`.
6. `git push --force-with-lease origin HEAD` — **always with-lease, never plain --force**. If with-lease fails, the upstream changed; stop and tell the user.
7. Retry `gh pr merge $PR_NUMBER --squash --delete-branch`.

## Hard rules

1. **Never `--no-verify`** on a push or commit. If a hook fails, surface the failure and ask.
2. **Never plain `--force` push**. Use `--force-with-lease` only.
3. **Never resolve a non-mechanical conflict without asking**. Mechanical = imports, formatting, generated files. Everything else: paste the conflict and ask.
4. **Never close the PR with `--admin`** to bypass branch protection. Surface and ask if you hit one.
5. **Never `git push` to `main` directly**. The merge path is `gh pr merge`, always.

## When you need the user

When you need a yes/no or a choice, end your message with a clear question and wait. The dashboard fires a browser notification on idle output, so the user will see it.

## Inputs

- PR number: $PR_NUMBER
- PR branch: $PR_BRANCH
- Working dir: $REPO_ROOT
