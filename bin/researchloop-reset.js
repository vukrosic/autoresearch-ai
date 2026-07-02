// `autoresearch reset --id <run-id>` — remove a run from the ledger.
//
// Sometimes you want a clean ledger. A typo run, a smoke test you ran by
// mistake, a row from a deleted branch. The current tooling has no way to
// remove anything — you have to hand-edit `runs.jsonl` and hope nothing else
// breaks. This command does it safely:
//
//   - confirms (or `--force`) the row exists
//   - rewrites `runs.jsonl` without the row
//   - moves the run dir to `.researchloop/scratchpad/runs.removed/<id>-<stamp>/`
//     so the change is recoverable for one session
//   - refuses to remove `status: promoted` rows without `--force` (those are
//     usually load-bearing for a downstream report)

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, rewriteLedger, ensureDir } from "./researchloop-core.js";

export async function cmdReset(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const runId = String(option("--id", "")).trim();
  if (!runId) {
    console.error("Usage: autoresearch reset --id <run-id> [--force] [--no-archive] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const row = findRowById(rows, runId);
  if (!row) {
    console.error(`Run not found in ledger: ${runId}`);
    process.exitCode = 1;
    return;
  }

  if (!hasFlag("--force") && String(row.status || "").toLowerCase() === "promoted") {
    console.error(`Refusing to remove a promoted run (${runId}). Re-run with --force if you really mean it.`);
    process.exitCode = 1;
    return;
  }

  // Move the run dir aside so the reset is recoverable.
  let movedTo = null;
  if (!hasFlag("--no-archive")) {
    const liveDir = path.join(cwd, ".researchloop", "scratchpad", "runs", runId);
    if (fs.existsSync(liveDir)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dest = path.join(cwd, ".researchloop", "scratchpad", "runs.removed", `${runId}-${stamp}`);
      ensureDir(path.dirname(dest));
      fs.renameSync(liveDir, dest);
      movedTo = dest;
    }
  }

  // Drop the row.
  const before = rows.length;
  const after = rows.filter((r) => String(r.id) !== String(runId));
  rewriteLedger(cwd, after);

  if (formatJson) {
    console.log(JSON.stringify({
      id: runId,
      removed: true,
      ledger_rows_before: before,
      ledger_rows_after: after.length,
      moved_to: movedTo,
    }, null, 2));
    return;
  }

  console.log(`removed: ${runId}`);
  console.log(`ledger rows: ${before} -> ${after.length}`);
  if (movedTo) console.log(`run dir moved -> ${path.relative(cwd, movedTo)} (recoverable by hand)`);
  else console.log(`(no run dir to move${hasFlag("--no-archive") ? "" : "; nothing on disk"})`);
}
