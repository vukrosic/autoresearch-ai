#!/usr/bin/env bash
# orchestrate.sh — pick one claim-next issue, spawn an implementer agent in a
# worktree, on success open a draft PR, then spawn a reviewer agent.
#
# This is the manual single-issue mode. Once the loop is trusted on a few real
# issues, wrap it in a cron / parallel runner.
#
# Usage:
#   ./orchestrate.sh                  # pick the lowest-numbered claim-next issue
#   ./orchestrate.sh <issue-number>   # work on a specific issue
#   ./orchestrate.sh --review <pr>    # only run the reviewer on an existing PR
#
# Env vars:
#   IMPLEMENTER     codex | claude  (default: codex)
#   REVIEWER        claude | codex  (default: claude)
#   CODEX_BIN       path to codex CLI (default: codex)
#   CLAUDE_BIN      path to claude CLI (default: claude)
#   DRY_RUN         1 = print actions, don't spawn agents (default: 0)
#   AGENT_TIMEOUT   seconds before killing the agent (default: 1800)

set -euo pipefail

# -------- config --------
IMPLEMENTER="${IMPLEMENTER:-codex}"
REVIEWER="${REVIEWER:-claude}"
CODEX_BIN="${CODEX_BIN:-codex}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
DRY_RUN="${DRY_RUN:-0}"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-1800}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
RUNNER_DIR="$REPO_ROOT/researchloop-dev/agent-runner"
PROMPTS_DIR="$RUNNER_DIR/prompts"
STATE_DIR="$RUNNER_DIR/state"
WORKTREES_PARENT="$REPO_ROOT/.agent-worktrees"

mkdir -p "$STATE_DIR" "$WORKTREES_PARENT"

# -------- helpers --------
log() { echo "[orchestrate $(date +%H:%M:%S)] $*" >&2; }
die() { echo "ERROR: $*" >&2; exit 1; }

# Portable timeout wrapper: uses `timeout`, then `gtimeout`, else falls through
# without a hard cap. macOS doesn't ship `timeout` by default; this lets the
# orchestrator run without requiring coreutils.
run_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  else
    # No timeout available — spawn the command and rely on user Ctrl-C if it hangs.
    log "WARNING: no timeout binary on this system; agent will run without a hard cap (Ctrl-C to abort)"
    "$@"
  fi
}

# Retry a gh command up to 5 times with backoff. Use for read-only calls.
gh_retry() {
  local out
  for try in 1 2 3 4 5; do
    if out=$(gh "$@" 2>&1); then
      echo "$out"
      return 0
    fi
    [ "$try" -lt 5 ] && sleep $((try * 2))
  done
  echo "$out" >&2
  return 1
}

ensure_clean() {
  cd "$REPO_ROOT"
  if ! git diff --quiet --ignore-submodules HEAD 2>/dev/null; then
    die "working tree has uncommitted changes; commit or stash before orchestrating"
  fi
}

pick_issue() {
  # Lowest-numbered open issue with claim-next label and no open PR linked.
  local picked
  picked=$(gh issue list \
    --state open \
    --label "claim-next" \
    --limit 50 \
    --json number,title,labels \
    --jq 'sort_by(.number) | .[] | select(.labels | map(.name) | (contains(["in-progress"]) | not) and (contains(["needs-validation"]) | not)) | .number' \
    | head -1)
  [ -n "$picked" ] || die "no eligible claim-next issue found"
  echo "$picked"
}

slug_for_issue() {
  local n="$1"
  local title
  title=$(gh_retry issue view "$n" --json title --jq '.title')
  [ -n "$title" ] || die "could not fetch title for issue #$n"
  # Extract the verb after `[agent]` or after `G##`, lowercase, hyphenate.
  echo "$title" \
    | sed -E 's/^\[(agent|goal)\][^a-zA-Z0-9]*//' \
    | sed -E 's/^G[0-9]+[^a-zA-Z0-9]*//' \
    | sed -E 's/—.*$//' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g' \
    | sed -E 's/^-+|-+$//g' \
    | cut -c1-40
}

