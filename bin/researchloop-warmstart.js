// `autoresearch warmstart <run-id>` — generate a launch command that resumes
// a new experiment from an existing run's last checkpoint.
//
// Different from `resume`, which re-launches the SAME run to keep going.
// Warmstart says: "use that run's final weights as starting weights for a new
// experiment with possibly different hyperparameters." Common in continued
// pretraining, finetuning a sweep winner, or extending a partial training run
// with new data.
//
// Output is text — a ready-to-modify `autoresearch run --command "..."` block
// with the resume flag wired in (using the parent's `resume_flag_template`
// from eval.yaml if available, else a sensible default).

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById } from "./researchloop-core.js";

function readEvalYaml(cwd) {
  const p = path.join(cwd, ".researchloop", "eval.yaml");
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf8");
}

function extractResumeFlagTemplate(yamlText) {
  if (!yamlText) return null;
  const m = yamlText.match(/^\s*resume_flag_template:\s*['"]?([^'"\n]+)['"]?\s*$/m);
  return m ? m[1].trim() : null;
}

export async function cmdWarmstart(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();

  const idx = args.findIndex((a) => a === "warmstart");
  let parentId = String(option("--id", "")).trim();
  if (!parentId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    parentId = String(args[idx + 1]).trim();
  }
  if (!parentId) {
    console.error("Usage: autoresearch warmstart <run-id> [--new-id ID] [--checkpoint PATH] [--command CMD] [--metric NAME] [--out FILE.sh] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const parent = findRowById(rows, parentId);
  if (!parent) { console.error(`Run not found: ${parentId}`); process.exitCode = 1; return; }

  const checkpointFlag = option("--checkpoint", null);
  const checkpoint = checkpointFlag && typeof checkpointFlag === "string"
    ? checkpointFlag
    : (parent.last_checkpoint || null);
  if (!checkpoint) {
    console.error(`Parent run ${parentId} has no last_checkpoint. Pass --checkpoint PATH explicitly, or rerun parent with eval.yaml's checkpoint_glob configured.`);
    process.exitCode = 1;
    return;
  }

  const yamlText = readEvalYaml(cwd);
  const resumeTpl = extractResumeFlagTemplate(yamlText) || "--resume {path}";
  const resumeFlag = resumeTpl.replace(/\{path\}/g, checkpoint);

  // Use the user's --command if provided, else inherit the parent's.
  const cmdRaw = option("--command", null);
  const baseCmd = (cmdRaw && typeof cmdRaw === "string") ? cmdRaw : parent.command;
  if (!baseCmd) {
    console.error(`Parent ${parentId} has no recorded command and no --command was given.`);
    process.exitCode = 1;
    return;
  }
  // Append the resume flag if it isn't already present in the command.
  const cmdText = baseCmd.includes(checkpoint) ? baseCmd : `${baseCmd} ${resumeFlag}`;

  const newId = String(option("--new-id", `warm-${parentId}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const metricKeys = parent.metrics ? Object.keys(parent.metrics).filter((k) => !k.endsWith("_std")) : [];
  const metric = String(option("--metric", metricKeys[0] || "val_loss")).trim() || "val_loss";

  const block = [
    `# autoresearch warmstart`,
    `# parent_run: ${parentId}`,
    `# parent_checkpoint: ${checkpoint}`,
    `# resume_flag_template: ${resumeTpl}`,
    "",
    `autoresearch run \\`,
    `  --id ${newId} \\`,
    `  --metric ${metric} \\`,
    `  --command ${JSON.stringify(cmdText)}`,
    "",
    "# Notes:",
    "#   - parent_id pointer will be set automatically because the new run",
    "#     can reference the parent's checkpoint path; for the run lineage view,",
    "#     pass --id and use `autoresearch story` afterwards to confirm.",
    "#   - swap any hyperparameter flags in the command above before running.",
    "",
  ].join("\n");

  const outRaw = option("--out", null);
  if (outRaw && typeof outRaw === "string") {
    fs.writeFileSync(outRaw, "#!/usr/bin/env bash\nset -euo pipefail\n\n" + block);
    try { fs.chmodSync(outRaw, 0o755); } catch {}
    console.log(`wrote ${outRaw}`);
  } else {
    process.stdout.write(block);
  }
  if (hasFlag("--dry-run")) {
    console.error("(dry-run: not executed — review then run the command above.)");
  }
}
