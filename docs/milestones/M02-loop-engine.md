# M02 - Loop Engine

> **状态：** planned。这个文档是该 milestone 的事实来源。此 milestone 下的每个 GitHub issue 都链接到这里的一个章节。范围变化时更新本文档，而不是逐个改 issue。

## 赌注

今天的 AutoResearch-AI 是一个**有纪律的 logger**：它记录 experiments、baselines、env 和 run rows。但它还不会**决定下一步运行什么**。这个 milestone 用一个小型、可插拔 search loop 补上这个缺口。每个 plugin（history、ablation、paper-port、evolution）都只是一个函数：把 archive 转成下一批候选项的排名列表。loop 本身是一个 4 阶段 state machine；其他内容都是共享基础设施。

```text
                     ┌────────────────────┐
                     │   archive          │  runs.jsonl + mechanism + outcome
                     │   + failure ledger │  failures.jsonl (mechanism deaths)
                     └─────────┬──────────┘
                               │ read
   ┌───────────┐               ▼
   │ proposer  │  ────►  candidates.jsonl  (mechanism, files, ΔE, $)
   │ (plugin)  │
   └───────────┘               │
                               ▼
                     ┌────────────────────┐
                     │   evaluator        │  cheap-mode → full-mode
                     │   (run + budget)   │  kill on safety / divergence
                     └─────────┬──────────┘
                               ▼
                     ┌────────────────────┐
                     │   selector         │  rank, promote, kill,
                     │                    │  write outcome back to archive
                     └────────────────────┘
                               │ feed back
                               ▼
                          (next cycle)
```

---

## 依赖图

```text
F1 (archive schema) ─┬─► L1 (propose orch)     ─┬─► L2 (loop driver) ──► U3 (loop --watch)
                     │                          │
F2 (failure ledger) ─┼─► L3 (rank w/ failures)  ┘
                     │
F3 (proposer iface) ─┴─► P1 history ─► D1 dogfood             U1 archive view
                         P2 ablation ─► D2 dogfood             U2 dashboard panel
                         P3 paper-port ─► D3 dogfood
                         P4 evolution ─► D4 dogfood

E1 (cheap_mode schema) ─► E2 (run --cheap) ─► E3 (escalation, used by L2)
```

**关键路径：** F1 → L1 → L2 → first dogfood。F1+F2+F3 落地后，其余都可以并行。

## 并行度 - 谁可以同时工作

| Wave | 可并发的 issues | 为什么可并行 |
|---|---|---|
| **0** | F1, F2, F3, E1 | 每个都写自己的新文件到 `bin/lib/` 或 `templates/`；唯一碰撞点是 `bin/researchloop.js`，每个只在不同位置增加一小行注册。 |
| **1** | L1, L3, E2, U1 | F# 基础已落地。每个触碰不同命令。 |
| **2** | L2, E3, P1, P2, P3, P4, U2 | loop driver 本身顺序执行；proposer plugins 位于 `bin/proposers/<name>/`（无碰撞）。 |
| **3** | D1, D2, D3, D4, U3 | Dogfood 只依赖对应 plugin 已落地。 |

`bin/researchloop.js` 是唯一共享文件。每个 issue 把真实代码放在 `bin/lib/<module>.js` 或 `bin/proposers/<name>/`，只在 `researchloop.js` 增加 1-3 行命令注册。integration owner（reviewer）按 wave 顺序合并 PR。

---

## 本 milestone 中每个 issue 的共享约定

- **文件优先。** 每个新的 state file 都是 `.researchloop/` 下的 JSONL 或 YAML/Markdown。不引入 DB。
- **Plugin 使用 stdin/stdout。** 不使用 subprocess globals，不传环境变量。Plugin runner 把 JSON blob 交给 stdin，并从 stdout 读取 JSON。Plugin failure = 非零退出 + stderr 上的 JSON error。
- **JSON schemas 放在 `templates/schemas/`。** 每个新文件格式都带 schema。测试用一个很小的 `node bin/researchloop.js schema validate <file> <schema>` helper（F1 中添加）断言 schema。
- **每个 issue 一个测试脚本。** `scripts/test-<slug>.sh`，接入 `npm test`。脚本创建 temp dir，执行 happy path + 至少一个 failure path，失败时非零退出。
- **通过安全策略。** 所有 shell out 的命令必须经过 `evaluateCommandSafety`（G25）。Cheap-mode runs 遵守 `max_minutes_per_run`。
- **不在无 flag 情况下修改已发布命令。** 对 `run`、`rank`、`eval.yaml` 的扩展必须 opt-in（`--cheap`、新的可选 keys），确保现有 dogfoods 保持绿色。

---

## Wave 0 - 共享基础

### M02-F1 - Archive schema v2：mechanism、outcome、lineage

**研究员视角。** 跑多日 loop 的研究员需要 `runs.jsonl` 的每一行携带“实际变化是什么”以及“它活了还是死了”，否则 proposer 会反复建议已死亡机制，rank 命令也无法去重。

**Demo line.**
```text
$ autoresearch run --command "python train.py --dropout=0.1" \
    --mechanism "dropout=0.1" --parent-run-id r-014
[run r-018] dropout=0.1 → val_loss 2.38

$ autoresearch archive view --mechanism "dropout=*"
r-014  dropout=0.05  kept       val_loss 2.41
r-018  dropout=0.1   pending    val_loss 2.38
r-022  dropout=0.2   killed_baseline  val_loss 2.55
```

