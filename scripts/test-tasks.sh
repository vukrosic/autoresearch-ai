#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli="node $repo_root/bin/researchloop.js"

$cli init --agent codex --dir "$tmpdir" >/tmp/researchloop-tasks-init.log

$cli tasks add "orchestrate the queue" --lane orchestrator --id task-orch --dir "$tmpdir" >/tmp/researchloop-tasks-add-orch.log
$cli tasks add "review the queue" --lane reviewer --id task-review --dir "$tmpdir" >/tmp/researchloop-tasks-add-review.log
$cli tasks add "claim the first worker task" --lane worker --id task-worker-1 --dir "$tmpdir" >/tmp/researchloop-tasks-add-worker-1.log
$cli tasks add "claim the second worker task" --lane worker --id task-worker-2 --depends task-worker-1 --dir "$tmpdir" >/tmp/researchloop-tasks-add-worker-2.log

$cli tasks status --dir "$tmpdir" >/tmp/researchloop-tasks-status-1.log
grep -q "Lane orchestrator: open=1 claimed=0 blocked=0 done=0" /tmp/researchloop-tasks-status-1.log
grep -q "Lane reviewer: open=1 claimed=0 blocked=0 done=0" /tmp/researchloop-tasks-status-1.log
grep -q "Lane worker: open=1 claimed=0 blocked=1 done=0" /tmp/researchloop-tasks-status-1.log
grep -q "task-worker-2" /tmp/researchloop-tasks-status-1.log
grep -q "(depends: task-worker-1)" /tmp/researchloop-tasks-status-1.log

set +e
$cli tasks claim --dir "$tmpdir" --agent alpha --lane worker >/tmp/researchloop-tasks-claim-a.log 2>&1 &
pid_a=$!
$cli tasks claim --dir "$tmpdir" --agent beta --lane worker >/tmp/researchloop-tasks-claim-b.log 2>&1 &
pid_b=$!
wait "$pid_a"
rc_a=$?
wait "$pid_b"
rc_b=$?
set -e
if [ "$rc_a" -ne 0 ] || [ "$rc_b" -ne 0 ]; then
  echo "expected both claim calls to exit 0"
  cat /tmp/researchloop-tasks-claim-a.log
  cat /tmp/researchloop-tasks-claim-b.log
  exit 1
fi

winner_log=""
loser_log=""
if grep -q '"id":"task-worker-1"' /tmp/researchloop-tasks-claim-a.log; then
  winner_log=/tmp/researchloop-tasks-claim-a.log
  loser_log=/tmp/researchloop-tasks-claim-b.log
fi
if grep -q '"id":"task-worker-1"' /tmp/researchloop-tasks-claim-b.log; then
  if [ -n "$winner_log" ]; then
    echo "both claim calls reported the same task"
    cat /tmp/researchloop-tasks-claim-a.log
    cat /tmp/researchloop-tasks-claim-b.log
    exit 1
  fi
  winner_log=/tmp/researchloop-tasks-claim-b.log
  loser_log=/tmp/researchloop-tasks-claim-a.log
fi
if [ -z "$winner_log" ]; then
  echo "expected one claim call to win task-worker-1"
  cat /tmp/researchloop-tasks-claim-a.log
  cat /tmp/researchloop-tasks-claim-b.log
  exit 1
fi
grep -q "no-task" "$loser_log"

$cli tasks status --dir "$tmpdir" >/tmp/researchloop-tasks-status-2.log
grep -q "Lane worker: open=0 claimed=1 blocked=1 done=0" /tmp/researchloop-tasks-status-2.log

set +e
$cli tasks claim --dir "$tmpdir" --agent gamma --lane worker >/tmp/researchloop-tasks-claim-blocked.log 2>&1
blocked_rc=$?
set -e
if [ "$blocked_rc" -ne 0 ]; then
  echo "blocked claim should still exit 0 with no-task"
  cat /tmp/researchloop-tasks-claim-blocked.log
  exit 1
fi
grep -q "no-task" /tmp/researchloop-tasks-claim-blocked.log

$cli tasks done task-worker-1 --dir "$tmpdir" --note "unblocked the second worker task" >/tmp/researchloop-tasks-done-1.log
grep -q "done: task-worker-1" /tmp/researchloop-tasks-done-1.log

$cli tasks claim --dir "$tmpdir" --agent delta --lane worker >/tmp/researchloop-tasks-claim-2.log
grep -q '"id":"task-worker-2"' /tmp/researchloop-tasks-claim-2.log
grep -q '"depends":\["task-worker-1"\]' /tmp/researchloop-tasks-claim-2.log

$cli tasks done task-worker-2 --dir "$tmpdir" --note "finished" >/tmp/researchloop-tasks-done-2.log
grep -q "done: task-worker-2" /tmp/researchloop-tasks-done-2.log

$cli tasks status --dir "$tmpdir" >/tmp/researchloop-tasks-status-3.log
grep -q "Lane orchestrator: open=1 claimed=0 blocked=0 done=0" /tmp/researchloop-tasks-status-3.log
grep -q "Lane reviewer: open=1 claimed=0 blocked=0 done=0" /tmp/researchloop-tasks-status-3.log
grep -q "Lane worker: open=0 claimed=0 blocked=0 done=2" /tmp/researchloop-tasks-status-3.log

echo "autoresearch test:tasks passed"
