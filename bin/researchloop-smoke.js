// `autoresearch smoke --command CMD` — actually-run smoke test, distinct from
// the static `preflight` checks.
//
// Runs the user's command through the normal `autoresearch run` pipeline but
// with a tight time budget (default 60s) and a `smoke-test` tag. The goal is
// not to get a final metric — it's to prove the command starts, doesn't crash
// in the first minute, and emits at least one parseable metric sample. A
// failed smoke saves the rest of the day.
//
// Recommended workflow: smoke before any sweep larger than 4 runs.

import path from "node:path";
import { spawnSync } from "node:child_process";

export async function cmdSmoke(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();

  const cmdRaw = option("--command", null);
  const cmdText = cmdRaw && typeof cmdRaw === "string" ? cmdRaw : "";
  if (!cmdText) {
    console.error("Usage: autoresearch smoke --command CMD [--seconds N] [--metric NAME] [--allow-unsafe] [--id ID] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const seconds = Math.max(5, parseInt(String(option("--seconds", "60")), 10) || 60);
  const metric = String(option("--metric", "val_loss")).trim() || "val_loss";
  const allowUnsafe = hasFlag("--allow-unsafe");
  const idBase = option("--id", null);
  const runId = idBase && typeof idBase === "string"
    ? String(idBase)
    : `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const cliPath = path.resolve(new URL(import.meta.url).pathname, "..", "researchloop.js");
  const args = [
    cliPath,
    "run",
    "--dir", cwd,
    "--id", runId,
    "--command", cmdText,
    "--metric", metric,
    "--timeout", String(seconds),
    "--no-system-sampling",
  ];
  if (allowUnsafe) args.push("--allow-unsafe");

  console.log(`autoresearch smoke (budget ${seconds}s)`);
  console.log(`command: ${cmdText}`);
  console.log(`metric: ${metric}`);
  console.log(`id: ${runId}`);
  console.log("---");

  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  const rc = result.status;

  console.log("---");
  if (rc === 0) {
    console.log("smoke: PASS — command started, did not crash within budget, recorded a row in the ledger.");
    console.log(`next: review with \`autoresearch story ${runId}\`, then launch the full run.`);
  } else {
    console.log(`smoke: FAIL — child exited ${rc}. Check the log under .researchloop/scratchpad/runs/${runId}/log.txt before scaling up.`);
    process.exitCode = rc;
  }
}