**追加到 `runs.jsonl` 每一行的新字段：**

| Field | Type | Required | 迁移默认值 | Notes |
|---|---|---|---|---|
| `mechanism` | string | yes (new rows) | `"unknown"` | 简短 human slug，≤ 60 chars。Canonicalize：小写，把 ` ` 替换成 `-`。 |
| `mechanism_hash` | string | yes (new rows) | sha256 of `"unknown"` | sha256(canonical(mechanism))，前 16 个 hex chars。 |
| `outcome` | enum | yes (new rows) | `"pending"` | `pending \| kept \| killed_baseline \| killed_budget \| killed_diverged \| killed_oom \| killed_safety \| discarded` |
| `parent_run_id` | string\|null | yes (new rows) | `null` | 被扰动的来源 run，fresh start 则为 `null`。 |
| `proposer` | string\|null | yes (new rows) | `null` | Plugin name。manual run 为 `null`。 |
| `cycle_id` | string\|null | yes (new rows) | `null` | L2 的 loop cycle id。manual run 为 `null`。 |
| `cheap` | bool | yes (new rows) | `false` | 由 E2（`--cheap`）设置。 |

**新模块：`bin/lib/archive.js`。** 导出：

```js
export function readArchive(dir = '.')           // → Array<row>
export function appendRow(row, dir = '.')        // validates against schema, appends
export function migrateRow(oldRow)               // → newRow with defaults
export function mechanismHash(mechanismStr)      // → 16-hex-char string
export function searchByMechanism(predicate, dir) // → Array<row>; predicate(row) → bool
export function findRunById(runId, dir)          // → row | null
```

**新命令：`autoresearch archive migrate [--dir PATH] [--dry-run]`。** 读取 `.researchloop/runs.jsonl`，对缺少 v2 字段的行应用 `migrateRow`，然后写回。带 `--dry-run` 时打印 diff 并以 0 退出。

**新 schema 文件：`templates/schemas/run-row.schema.json`。** v2 row 的 JSON Schema。测试和 L1 validator 都使用它。

**新 helper 命令：`autoresearch schema validate <file> <schema>`。** 通用 validator，之后所有 issue 的测试都会用到。

**验收。**
- [ ] `autoresearch run --command "echo hi" --mechanism "noop"` 写入一行，所有 v2 字段都有值，且 `mechanism_hash` 非空。
- [ ] 在 v1 ledger 上运行 `autoresearch archive migrate --dry-run`，打印只添加 v2 默认字段的 diff。
- [ ] 在 v1 ledger 上运行 `autoresearch archive migrate` 会转为 v2；再次运行是 no-op。
- [ ] `autoresearch archive view --mechanism "<glob>"` 按 mechanism glob 过滤行。
- [ ] `autoresearch schema validate .researchloop/runs.jsonl templates/schemas/run-row.schema.json` 在有效 ledger 上退出 0，在 corrupt ledger 上非零退出并带 line + field message。
- [ ] `scripts/test-archive-schema.sh` 覆盖：write+read、migration idempotency、bad rows 的 schema rejection、mechanism hash 跨 run 稳定。
- [ ] `npm test` 绿色。

**Anti-features.**
- 不改变现有 `metrics` / `env` / `command` row shape。严格 additive。
- 不引入数据库。JSONL 仍是磁盘格式。
- 不从 diff 自动推断 `mechanism`，那是 proposer 的工作。

**文件所有权。**
- `bin/lib/archive.js` (new)
- `bin/researchloop.js` (additions: `archive migrate`, `archive view`, `schema validate`)
- `templates/schemas/run-row.schema.json` (new)
- `scripts/test-archive-schema.sh` (new)
- `package.json` - add `test:archive-schema` to the `test` script

**依赖。** None。

---

### M02-F2 - Failure ledger

**研究员视角。** 让 loop 过夜运行的研究员需要 proposer 停止建议已经证明无效的东西，否则每个 cycle 都会反复争论同一个死机制并浪费 GPU-hour。

**Demo line.**
```text
$ autoresearch loop --plugin history --max-candidates 3
[cycle c-007] proposed 3 candidates
[c-007] candidate "dropout=0.2" → mechanism_hash matches dead entry from c-004 → skipped
[c-007] candidate "lr=1e-3"     → ran, val_loss 2.55 → kill: killed_baseline
[c-007] candidate "rope-base=20k" → ran, val_loss 2.36 → kept
$ cat .researchloop/failures.jsonl | wc -l
4
```

**新文件：`.researchloop/failures.jsonl`。** Append-only。每行：

```json
{
  "mechanism": "dropout=0.2",
  "mechanism_hash": "a3f9c1d2...",
  "reason": "below_baseline",
  "evidence_run_ids": ["r-022"],
  "first_attempt": "2026-05-18T02:14:00Z",
  "last_attempt": "2026-05-19T11:30:00Z",
  "attempts": 2,
  "baseline_metric": 2.40,
  "observed_metric": 2.55
}
```

`reason` ∈ `{below_baseline, diverged, oom, timeout, manual_kill, eval_error, killed_safety}`。

**新模块：`bin/lib/failures.js`。** 导出：