spawn_implementer() {
  local issue_num="$1" branch="$2" worktree="$3"
  local body_file="$STATE_DIR/issue-$issue_num.body.md"
  gh issue view "$issue_num" --json body --jq '.body' > "$body_file"

  local prompt_file="$STATE_DIR/prompt-$issue_num.md"
  python3 - "$PROMPTS_DIR/implement.md" "$body_file" "$branch" "$worktree" "$issue_num" > "$prompt_file" <<'PYEOF'
import sys, pathlib
template = pathlib.Path(sys.argv[1]).read_text()
body = pathlib.Path(sys.argv[2]).read_text()
branch, worktree, issue_num = sys.argv[3], sys.argv[4], sys.argv[5]
out = (template
       .replace("$ISSUE_BODY", body)
       .replace("$BRANCH", branch)
       .replace("$WORKTREE", worktree)
       .replace("$ISSUE_NUMBER", issue_num))
sys.stdout.write(out)
PYEOF

  log "implementer prompt → $prompt_file"

  if [ "$DRY_RUN" = "1" ]; then
    log "[DRY_RUN] would spawn $IMPLEMENTER on $worktree with $prompt_file"
    return 0
  fi

  # Sandbox / permission mode flags (verified against codex 0.130 + claude 2.1.143).
  # Default: workspace-write / acceptEdits — agent can edit files inside the
  # worktree but cannot escape the sandbox. Override to full-bypass with
  # DANGEROUS=1, only for trusted prompts in a disposable worktree.
  local codex_perm="--sandbox workspace-write --skip-git-repo-check"
  local claude_perm="--permission-mode acceptEdits"
  if [ "${DANGEROUS:-0}" = "1" ]; then
    codex_perm="--dangerously-bypass-approvals-and-sandbox --skip-git-repo-check"
    claude_perm="--dangerously-skip-permissions"
  fi

  cd "$worktree"
  case "$IMPLEMENTER" in
    codex)
      run_timeout "$AGENT_TIMEOUT" "$CODEX_BIN" exec \
        --cd "$worktree" \
        $codex_perm \
        --output-last-message "$STATE_DIR/implementer-$issue_num.final.txt" \
        "$(cat "$prompt_file")" \
        2>&1 | tee "$STATE_DIR/implementer-$issue_num.log"
      ;;
    claude)
      run_timeout "$AGENT_TIMEOUT" "$CLAUDE_BIN" -p \
        "$(cat "$prompt_file")" \
        --add-dir "$worktree" \
        $claude_perm \
        ${CLAUDE_MAX_BUDGET:+--max-budget-usd "$CLAUDE_MAX_BUDGET"} \
        2>&1 | tee "$STATE_DIR/implementer-$issue_num.log"
      ;;
    *) die "unknown IMPLEMENTER: $IMPLEMENTER";;
  esac
  cd "$REPO_ROOT"
}

