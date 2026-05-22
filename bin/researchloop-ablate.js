// `autoresearch ablate <run-id>` — turn a winning config into structured
// ablation proposals.
//
// The agent's natural failure mode after a win is to chase tangential wins
// instead of asking "which part of the winning config actually mattered?"
// Ablation answers that. For each numeric param we emit halve / double / zero
// variants; for boolean params we emit a flip; for the special-cased dropout
// /scheduler/optimizer params we emit "remove" variants. The output is JSONL
// compatible with `propose`/`rank` so the agent can prioritize ablations
// against new experiments.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readLedgerRows, findRowById, ensureDir, numericParams } from "./researchloop-core.js";

const REMOVE_HINTS = ["dropout", "weight_decay", "warmup", "label_smoothing", "ema", "mixup", "cutmix"];

function makeAblationId(runId, change) {
  return "abl-" + runId + "-" + createHash("sha256").update(change).digest("hex").slice(0, 8);
}

function proposalsForRow(row) {
  const params = numericParams(row);
  const original = (row && row.params) || (row && row.config && row.config.params) || {};
  const out = [];

  for (const [key, num] of Object.entries(params)) {
    // halve
    out.push({
      change: `set ${key}=${num / 2}`,
      param: key,
      transform: "halve",
      from: num,
      to: num / 2,
      hypothesis: `${key} of ${num} is at least 2x too high — halving will not hurt the metric`,
    });
    // double
    out.push({
      change: `set ${key}=${num * 2}`,
      param: key,
      transform: "double",
      from: num,
      to: num * 2,
      hypothesis: `${key} of ${num} is at least 2x too low — doubling will not hurt the metric`,
    });
    // remove (set to 0) for known regularizers / smoothers
    if (REMOVE_HINTS.some((h) => key.toLowerCase().includes(h)) && num !== 0) {
      out.push({
        change: `set ${key}=0`,
        param: key,
        transform: "remove",
        from: num,
        to: 0,
        hypothesis: `${key} is doing nothing useful for the metric — removing it costs nothing`,
      });
    }
  }

  // Boolean flips.
  for (const [key, val] of Object.entries(original)) {
    if (typeof val !== "boolean") continue;
    out.push({
      change: `set ${key}=${!val}`,
      param: key,
      transform: "flip",
      from: val,
      to: !val,
      hypothesis: `${key} is not load-bearing — flipping it should not move the metric`,
    });
  }

  return out;
}

export async function cmdAblate(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const ablIdx = args.findIndex((a) => a === "ablate");
  let runId = String(option("--id", "")).trim();
  if (!runId && ablIdx !== -1 && args[ablIdx + 1] && !args[ablIdx + 1].startsWith("-")) {
    runId = String(args[ablIdx + 1]).trim();
  }

  if (!runId) {
    console.error("Usage: autoresearch ablate <run-id> [--n N] [--write] [--out FILE.jsonl] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const row = findRowById(rows, runId);
  if (!row) {
    console.error(`Run not found: ${runId}`);
    process.exitCode = 1;
    return;
  }

  const proposals = proposalsForRow(row);
  if (proposals.length === 0) {
    console.error(`No ablatable params on ${runId}. Add numeric or boolean entries to the run's params block.`);
    process.exitCode = 1;
    return;
  }

  const nRaw = parseInt(String(option("--n", String(proposals.length))), 10);
  const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, proposals.length) : proposals.length;
  const selected = proposals.slice(0, n).map((p) => ({
    id: makeAblationId(runId, p.change),
    title: `Ablate ${p.param} (${p.transform})`,
    parent_run: runId,
    parent_command: row.command || null,
    parent_metrics: row.metrics || null,
    ...p,
    kill_criterion: `metric degrades by > 2σ relative to ${runId}`,
    metric: row.metrics ? Object.keys(row.metrics).filter((k) => !k.endsWith("_std"))[0] || null : null,
    risk: p.transform === "double" || p.transform === "flip" ? "med" : "low",
    estimated_minutes: null,
    est_cost_usd_or_null: null,
    priors: [],
    created_at: new Date().toISOString(),
    mode: "ablation",
  }));

  if (hasFlag("--write")) {
    const outFlag = option("--out", null);
    const outPath = (outFlag && typeof outFlag === "string")
      ? outFlag
      : path.join(cwd, ".researchloop", "scratchpad", "ablations", `${runId}.jsonl`);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, selected.map((p) => JSON.stringify(p)).join("\n") + "\n");
    console.log(`wrote ${selected.length} ablations -> ${path.relative(cwd, outPath)}`);
    return;
  }

  if (formatJson) {
    console.log(JSON.stringify({ parent: runId, n: selected.length, ablations: selected }, null, 2));
    return;
  }

  console.log(`ablations for: ${runId}`);
  console.log(`n: ${selected.length} (of ${proposals.length} possible)`);
  console.log("---");
  console.log("| # | param | transform | from -> to | hypothesis |");
  console.log("| --- | --- | --- | --- | --- |");
  selected.forEach((p, i) => {
    console.log(`| ${i + 1} | ${p.param} | ${p.transform} | ${p.from} -> ${p.to} | ${p.hypothesis} |`);
  });
  console.log("---");
  console.log("Pass --write to persist these as ablations/<run-id>.jsonl (consumable by `rank`).");
}