```js
export function appendFailure(rec, dir = '.')      // upserts by mechanism_hash; bumps `attempts` and `last_attempt`
export function lookupFailure(mechanismHash, dir)  // → record | null
export function isMechanismDead(mechanismHash, dir, { minAttempts = 1 } = {}) // → bool
export function readFailures(dir)                  // → Array<record>
export function nearestDeadMechanism(mechanism, dir, threshold = 0.85)
//   → { record, similarity } | null
//   similarity = Jaro-Winkler over canonicalized mechanism strings
```

**Append-on-kill 集成。** 在 `bin/researchloop.js` 的 run wrapper 中加一个小 hook：当 run 完成且 outcome ≠ `kept` 时，也用正确 reason 调用 `appendFailure`。这是 F2 中对现有 run 逻辑的唯一修改；它以 v2 schema 存在为前提。

**新 schema：`templates/schemas/failure.schema.json`。**

**验收。**
- [ ] 以 `killed_baseline` 结束的 run 之后，`.researchloop/failures.jsonl` 有一行带该 run 的 mechanism_hash 和 `attempts: 1`。
- [ ] 第二次同 mechanism_hash 的任意 kill state 会 bump `attempts: 2` 并更新 `last_attempt`，不会创建第二行。
- [ ] `isMechanismDead(hash)` 默认一次 kill 后返回 true。
- [ ] `nearestDeadMechanism("dropout=0.19", ...)` 返回 `dropout=0.2` 记录，similarity > 0.85。
- [ ] `scripts/test-failures.sh` 覆盖：append、upsert、similarity match、schema validation。

**Anti-features.**
- 不自动清理 entries。Dead is dead，直到 human 或未来 “reconsider” 命令清除。
- 不阻止 run 发生，只有 L3（rank）和 L2（loop）读取这个 ledger 做过滤/降权。

**文件所有权。**
- `bin/lib/failures.js` (new)
- `bin/researchloop.js` (hook in run wrapper; ~5 lines)
- `templates/schemas/failure.schema.json` (new)
- `scripts/test-failures.sh` (new)

**依赖。** F1。

---

### M02-F3 - Proposer plugin interface

**研究员视角。** 研究员（以及后续四个 plugin 作者）需要一个稳定、语言无关的契约：“给定 archive，返回一批排名候选项”。Plugin 应该可替换、可 fork，而不需要触碰 core。

**Demo line.**
```text
$ ls bin/proposers/
null/  history/  ablation/  paper-port/  evolution/

$ autoresearch propose --plugin null --k 3
[propose] plugin=null returned 0 candidates (expected for null)

$ autoresearch propose --plugin history --k 3
[propose] plugin=history returned 3 candidates → .researchloop/candidates.jsonl
```

**Plugin contract。** 每个 plugin 位于 `bin/proposers/<name>/index.{mjs,sh,py}`，并以 `<runtime> bin/proposers/<name>/index.<ext>` 调用。Plugin 从 stdin 读取一个 JSON blob，向 stdout 写一个 JSON blob。

**Stdin schema（plugin 输入）：**

```json
{
  "archive_path": ".researchloop/runs.jsonl",
  "failures_path": ".researchloop/failures.jsonl",
  "baseline": { "command": "...", "metric_name": "val_loss", "metric_value": 2.40, "git_sha": "..." },
  "budget": { "max_runs": 3, "max_minutes_per_run": 30 },
  "k": 3,
  "cycle_id": "c-007",
  "dir": "/abs/path/to/repo",
  "plugin_config": { /* optional, from .researchloop/proposers/<name>.yaml */ }
}
```

**Stdout schema（plugin 输出）：**

```json
{
  "proposer": "history",
  "cycle_id": "c-007",
  "candidates": [
    {
      "mechanism": "dropout=0.1",
      "rationale": "perturbing best-of-archive dropout=0.05 by +0.05 (top-3 sensitive)",
      "files_to_touch": ["configs/base.yaml"],
      "config_delta": { "dropout": 0.1 },
      "command_override": null,
      "parent_run_id": "r-014",
      "expected_delta": -0.02,
      "cost_estimate_usd": 0.40,
      "evidence": [ { "type": "run", "id": "r-014" } ]
    }
  ]
}
```

`expected_delta` 是有符号值：负数表示“目标是降低 val_loss，所以预期下降”。selector 基于 eval.yaml 中的 `metric_direction` 反转方向。

**新模块：`bin/lib/proposers.js`。** 导出：

```js
export function discoverProposers()                 // → [{ name, runtime, path }]
export function runProposer(name, input, opts)      // → { stdout, stderr, exitCode }
export function validateProposerOutput(output)      // → { ok, errors[] }
```

**Stub plugin：`bin/proposers/null/`。**
- `index.mjs`：读取 stdin，返回 `{ proposer: "null", cycle_id, candidates: [] }`。
- `README.md`：`Returns no candidates. Used to test the interface.`

**新 schema：`templates/schemas/proposer-input.schema.json`、`templates/schemas/proposer-output.schema.json`。**

**验收。**
- [ ] `discoverProposers()` 无需 registry file 就能发现 `null` plugin（从 `bin/proposers/*/index.*` 自动发现）。
- [ ] `autoresearch propose --plugin null` 成功返回 0 个 candidates。
- [ ] 不符合 schema 的输出（例如缺少 `mechanism` 字段）会被清晰错误行拒绝。
- [ ] 非零退出的 plugin 会生成包含 plugin stderr 的错误消息，不会 crash CLI。
- [ ] `scripts/test-proposers-interface.sh` 覆盖：null plugin happy path、bad-output rejection、plugin-crash handling、schema validation。