spawn_reviewer() {
  local pr_num="$1" issue_num="$2"
  local diff_file="$STATE_DIR/pr-$pr_num.diff"
  local body_file="$STATE_DIR/issue-$issue_num.body.md"
  gh pr diff "$pr_num" > "$diff_file"
  gh issue view "$issue_num" --json body --jq '.body' > "$body_file"

  local prompt_file="$STATE_DIR/review-prompt-$pr_num.md"
  python3 - "$PROMPTS_DIR/review.md" "$body_file" "$diff_file" "$pr_num" "$issue_num" > "$prompt_file" <<'PYEOF'
import sys, pathlib
template = pathlib.Path(sys.argv[1]).read_text()
body = pathlib.Path(sys.argv[2]).read_text()
diff = pathlib.Path(sys.argv[3]).read_text()
pr_num, issue_num = sys.argv[4], sys.argv[5]
out = template.replace("$PR_NUMBER", pr_num).replace("$ISSUE_NUMBER", issue_num).replace("$DIFF", "(see PR diff section below)")
out += "\n\n## Issue body\n\n" + body + "\n\n## PR diff\n\n```diff\n" + diff + "\n```\n"
sys.stdout.write(out)
PYEOF

  log "reviewer prompt → $prompt_file"

  if [ "$DRY_RUN" = "1" ]; then
    log "[DRY_RUN] would spawn $REVIEWER on PR #$pr_num with $prompt_file"
    return 0
  fi

  local review_out="$STATE_DIR/review-$pr_num.md"
  # Reviewer needs Bash(gh:*) so it can fetch PR/issue context and post the
  # verdict comment itself. We allowlist only `gh` and read tools — no
  # general shell, no edits. acceptEdits is required to enable Bash at all
  # in claude -p; allowedTools narrows the surface back down.
  case "$REVIEWER" in
    claude)
      run_timeout "$AGENT_TIMEOUT" "$CLAUDE_BIN" -p \
        "$(cat "$prompt_file")" \
        --permission-mode acceptEdits \
        --allowedTools "Bash(gh:*) Read Grep" \
        > "$review_out"
      ;;
    codex)
      run_timeout "$AGENT_TIMEOUT" "$CODEX_BIN" exec \
        --sandbox workspace-write \
        --skip-git-repo-check \
        "$(cat "$prompt_file")" \
        > "$review_out"
      ;;
    *) die "unknown REVIEWER: $REVIEWER";;
  esac

  gh pr comment "$pr_num" --body-file "$review_out"
  log "reviewer comment posted on PR #$pr_num → $review_out"
}

run_full_loop() {
  local issue_num="$1"

  ensure_clean

  local slug branch worktree
  slug=$(slug_for_issue "$issue_num")
  branch="agent/$issue_num-$slug"
  worktree="$WORKTREES_PARENT/$issue_num-$slug"

  if [ -e "$worktree" ]; then
    die "worktree already exists: $worktree (clean up or pass a different issue)"
  fi

  log "issue #$issue_num → branch $branch, worktree $worktree"

  if [ "$DRY_RUN" != "1" ]; then
    git -C "$REPO_ROOT" worktree add -b "$branch" "$worktree" origin/main
    gh issue edit "$issue_num" --add-label "in-progress" --remove-label "claim-next" || true
  fi

  if ! spawn_implementer "$issue_num" "$branch" "$worktree"; then
    log "implementer FAILED; leaving worktree for inspection at $worktree"
    return 1
  fi

  if [ "$DRY_RUN" = "1" ]; then return 0; fi

  cd "$worktree"
  if [ -f BLOCKED.md ] || [ -f OBJECTION.md ]; then
    log "implementer escalated: see BLOCKED.md / OBJECTION.md in $worktree"
    gh issue comment "$issue_num" --body "Implementer agent escalated. See worktree $worktree."
    return 1
  fi

  if ! git diff --quiet HEAD; then
    log "uncommitted changes from implementer — committing as safety net"
    git add -A
    git commit -m "agent: safety-net commit (implementer left uncommitted changes)" || true
  fi

  if git log origin/main..HEAD --oneline | grep -q .; then
    git push -u origin "$branch"
    local pr_num
    pr_num=$(gh pr create --draft --title "[agent] #$issue_num" \
      --body "Closes #$issue_num. Generated by orchestrator using $IMPLEMENTER. Review by $REVIEWER incoming." \
      | grep -oE '[0-9]+$' | tail -1)
    log "draft PR #$pr_num opened"
    spawn_reviewer "$pr_num" "$issue_num"
  else
    log "implementer produced no commits; nothing to push"
  fi
}

# -------- entrypoint --------
case "${1:-}" in
  --review)
    [ -n "${2:-}" ] || die "usage: $0 --review <pr-number>"
    pr="$2"
    issue=$(gh pr view "$pr" --json body --jq '.body' | grep -oE 'Closes #[0-9]+' | head -1 | grep -oE '[0-9]+')
    [ -n "$issue" ] || die "could not find linked issue on PR #$pr"
    spawn_reviewer "$pr" "$issue"
    ;;
  "")
    issue=$(pick_issue)
    run_full_loop "$issue"
    ;;
  *)
    run_full_loop "$1"
    ;;
esac
