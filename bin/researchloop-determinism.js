// `autoresearch determinism` — verify a command's output is reproducible.
//
// Runs the user's command N times back-to-back (same seed env, same args) by
// shelling out to `autoresearch run` for each iteration, then collates the
// recorded ledger rows to report mean, std, range, coefficient of variation,
// and a deterministic / non-deterministic verdict against `--tolerance`.
//
// The orchestration lives outside researchloop.js so the main entry stays
// small. Each iteration goes through the regular `run` path, so safety policy,
// env capture, artifact contract, and ledger schema are reused — this file
// only invokes the CLI and aggregates results.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const NON_DETERMINISM_HINTS = [
  "set torch.backends.cudnn.deterministic=True and cudnn.benchmark=False",
  "seed Python (random), NumPy, Torch, and any framework RNGs explicitly",
  "set PYTHONHASHSEED",
  "use a single dataloader worker, or seed each worker via worker_init_fn",
  "avoid non-deterministic ops (scatter_add, atomicAdd, FFT, certain reductions)",
  "use deterministic algorithms: torch.use_deterministic_algorithms(True)",
  "disable mixed precision / TF32 for the audit if downstream code depends on bitwise equality",
  "freeze CUDA/cuDNN/Torch versions across runs (G14 env capture flags drift)",
];

function readLedgerRows(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) return [];
  return fs
    .readFileSync(ledgerFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findRowById(rows, id) {
  return rows.find((r) => String(r.id) === String(id)) || null;
}

function extractScalarMetric(row, metricName) {
  if (!row || !row.metrics) return null;
  const v = Number(row.metrics[metricName]);
  return Number.isFinite(v) ? v : null;
}

function arrMean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function arrStd(arr) {
  if (arr.length <= 1) return 0;
  const m = arrMean(arr);
  const ss = arr.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (arr.length - 1));
}

function fmt(n, digits = 6) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "null";
  return Number(n).toFixed(digits);
}