**Anti-features.**
- 不定义 Python 或 Node-only API。只使用 stdin/stdout JSON。
- 不执行 candidate commands。只有 L1/L2 执行。
- 不跨 cycle 缓存 plugin 输出（cache 是未来 issue）。

**文件所有权。**
- `bin/lib/proposers.js` (new)
- `bin/proposers/null/index.mjs` (new)
- `bin/proposers/null/README.md` (new)
- `templates/schemas/proposer-input.schema.json` (new)
- `templates/schemas/proposer-output.schema.json` (new)
- `scripts/test-proposers-interface.sh` (new)

**依赖。** F1（schemas + validator helper）。

---

### M02-E1 - `eval.yaml` cheap_mode block

**研究员视角。** 有 3 小时训练脚本的研究员需要 loop 先在 1-5% 规模上 sanity-check candidates，因为每个随机想法都花完整 GPU-hour 是自动搜索的主要成本。

**Demo line.**
```text
# .researchloop/eval.yaml
metric:
  name: val_loss
  direction: minimize
cheap_mode:
  data_fraction: 0.01
  max_steps: 500
  max_minutes: 5
  override_args: ["--max-steps=500", "--data-frac=0.01"]
  acceptance_band: 0.05   # cheap result within this of baseline → escalate to full
```

**Schema extension。** 向 `.researchloop/eval.yaml` 添加 `cheap_mode` 块。出现时必需 key：`max_minutes`；还需要 `override_args`（传给命令的 list）或 `data_fraction` + `max_steps`（advisory，E1 不强制，E2 负责接线）。

**验收。**
- [ ] `templates/eval.yaml` 在 header comment 中记录 `cheap_mode` 块。
- [ ] 更新 `templates/schemas/eval.schema.json`，且 `autoresearch schema validate .researchloop/eval.yaml ...` 能在新模板上通过。
- [ ] `docs/eval-schema.md` 用一个完整例子描述该 block。
- [ ] `scripts/test-eval-schema.sh` 同时验证 legacy（无 cheap_mode）和新模板。

**Anti-features.**
- 不执行任何东西，纯 schema/doc 变更。

**文件所有权。**
- `templates/eval.yaml`
- `templates/schemas/eval.schema.json` (new or extended)
- `docs/eval-schema.md` (new)
- `scripts/test-eval-schema.sh` (new)

**依赖。** None（G04 已发布）。

---

## Wave 1 - Loop driver + runner extensions

### M02-L1 - `autoresearch propose --plugin <name>`

**研究员视角。** 手动串起 `propose → run → compare` 的研究员需要一个命令来驱动 plugin，并把 candidates 暂存成真实、可重放的 batch，因为现在“agent 有了一个想法”和“我们运行了它”之间没有磁盘 artifact。

**Demo line.**
```text
$ autoresearch propose --plugin history --k 3 --cycle-id c-008
[propose] plugin=history → 3 candidates written to .researchloop/cycles/c-008/candidates.jsonl
$ autoresearch propose --explain c-008
candidate-0  dropout=0.1     parent=r-014  expected -0.02  $0.40
candidate-1  lr=2e-4         parent=r-014  expected -0.01  $0.40
candidate-2  rope-base=20000 parent=r-014  expected -0.03  $0.40
```

**行为。**
- 从 `.researchloop/baseline.lock`（G27）或 `.researchloop/baseline.md`（G26）读取 baseline。
- 构造 plugin input blob，通过 `bin/lib/proposers.js` 运行 plugin，并验证输出。
- 把 candidates 写到 `.researchloop/cycles/<cycle_id>/candidates.jsonl`（省略 cycle_id 时自动生成；格式：`c-NNN`，zero-padded next index）。
- `--explain <cycle_id>` pretty-print candidate batch。
- `--dry-run` 运行 plugin 但不写任何 state。

**验收。**
- [ ] `propose --plugin null --k 1` 退出 0 并写入有效的空 candidates file。
- [ ] `propose --plugin history --k 3` 写入 3 行 schema-valid candidate。
- [ ] 缺少 baseline → 非零退出，并提示 `baseline-status`（G26）。
- [ ] Plugin 输出不符合 schema → 非零退出，并给出 violation 的 line + field。
- [ ] `propose --explain c-XXX` 打印 table；cycle 缺失时给出清晰错误。
- [ ] `scripts/test-propose-plugin.sh` 覆盖 happy path + missing baseline + bad plugin output + `--dry-run`。

**Anti-features.**
- 不执行 candidates，只暂存。
- 不 rank，那是 L3。

**文件所有权。**
- `bin/researchloop.js` (extend `cmdPropose`)
- `scripts/test-propose-plugin.sh` (new)

**依赖。** F1, F3。

---

### M02-L3 - rank with failure awareness

**研究员视角。** review 明天 candidate batch 的研究员需要 ranked list 把已经证明无效的东西压下去，否则 top-K 会被重复建议污染。

**Demo line.**
```text
$ autoresearch rank c-008
rank  cand-id          mechanism        score   notes
  1   c-008-cand-2     rope-base=20000  0.78    novel mechanism
  2   c-008-cand-1     lr=2e-4          0.62    novel mechanism
  3   c-008-cand-0     dropout=0.1      0.05    PENALIZED: similar to dead mechanism "dropout=0.2" (sim 0.91)
```

