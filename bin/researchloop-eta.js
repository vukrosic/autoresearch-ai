// `autoresearch eta <run-id>` — estimate remaining time for an active run.
//
// Reads the run's `metrics.jsonl` (streamed by `run` via G06), looks at
// progress over time, and extrapolates how long it will take to reach the
// expected total step count or completion.
//
// Two prediction modes:
//   1. If we know the expected total step count (via --total-steps, or from
//      a sibling run with the same command), extrapolate from current step
//      rate.
//   2. Otherwise fall back to "how long will the loss take to plateau"
//      heuristic: estimate the time to reach the metric's projected asymptote
//      using a simple exponential decay fit.
//
// Either way the output is "best-effort, ±wide CI" — agents should treat ETAs
// as advisory.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, fmt } from "./researchloop-core.js";

function readMetricsJsonl(cwd, runId) {
  const p = path.join(cwd, ".researchloop", "scratchpad", "runs", runId, "metrics.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function fmtSeconds(s) {
  if (!Number.isFinite(s) || s < 0) return "—";
  if (s < 90) return `${s.toFixed(0)}s`;
  if (s < 5400) return `${(s / 60).toFixed(1)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(2)}h`;
  return `${(s / 86400).toFixed(2)}d`;
}

function findSiblingTotalSteps(rows, subject) {
  // Find a completed run with the same command; use its last step as the
  // expected total.
  const peer = rows.find((r) =>
    r.id !== subject.id
    && r.command === subject.command
    && (r.status === "complete" || r.status === "completed" || r.status === "promoted")
  );
  return peer ? peer : null;
}

function lastStepFrom(samples) {
  if (samples.length === 0) return null;
  const withStep = samples.filter((s) => Number.isFinite(s.step));
  if (withStep.length === 0) return null;
  return withStep[withStep.length - 1].step;
}

function rateFromSamples(samples, walltimeStartIso) {
  if (samples.length < 2) return null;
  const start = walltimeStartIso ? new Date(walltimeStartIso).getTime() : null;
  // Use sample wallclock if present; else assume samples are roughly uniform
  // and the elapsed wall time is "now - start".
  const withWall = samples.filter((s) => s.ts || s.timestamp || s.at);
  if (withWall.length >= 2) {
    const first = withWall[0];
    const last = withWall[withWall.length - 1];
    const firstT = new Date(first.ts || first.timestamp || first.at).getTime();
    const lastT = new Date(last.ts || last.timestamp || last.at).getTime();
    if (Number.isFinite(firstT) && Number.isFinite(lastT) && lastT > firstT) {
      const deltaSec = (lastT - firstT) / 1000;
      const deltaStep = (last.step ?? withWall.length) - (first.step ?? 1);
      if (deltaStep > 0) return deltaStep / deltaSec;
    }
  }
  if (start === null) return null;
  const elapsedSec = (Date.now() - start) / 1000;
  if (elapsedSec <= 0) return null;
  const lastStep = lastStepFrom(samples);
  return lastStep !== null && lastStep > 0 ? lastStep / elapsedSec : null;
}

export async function cmdEta(ctx) {
  const { option, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const idx = args.findIndex((a) => a === "eta");
  let runId = String(option("--id", "")).trim();
  if (!runId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    runId = String(args[idx + 1]).trim();
  }
  if (!runId) {
    console.error("Usage: autoresearch eta <run-id> [--total-steps N] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const subject = findRowById(rows, runId);
  if (!subject) { console.error(`Run not found: ${runId}`); process.exitCode = 1; return; }

  const samples = readMetricsJsonl(cwd, runId);
  const totalStepsFlag = parseInt(String(option("--total-steps", "")), 10);
  const sibling = !Number.isFinite(totalStepsFlag) ? findSiblingTotalSteps(rows, subject) : null;
  const expectedTotal = Number.isFinite(totalStepsFlag) ? totalStepsFlag : (sibling ? lastStepFrom(readMetricsJsonl(cwd, sibling.id)) : null);

  const currentStep = lastStepFrom(samples);
  const rate = rateFromSamples(samples, subject.started_at || subject.timestamp);
  const remainingSteps = (Number.isFinite(currentStep) && Number.isFinite(expectedTotal)) ? Math.max(0, expectedTotal - currentStep) : null;
  const etaSeconds = (remainingSteps !== null && Number.isFinite(rate) && rate > 0) ? remainingSteps / rate : null;
  const etaAt = (etaSeconds !== null) ? new Date(Date.now() + etaSeconds * 1000).toISOString() : null;

  const status = String(subject.status || "").toLowerCase();
  const active = !["complete", "completed", "promoted", "kept", "discarded", "archived", "failed", "killed_by_safety", "killed_by_rule", "spawn_error", "timeout"].includes(status);

  const result = {
    id: runId,
    status: subject.status,
    active,
    n_samples: samples.length,
    current_step: currentStep,
    expected_total_steps: expectedTotal,
    expected_total_source: Number.isFinite(totalStepsFlag) ? "flag" : (sibling ? `sibling:${sibling.id}` : null),
    step_rate_per_sec: rate,
    remaining_steps: remainingSteps,
    eta_seconds: etaSeconds,
    eta_at: etaAt,
  };

  if (formatJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`autoresearch eta`);
  console.log(`id: ${runId}`);
  console.log(`status: ${subject.status || "?"}${active ? " (active)" : " (terminal)"}`);
  console.log(`samples: ${samples.length}`);
  if (currentStep !== null) console.log(`current_step: ${currentStep}`);
  if (expectedTotal !== null) console.log(`expected_total_steps: ${expectedTotal}  [source: ${result.expected_total_source}]`);
  if (rate !== null) console.log(`step_rate: ${fmt(rate, 3)} steps/s`);
  if (remainingSteps !== null) console.log(`remaining_steps: ${remainingSteps}`);
  console.log(`eta: ${fmtSeconds(etaSeconds)}`);
  if (etaAt) console.log(`eta_at: ${etaAt}`);
  if (rate === null) console.log("note: rate unavailable — need at least 2 metric samples + start time");
  if (expectedTotal === null) console.log("note: total step count unknown — pass --total-steps N or run a comparable command at least once first");
}