// Spawn `node <cli> run --command "..." --id ...` and forward its stdio.
// Returns { ok, status, output }. We rely on autoresearch run's own exit
// code: 0 = recorded (even if the metric didn't parse — that's still a data
// point of "no metric"), non-zero = the command itself failed.
function spawnOneRun({ cliPath, cwd, runId, cmdText, metricName, timeoutSec, allowUnsafe, extraSeed, quiet }) {
  const args = [
    cliPath,
    "run",
    "--dir", cwd,
    "--id", runId,
    "--command", cmdText,
    "--metric", metricName,
    "--no-system-sampling",
    "--timeout", String(timeoutSec),
  ];
  if (allowUnsafe) args.push("--allow-unsafe");
  const env = { ...process.env };
  if (Number.isFinite(extraSeed)) {
    env.RESEARCHLOOP_SEED = String(extraSeed);
  }
  const result = spawnSync(process.execPath, args, {
    env,
    cwd,
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    output: quiet ? `${result.stdout || ""}${result.stderr || ""}` : "",
  };
}

// One-letter helpers used to build the verdict string in both text/json.
function classifyDeterminism({ values, tolerance }) {
  const cleanValues = values.filter((v) => Number.isFinite(v));
  if (cleanValues.length < 2) {
    return {
      verdict: "insufficient_data",
      max_abs_dev: null,
      relative_spread: null,
      reason: "fewer than 2 successful runs with a parsed metric",
    };
  }
  const mean = arrMean(cleanValues);
  const maxDev = Math.max(...cleanValues.map((v) => Math.abs(v - mean)));
  const range = Math.max(...cleanValues) - Math.min(...cleanValues);
  const relSpread = Math.abs(mean) > 1e-12 ? range / Math.abs(mean) : 0;
  if (maxDev <= tolerance) {
    return { verdict: "deterministic", max_abs_dev: maxDev, relative_spread: relSpread, reason: null };
  }
  return {
    verdict: "non_deterministic",
    max_abs_dev: maxDev,
    relative_spread: relSpread,
    reason: `max |x - mean| = ${maxDev} > tolerance ${tolerance}`,
  };
}

export async function cmdDeterminism(ctx) {
  const { args, option, hasFlag, targetDir, appendRunRow } = ctx;

  const cwd = targetDir();
  const cmdRaw = option("--command", null);
  const cmdText = cmdRaw && typeof cmdRaw === "string" ? cmdRaw : "";
  const nRaw = parseInt(String(option("--n", "3")), 10);
  const n = Number.isFinite(nRaw) && nRaw >= 2 ? Math.min(nRaw, 20) : 3;
  const metricName = String(option("--metric", "val_loss")).trim() || "val_loss";
  const tolerance = Math.max(0, parseFloat(String(option("--tolerance", "1e-9"))));
  const timeoutSec = Number(option("--timeout", 600));
  const seedRaw = option("--seed", null);
  const fixedSeed = seedRaw && typeof seedRaw === "string" ? parseInt(seedRaw, 10) : null;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const allowUnsafe = hasFlag("--allow-unsafe");
  const noExit = hasFlag("--no-exit-code");
  const idBase = option("--id", null);

  if (!cmdText) {
    console.error("Usage: autoresearch determinism --command CMD [--n N] [--metric NAME] [--tolerance N] [--seed N] [--timeout SECONDS] [--format text|json] [--no-exit-code] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(path.join(cwd, ".researchloop"))) {
    console.error("No .researchloop directory found in " + cwd + ". Run `autoresearch init` first.");
    process.exitCode = 1;
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = idBase && typeof idBase === "string" ? idBase : `det-${stamp}`;
  const cliPath = path.resolve(new URL(import.meta.url).pathname, "..", "researchloop.js");
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  if (!formatJson) {
    console.log(`autoresearch determinism --n ${n}`);
    console.log(`command: ${cmdText}`);
    console.log(`metric: ${metricName}`);
    console.log(`tolerance: ${tolerance}`);
    if (Number.isFinite(fixedSeed)) console.log(`fixed_seed: ${fixedSeed}`);
    console.log("---");
  }

  const childIds = [];
  for (let i = 0; i < n; i += 1) {
    const childId = `${base}-iter${i}`;
    if (!formatJson) console.log(`[iter ${i + 1}/${n}] ${childId}`);
    spawnOneRun({
      cliPath,
      cwd,
      runId: childId,
      cmdText,
      metricName,
      timeoutSec,
      allowUnsafe,
      extraSeed: Number.isFinite(fixedSeed) ? fixedSeed : null,
      quiet: formatJson,
    });
    childIds.push(childId);
  }

  const rows = readLedgerRows(ledgerPath);
  const childRows = childIds.map((id) => findRowById(rows, id));
  const values = childRows.map((r) => extractScalarMetric(r, metricName));
  const finiteValues = values.filter((v) => v !== null);
  const successCount = childRows.filter((r) => r && (r.status === "complete" || r.status === "completed" || r.status === "promoted" || r.status === "kept")).length;

  const cls = classifyDeterminism({ values: finiteValues, tolerance });
  const mean = finiteValues.length > 0 ? arrMean(finiteValues) : null;
  const std = finiteValues.length > 0 ? arrStd(finiteValues) : null;
  const minV = finiteValues.length > 0 ? Math.min(...finiteValues) : null;
  const maxV = finiteValues.length > 0 ? Math.max(...finiteValues) : null;

  // Write an aggregator row tagged `determinism` so the result is durable evidence
  // queryable via the regular ledger tools.
  const aggRow = {
    id: base,
    timestamp: new Date().toISOString(),
    status: cls.verdict === "deterministic" ? "complete" : (cls.verdict === "non_deterministic" ? "complete" : "complete_no_metric"),
    agent: "autoresearch determinism",
    command: cmdText,
    metrics: mean !== null
      ? { [metricName]: Number(mean.toFixed(6)), [`${metricName}_std`]: Number((std || 0).toFixed(6)) }
      : {},
    determinism: {
      n,
      tolerance,
      values: finiteValues,
      verdict: cls.verdict,
      max_abs_dev: cls.max_abs_dev,
      relative_spread: cls.relative_spread,
      reason: cls.reason,
      child_run_ids: childIds,
      fixed_seed: Number.isFinite(fixedSeed) ? fixedSeed : null,
    },
    notes: `Determinism audit (n=${n}, tol=${tolerance}).`,
    tags: ["determinism-audit"],
  };
  if (appendRunRow) {
    appendRunRow(cwd, aggRow);
  }

  if (formatJson) {
    console.log(JSON.stringify({
      id: base,
      command: cmdText,
      metric: metricName,
      n,
      n_succeeded: successCount,
      n_parsed: finiteValues.length,
      values,
      mean,
      std,
      min: minV,
      max: maxV,
      tolerance,
      verdict: cls.verdict,
      max_abs_dev: cls.max_abs_dev,
      relative_spread: cls.relative_spread,
      reason: cls.reason,
      child_run_ids: childIds,
      hints: cls.verdict === "non_deterministic" ? NON_DETERMINISM_HINTS : [],
    }, null, 2));
  } else {
    console.log("---");
    console.log("| iter | id | status | metric |");
    console.log("| --- | --- | --- | --- |");
    for (let i = 0; i < childIds.length; i += 1) {
      const row = childRows[i];
      const v = values[i];
      console.log(`| ${i + 1} | ${childIds[i]} | ${row ? row.status : "missing"} | ${v === null ? "null" : fmt(v)} |`);
    }
    console.log("---");
    console.log(`n: ${n}`);
    console.log(`n_succeeded: ${successCount}`);
    console.log(`n_parsed: ${finiteValues.length}`);
    if (mean !== null) {
      console.log(`mean: ${fmt(mean)}`);
      console.log(`std: ${fmt(std)}`);
      console.log(`min: ${fmt(minV)}`);
      console.log(`max: ${fmt(maxV)}`);
      console.log(`max_abs_dev: ${fmt(cls.max_abs_dev)}`);
      console.log(`relative_spread: ${fmt(cls.relative_spread)}`);
    }
    console.log(`verdict: ${cls.verdict}`);
    if (cls.reason) console.log(`reason: ${cls.reason}`);
    console.log(`recorded: ${base}`);
    if (cls.verdict === "non_deterministic") {
      console.log("---");
      console.log("likely causes (investigate in order):");
      for (const hint of NON_DETERMINISM_HINTS) {
        console.log(`- ${hint}`);
      }
    }
  }

  if (!noExit && cls.verdict === "non_deterministic") {
    process.exitCode = 2;
  } else if (!noExit && cls.verdict === "insufficient_data") {
    process.exitCode = 1;
  }
}