**行为。**
- 扩展现有 `rank`（G02）。读取 `failures.jsonl`，对 `mechanism_hash` 在 ledger 中，或 `nearestDeadMechanism` similarity > 0.85 的 candidate 应用乘性惩罚 `(1 - similarity)`。
- 惩罚表面显示在 explanation 列。

**验收。**
- [ ] 与 dead `mechanism_hash` exact-match 的 candidate 排最后，score ≤ 0.1，且带 `PENALIZED` note。
- [ ] 与 dead entry similarity 0.91 的 candidate 按比例受惩罚。
- [ ] novel mechanism 排在任何 penalized 之前。
- [ ] `scripts/test-rank-failures.sh` 覆盖 exact match + near match + no failures present。

**Anti-features.**
- 不从文件移除 penalized candidates，只重排/标注。

**文件所有权。**
- `bin/researchloop.js` (extend `cmdRank`)
- `scripts/test-rank-failures.sh` (new)

**依赖。** F2。

---

### M02-E2 - `autoresearch run --cheap`

**研究员视角。** 让 loop 过夜运行的研究员需要 `run --cheap` 真正在 1-5% 规模上执行 candidate 并把行标记为 cheap，否则 archive 里无法区分筛掉的想法和完整训练后失败的想法。

**Demo line.**
```text
$ autoresearch run --cheap --command "python train.py" --mechanism "dropout=0.1"
[run r-019] CHEAP mode (max-steps=500, data-frac=0.01) → val_loss 2.45 in 4m12s
$ autoresearch archive view --cheap-only
r-019  dropout=0.1   cheap  pending  val_loss 2.45
```

**行为。**
- 从 `.researchloop/eval.yaml` 读取 `cheap_mode` 块。缺失时非零退出，并指向 E1。
- 在调用前把 `override_args` 追加到 command。
- 通过现有 safety policy（G25）强制 `max_minutes`。
- 在 row 上设置 `cheap: true`。
- Row 的 `outcome` 保持 `pending`；selector（L2）决定 escalation/kill。

**验收。**
- [ ] 无 `cheap_mode` block 时运行 `run --cheap`，以清晰消息非零退出。
- [ ] cheap run 遵守 `max_minutes`（到 cap 时 kill，`outcome: killed_safety` 且 `cheap: true`）。
- [ ] 结果 row 有 `cheap: true`，并且 override_args 出现在 `row.command`。
- [ ] `scripts/test-cheap-mode.sh` 覆盖 happy path、missing config、time-cap kill。

**Anti-features.**
- 不自动 escalate。E3 做这件事。
- 不改变无 `--cheap` 时的 `run` 行为。

**文件所有权。**
- `bin/researchloop.js` (extend `cmdRun`)
- `scripts/test-cheap-mode.sh` (new)

**依赖。** E1, F1。

---

### M02-U1 - `autoresearch archive view` / `archive search`

**研究员视角。** 研究员（以及每个 plugin 作者）需要按 mechanism、outcome、proposer 和 cycle 快速查询 archive，因为手动 grep JSONL 的摩擦会让人停止使用自己的工具。

**Demo line.**
```text
$ autoresearch archive view --proposer history --outcome kept --limit 5
$ autoresearch archive search --mechanism "dropout=*" --since 2026-05-15
$ autoresearch archive view --cycle c-007 --format json
```

**验收。**
- [ ] 四个 filter 都工作且可组合（AND semantics）。
- [ ] `--mechanism` 支持 glob。
- [ ] `--format json` 输出 JSON array；`--format text` 是默认 table。
- [ ] `scripts/test-archive-view.sh` 覆盖每个 filter、format、no-match 和 corrupt-row tolerance。

**Anti-features.**
- 不修改 archive。

**文件所有权。**
- `bin/researchloop.js` (extend `cmdArchive`)
- `scripts/test-archive-view.sh` (new)

**依赖。** F1。

---

## Wave 2 - Loop driver + proposer plugins

### M02-L2 - `autoresearch loop`

**研究员视角。** 想离开一小时的研究员需要**一个**命令运行 propose → rank → cheap-eval → select → write-back，因为手动串命令会违背自动化的意义。

**Demo line.**
```text
$ autoresearch loop --plugin history --max-candidates 3 --budget-runs 3
[c-008] propose      → 3 candidates
[c-008] rank         → top 3: rope-base=20000, lr=2e-4, dropout=0.1 (penalized)
[c-008] cheap-eval   r-019 dropout=0.1   → val_loss 2.45 (over baseline 2.40) → killed_baseline
[c-008] cheap-eval   r-020 lr=2e-4       → val_loss 2.38 (under baseline) → ESCALATE (E3)
[c-008] cheap-eval   r-021 rope-base=20k → val_loss 2.36 (under baseline) → ESCALATE (E3)
[c-008] cycle summary → .researchloop/cycles/c-008/SUMMARY.md
```

**行为。**
- 包装四个阶段。每个阶段把 artifact 写到 `.researchloop/cycles/<cycle_id>/`：
  - `candidates.jsonl` (L1)
  - `ranked.jsonl` (L3)
  - `runs.jsonl`（cheap-mode evals 的 rows；也追加到 global archive）
  - `SUMMARY.md`（human-readable cycle report，最后生成）
