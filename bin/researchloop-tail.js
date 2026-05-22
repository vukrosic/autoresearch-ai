// `autoresearch tail <run-id>` — tail a specific run's log file.
//
// Wraps the OS `tail -f` so the user doesn't have to remember the exact path
// of `.researchloop/scratchpad/runs/<id>/log.txt`. With `--metric`, also
// streams parsed metric samples from `metrics.jsonl` so the user can watch
// the loss without parsing log lines by eye.
//
// Implementation note: we don't reimplement tail-follow in Node — the OS
// tool is correct and well-debugged. We only handle the path resolution and
// the metric-stream side.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { readLedgerRows, findRowById, fmt } from "./researchloop-core.js";

function logPath(cwd, runId) {
  return path.join(cwd, ".researchloop", "scratchpad", "runs", runId, "log.txt");
}

function metricsPath(cwd, runId) {
  return path.join(cwd, ".researchloop", "scratchpad", "runs", runId, "metrics.jsonl");
}

function followMetrics(p, sinceOffset = 0) {
  let offset = sinceOffset;
  const fd = fs.openSync(p, "r");
  let buffer = "";
  function readMore() {
    const buf = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, offset);
    if (bytes > 0) {
      offset += bytes;
      buffer += buf.toString("utf8", 0, bytes);
      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          const step = Number.isFinite(obj.step) ? obj.step : "?";
          const metric = obj.metric || "?";
          const value = Number(obj.value);
          console.log(`[step ${String(step).padStart(6)}]  ${metric}=${fmt(value, 6)}`);
        } catch {
          // skip malformed line
        }
      }
    }
  }
  readMore();
  const interval = setInterval(readMore, 500);
  process.on("SIGINT", () => { clearInterval(interval); try { fs.closeSync(fd); } catch {} process.exit(0); });
  process.on("SIGTERM", () => { clearInterval(interval); try { fs.closeSync(fd); } catch {} process.exit(0); });
}

export async function cmdTail(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();

  // Positional after `tail`: run id.
  const idx = args.findIndex((a) => a === "tail");
  let runId = String(option("--id", "")).trim();
  if (!runId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    runId = String(args[idx + 1]).trim();
  }

  // --latest picks the most recent ledger row.
  if (!runId && hasFlag("--latest")) {
    const rows = readLedgerRows(cwd);
    if (rows.length === 0) { console.error("No rows in ledger to pick latest from."); process.exitCode = 1; return; }
    runId = rows[rows.length - 1].id;
  }

  if (!runId) {
    console.error("Usage: autoresearch tail <run-id> [--follow|-f] [--lines N] [--metrics] [--latest] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const row = findRowById(rows, runId);
  if (!row) { console.error(`Run not found in ledger: ${runId}`); process.exitCode = 1; return; }

  const showMetrics = hasFlag("--metrics");
  const follow = hasFlag("--follow") || hasFlag("-f");
  const lines = parseInt(String(option("--lines", "40")), 10) || 40;

  if (showMetrics) {
    const mp = metricsPath(cwd, runId);
    if (!fs.existsSync(mp)) {
      console.error(`No metrics.jsonl for ${runId} (expected ${mp}). The run may not have streamed any samples yet.`);
      process.exitCode = 1;
      return;
    }
    // Print existing lines first.
    const existing = fs.readFileSync(mp, "utf8").split("\n").filter(Boolean);
    for (const line of existing.slice(-lines)) {
      try {
        const obj = JSON.parse(line);
        const step = Number.isFinite(obj.step) ? obj.step : "?";
        const metric = obj.metric || "?";
        const value = Number(obj.value);
        console.log(`[step ${String(step).padStart(6)}]  ${metric}=${fmt(value, 6)}`);
      } catch {}
    }
    if (follow) {
      const st = fs.statSync(mp);
      followMetrics(mp, st.size);
    }
    return;
  }

  // Default: tail the run's log.txt via OS `tail`.
  const lp = logPath(cwd, runId);
  if (!fs.existsSync(lp)) {
    console.error(`No log for ${runId} (expected ${lp}).`);
    process.exitCode = 1;
    return;
  }
  const tailArgs = ["-n", String(lines)];
  if (follow) tailArgs.push("-f");
  tailArgs.push(lp);
  const child = spawn("tail", tailArgs, { stdio: "inherit" });
  process.on("SIGINT", () => { try { child.kill("SIGINT"); } catch {} });
  process.on("SIGTERM", () => { try { child.kill("SIGTERM"); } catch {} });
  child.on("exit", (code) => { process.exitCode = code; });
}
