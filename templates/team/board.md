# AutoResearch-AI Team Board

Goal:
{{GOAL}}

Workers:
{{WORKER_COUNT}}

| # | Lane | Branch | Scope | Files | Status |
| --- | --- | --- | --- | --- | --- |
{{BOARD_ROWS}}

## How to use this board

- The human chooses the release target.
- The orchestrator assigns each lane to one worker branch or worktree.
- The reviewer checks the diff before merge.
- Only merge once the lane has evidence.