- Safety：如果 `baseline-status` 报告 incomplete，则拒绝启动。若 `safety.yaml` 缺失，也拒绝启动。
- Budget：如果存在 budget file，遵守现有 G67 budget command。
- Escalation：如果 E3 已发布，将通过 cheap run 升级到 full mode。如果 E3 不存在，把 row 标记为 `outcome: pending` 并在 `SUMMARY.md` 中输出 TODO list。

**新模块：`bin/lib/loop.js`。** 封装 cycle state machine。`bin/researchloop.js` 只注册 `cmdLoop` 并 delegate。

**验收。**
- [ ] `loop --plugin null` 以零 candidates 端到端运行，并写出说明 “no candidates proposed” 的 `SUMMARY.md`。
- [ ] 在有真实 baseline 的 repo 上运行 `loop --plugin history`，产生包含每个 candidate 的 mechanism、cheap result 和 decision 的 SUMMARY.md。
- [ ] 缺少 baseline → 非零退出，并提示 baseline-status。
- [ ] `--max-candidates 0` 以 no-op 退出 0。
- [ ] 超过 `max_minutes_per_run` 的 candidate 以 `killed_safety` 结束，并进入 failure ledger。
- [ ] `scripts/test-loop.sh` 覆盖 null happy path、history happy path（两个 passing + 一个 penalized candidate）、missing baseline、safety kill。

**Anti-features.**
- 不运行 daemon。每次 invocation 一个 cycle。U3 做 `--watch`。
- 不自动选择 plugin。调用者必须指定。

**文件所有权。**
- `bin/lib/loop.js` (new)
- `bin/researchloop.js` (register `cmdLoop`)
- `scripts/test-loop.sh` (new)

**依赖。** F1, F2, F3, L1, L3, E2。

---

### M02-E3 - cheap-to-full escalation

**研究员视角。** 研究员需要 cheap-mode winner 自动排入 full-mode confirmation，因为 cheap-mode 的意义是过滤；不会提升 winner 的过滤器没有价值。

**Demo line.**
```text
[c-008] cheap-eval r-020 lr=2e-4 → val_loss 2.38 (Δ -0.02, within 0.05 band of baseline)
[c-008] ESCALATE r-020 → full-mode run r-020-full enqueued
```

**行为。**
- 在 L2 中每次 cheap eval 后触发。
- 条件：`cheap_result.metric` 优于 baseline，或在 baseline 的 `acceptance_band` 内。
- 效果：排入一个 full-mode run（无 `--cheap`），并带相同 `mechanism`、`parent_run_id` 和 `cycle_id`。full-mode row 的 outcome 才用于 `kept`/`killed_baseline`。

**验收。**
- [ ] 有 improvement 的 cheap row 触发 full-mode row，二者共享 mechanism + cycle_id，但 full row 有 `cheap: false`。
- [ ] miss band 的 cheap row 不产生 full-mode follow-up，并在 cheap row 的 mechanism 上写 failure ledger entry。
- [ ] `scripts/test-escalation.sh` 覆盖两条分支。

**Anti-features.**
- 没有设置 `cheap_mode.acceptance_band` 时不 escalate。
- 同一 cycle 中已 escalated 的 mechanism 不再次 escalate。

**文件所有权。**
- `bin/lib/loop.js` (escalation function)
- `scripts/test-escalation.sh` (new)

**依赖。** L2, E2。

---

### M02-P1 - `history` proposer（chassis check）

**研究员视角。** 有 populated archive 的研究员需要第一个 plugin 简单扰动当前最佳 run 的最敏感维度，因为这是证明 loop interface 端到端可用的最便宜方式。

**Demo line.**
```text
$ autoresearch propose --plugin history --k 3
candidate-0 dropout=0.10   parent r-014  expected -0.02
candidate-1 lr=2.0e-4      parent r-014  expected -0.01
candidate-2 rope-base=20000 parent r-014  expected -0.03
```

**算法。**
1. 读取 archive。过滤 `outcome: kept` rows。按 metric 选择 top-K。
2. 在这些 row 的 `config_delta` 或 `command` 字符串中，计算每个 scalar key 的 variance。variance 前 3 = “sensitive dimensions”。
3. 对每个 sensitive dimension，提出一个对 best run 值的 perturbation（±25% 或 observed range 的 ±1σ，取较小者）。
4. 跳过 `mechanism_hash` 已在 failure ledger 中的 candidate。

**验收。**
- [ ] 在包含 5 个 `kept` rows 且变化 `dropout`、`lr`、`rope-base` 的 fixture archive 上，plugin 输出 3 个 candidate，分别触碰这三个 key。
- [ ] 在空 archive（没有 `kept` rows）上，plugin 返回 0 candidates，并给出 rationale “no kept runs to perturb from”。
- [ ] 死机制被跳过。
- [ ] `scripts/test-proposer-history.sh` 覆盖三者。

**Anti-features.**
- 不触碰 list/dict-valued keys（只处理 scalars）。
- 不调用任何 LLM。纯 analytical plugin。

**文件所有权。**
- `bin/proposers/history/index.mjs` (new)
- `bin/proposers/history/README.md` (new)
- `examples/fixtures/history-proposer/` (new - sample archive)
- `scripts/test-proposer-history.sh` (new)

**依赖。** F1, F2, F3。

---

### M02-P2 - `ablation` proposer

**研究员视角。** 有工作系统的研究员需要一个 plugin 自动逐个移除组件，找到到底是什么支撑指标，因为 ablation 是通向可发表 interpretability result 的最便宜路径，而人类经常跳过它。

**算法。**
1. 读取当前最佳 `kept` run 的 command + referenced config files。
2. 检查 repo：对 active config file(s) 中每个 top-level key，以及 entrypoint script（通常 `train.py` 或 `main.py`）中的每个 `import`，记录为一个 *component*。
3. 对每个 component，输出一个“移除”它的 candidate。Removal heuristics：
   - Config scalar：设为 schema default（没有 schema 则设为 `null`）。
   - Config list：替换为 `[]`。
   - Module import：把 call site 替换为 identity passthrough（plugin 不必实际做，只输出 `files_to_touch` plan，由 calling agent 实现）。
4. `expected_delta` 默认 0，因为 ablation 不是预测改进，而是测量贡献。

**验收。**
- [ ] 在一个 config 包含 `dropout`、`weight_decay`、`lr_scheduler` 的 fixture repo 上，plugin 输出 3 个 candidates，每个 zero/disable 一个。
- [ ] `mechanism` 字符串形如 `ablate:<component>`。
- [ ] `files_to_touch` 已填充；config-level ablations 的 `config_delta` 已填充。
- [ ] `scripts/test-proposer-ablation.sh` 覆盖 fixture + missing best-run case。

**Anti-features.**
- 不实际编辑文件，只输出 plan。
- 不试图在一个 cycle 中 ablate 所有东西；每个 candidate 一个 component，并受 `k` 限制。

**文件所有权。**
- `bin/proposers/ablation/index.mjs` (new)
- `bin/proposers/ablation/README.md` (new)
- `examples/fixtures/ablation-proposer/` (new)
- `scripts/test-proposer-ablation.sh` (new)

**依赖。** F1, F3。

---

### M02-P3 - `paper-port` proposer

**研究员视角。** 已对三篇 recent arxiv papers 运行 `paper-read` 的研究员需要一个 plugin，把这些笔记转换成本地 baseline 上的具体 porting candidates，因为无法变成实验的笔记只是 bookmark。

**算法。**
1. Glob `.researchloop/scratchpad/papers/*.md`。解析每个文件的五个必需 G29 section。
2. 对每个 `how to port this` section 非空的 note：
   - 提取 files-to-touch hints（`backticked paths` 或 `files:` 下的 paths）。
   - 构建 candidate：`mechanism: "port:<paper-id>:<short-claim>"`，`files_to_touch` 来自 hints，`evidence: [{type: "paper", id: paper_id}]`。
3. 如果 paper-id 的 mechanism_hash 已在 archive（已尝试）或 failures（已 kill）中，则跳过。

**验收。**
- [ ] 在包含两个 `paper-read` notes 的 fixture 上，plugin 输出两个 `mechanism` 以 `port:` 开头的 candidates。
- [ ] `how to port this` section 为空的 note 被跳过，并向 stderr 记录 `notes_incomplete` rationale。
- [ ] 已尝试 papers 被跳过。
- [ ] `scripts/test-proposer-paper-port.sh` 覆盖 fixture + skip cases。

**Anti-features.**
- 不抓取 arxiv。只读取已有 notes。
- 不实际 port code。

**文件所有权。**
- `bin/proposers/paper-port/index.mjs` (new)
- `bin/proposers/paper-port/README.md` (new)
- `examples/fixtures/paper-port-proposer/` (new)
- `scripts/test-proposer-paper-port.sh` (new)

**依赖。** F1, F3, G29。

---

### M02-P4 - `evolution` proposer（scoped）

**研究员视角。** 在有快速 deterministic eval 的子问题上（sampler tuning、loss tweaks、small-model arch），研究员需要 evolutionary search plugin 来保留 population 并 mutate best，因为对这些子问题 random + history 明显差于 guided evolution。

**行为。**
- 读取/写入 `.researchloop/evolution/<generation>.jsonl`，它是一组带 archive fitness scores 的 program/config snippets。
- 选择 top-N parents（默认 N=4，可配置）。
- 对每个 parent，构建 LLM mutation prompt（template：`templates/prompts/evolution-mutate.md`），并作为 candidate 输出；`files_to_touch` 是 parent 的 surface，`mechanism` 是 `evolve:gen-<g>:cand-<i>`。
- **重要约束。** 除非 `eval.yaml` 中有 `cheap_mode.max_minutes <= 10`，否则 plugin 拒绝运行。Evolution 需要 fast eval；在慢 eval 上不应使用此 plugin。
- Plugin 本身**不调用 LLM**。它把 mutation prompt 写入 candidate 的 `rationale` 字段，并写入 cycle dir 下的 sidecar `mutation-prompt.md`；期望 orchestrating agent（Claude/Codex/Cursor）读取并应用它。这样 plugin 保持 offline-safe。

**验收。**
- [ ] 当 `cheap_mode.max_minutes > 10`（或缺失）时拒绝运行，并给出清晰消息。
- [ ] generation 0 且没有 population 时，从 history-best 作为 parents 输出 candidates。
- [ ] 原子写入 generation files（temp + rename）。
- [ ] `mechanism` 字符串编码 generation + parent + slot。
- [ ] `scripts/test-proposer-evolution.sh` 覆盖 refuse-path + happy generation-0 + generation-1 reading prior population。

**Anti-features.**
- 不直接调用 LLM。
- 不绕过 sub-problem 约束检查。
- 不在 `.researchloop/evolution/` 之外跨 cycle cross-pollinate。

**文件所有权。**
- `bin/proposers/evolution/index.mjs` (new)
- `bin/proposers/evolution/README.md` (new)
- `templates/prompts/evolution-mutate.md` (new)
- `examples/fixtures/evolution-proposer/` (new)
- `scripts/test-proposer-evolution.sh` (new)

**依赖。** F1, F3, E1。

---

### M02-U2 - Dashboard “loop” panel

**研究员视角。** 已经运行 `dashboard` 的研究员需要一个 loop view，列出最近 cycles、每个 cycle 的 candidate batch 和每个 candidate outcome，因为在 `archive view` 和 dashboard 之间来回切换正是团队丢失上下文的地方。

**行为。**
- 在现有静态 dashboard 中添加新页面 `/loop`。
- 读取 `.researchloop/cycles/*/SUMMARY.md`，渲染 cycle table，并展示 pass/fail counts 的 sparkline。
- 点击 cycle 会 inline 渲染其 `SUMMARY.md`。

**验收。**
- [ ] 至少存在一个 cycle 后，`autoresearch dashboard` 在 nav 中显示 “Loop” 链接。
- [ ] loop page 渲染包含 cycle_id、plugin、candidates、kept count、killed count、started_at 的 table。
- [ ] Empty state（无 cycles）显示 “run `autoresearch loop` to start” 提示。

**Anti-features.**
- 不添加 live updates。静态 read-on-load 符合现有 dashboard contract。

**文件所有权。**
- `templates/dashboard/loop.html` (new)
- `bin/researchloop.js` (server route)
- `scripts/test-dashboard-loop.sh` (new)

**依赖。** L2。

---

## Wave 3 - Dogfood gates + watch mode

### M02-D1..D4 - 每个 plugin 的 Dogfood

对 P1..P4 中每个 plugin，在 `llm-research-kit`（或等价小 fixture）上运行完整 cycle，并提交：

- `examples/dogfood/<plugin>-proposer/`，其中包含：
  - cycle 的 `candidates.jsonl`、`ranked.jsonl`、`SUMMARY.md`（复制）。
  - 一个 `RESULT.md`，记录：什么工作了、哪里需要 manual rescue、哪个 G## 或 M02 issue 本可避免每个 rescue。
  - 一段短 asciinema 或 text transcript。

每个 dogfood 都是单独 issue。每个 dogfood 必须：
- [ ] 从 clean clone 运行，不修改 loop code。
- [ ] 产生至少一个 `outcome: kept` candidate，或记录为什么一个都无法 kept（negative-result acceptance）。
- [ ] 关闭前让 `RESULT.md` 经过 peer review。

**依赖。** 对应 P# 加 L2。

---

### M02-U3 - `autoresearch loop --watch`

**研究员视角。** 准备离开一整晚的研究员需要 loop 一直循环，直到 budget 停止它，因为手动重复运行 `autoresearch loop` 是 `cron` 的工作，但 cron 不懂 budgets。

**行为。**
- `autoresearch loop --watch --plugin <name> --interval 0` 运行一个 cycle，然后无延迟运行下一个（`--interval N` 增加 N 秒）。
- 停止条件：
  - G67 budget 达到（写入 BUDGET_HALT.md 并退出 0）。
  - 连续三个 cycle 没有 `kept` candidates（写入 STAGNATION.md 并退出 0）。
  - SIGINT - clean shutdown，完成当前 cycle。

**验收。**
- [ ] 没有 budget file 时，`--watch` 可以运行并在 mid-cycle 被 SIGINT 干净停止。
- [ ] 有 tiny budget 时，以正确 halt file 退出 0。
- [ ] 在 plugin 总是返回 0 candidates 的 fixture 上，stagnation detection 生效。
- [ ] `scripts/test-loop-watch.sh` 覆盖三种退出。

**Anti-features.**
- 不 daemonize / fork 到后台。只作为 foreground process。

**文件所有权。**
- `bin/lib/loop.js` (watch loop)
- `bin/researchloop.js` (flag wiring)
- `scripts/test-loop-watch.sh` (new)

**依赖。** L2, G67（budget command，已在 issues queue 发布）。

---

## M02 范围外（标为 follow-ups，不要扩展）

- **Cross-repo archive sharing / team mode.** 属于 VISION.md 中的 hosted layer。
- **任何 plugin 内部的 LLM API calls.** M02 中所有 plugins 都 offline-safe。P4 中的 LLM-mediated mutation 通过 prompt-file handoff 给 calling agent。
- **Self-modifying loop / meta-search.** 能 mutate 其他 proposers 的 proposer 是单独 milestone。
- **真实 billing integration.** Cost 保持为每行记录的 `cost_usd`（G23 surface）。
- **用于编辑 candidates 的 web UI.** Files first。Dashboard 只读。

---

## M02 Release gate

M02 在以下条件满足时发布：

1. F1, F2, F3, L1, L2, L3, E1, E2 已合并且 `npm test` 绿色。
2. 至少**两个** proposer plugins（P1 + 另一个）有绿色 dogfoods（D1 + D2/D3/D4 之一）。
3. Dashboard loop panel 可以渲染。
4. `loop --watch` 在 `llm-research-kit` 上的短 demo recording 已提交到 `assets/demo/M02-loop.cast`。

其他内容（剩余 proposers、U3 watch mode、额外 dogfoods）都是 post-gate polish，但应在声明 0.5.0 前落地。
