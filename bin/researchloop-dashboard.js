import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

function isNumericMetric(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function choosePrimaryMetric(goal, runs) {
  const metricHint = String(goal?.metric || "").trim();
  const metricKeys = new Set();
  for (const run of runs) {
    for (const key of Object.keys(run.metrics || {})) {
      if (isNumericMetric(run.metrics[key])) {
        metricKeys.add(key);
      }
    }
  }

  if (metricHint && metricKeys.has(metricHint)) {
    return metricHint;
  }
  if (metricKeys.has("val_loss")) {
    return "val_loss";
  }
  if (metricKeys.has("loss")) {
    return "loss";
  }
  return metricKeys.values().next().value || "";
}

export function summarizeDashboardRuns(runs, primaryMetric, preferHigher = false) {
  const completeRuns = runs.filter((run) => run.status === "complete" || run.status === "completed");
  const parseErrors = runs.filter((run) => run.parse_error).length;
  const latestRun = [...runs].reverse().find((run) => !run.parse_error) || null;

  const metricEntries = runs
    .map((run, index) => ({
      run,
      index,
      value: primaryMetric && isNumericMetric(run.metrics?.[primaryMetric]) ? Number(run.metrics[primaryMetric]) : Number.NaN,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  metricEntries.sort((a, b) => (preferHigher ? b.value - a.value : a.value - b.value));
  const bestRun = metricEntries[0] || null;
  const worstRun = metricEntries[metricEntries.length - 1] || null;
  const series = metricEntries
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      id: entry.run.id,
      value: entry.value,
      timestamp: entry.run.timestamp,
    }));

  const costEntries = runs
    .map((run) => run.est_cost_usd)
    .filter((v) => v != null && typeof v === "number" && Number.isFinite(v));
  const totalCost = costEntries.reduce((s, v) => s + v, 0);
  const avgCost = costEntries.length > 0 ? totalCost / costEntries.length : null;

  return {
    totalRuns: runs.length,
    completeRuns: completeRuns.length,
    parseErrors,
    latestRun,
    bestRun,
    worstRun,
    series,
    totalCost: costEntries.length > 0 ? totalCost : null,
    avgCost,
    latestRunCost: latestRun?.est_cost_usd ?? null,
  };
}

export function summarizeTraces(traces, preferHigher = false) {
  const finalEntries = traces
    .map((trace) => ({ trace, final: Number(trace.final) }))
    .filter((entry) => Number.isFinite(entry.final));
  const sorted = finalEntries
    .slice()
    .sort((a, b) => (preferHigher ? b.final - a.final : a.final - b.final));
  const bestFinal = sorted[0] || null;
  const worstFinal = sorted[sorted.length - 1] || null;

  const improved = traces
    .map((trace) => {
      const first = Number(trace.values?.[0]?.value);
      const final = Number(trace.final);
      return {
        trace,
        delta: Number.isFinite(first) && Number.isFinite(final)
          ? (preferHigher ? final - first : first - final)
          : Number.NaN,
      };
    })
    .filter((entry) => Number.isFinite(entry.delta))
    .sort((a, b) => b.delta - a.delta);

  return {
    bestFinal,
    worstFinal,
    bestImprovement: improved[0] || null,
  };
}

export function buildRunLineage(runs, primaryMetric) {
  const nodes = new Map();
  const ordered = [];

  runs
    .filter((run) => !run.parse_error && run && run.id)
    .forEach((run, index) => {
      const metricRaw = primaryMetric ? run.metrics?.[primaryMetric] : null;
      const metricValue = Number(metricRaw);
      const node = {
        id: run.id,
        status: run.status || "",
        parent_id: run.parent_id || null,
        timestamp: run.timestamp || run.started_at || null,
        metric: Number.isFinite(metricValue) ? metricValue : null,
        children: [],
        order: index,
      };
      nodes.set(node.id, node);
      ordered.push(node);
    });

  const roots = [];
  for (const node of ordered) {
    const parentId = node.parent_id;
    if (parentId && parentId !== node.id && nodes.has(parentId)) {
      nodes.get(parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }

  const strip = (node) => ({
    id: node.id,
    status: node.status,
    parent_id: node.parent_id,
    timestamp: node.timestamp,
    metric: node.metric,
    children: node.children.map(strip),
  });

  return { roots: roots.map(strip) };
}

export function buildRunTraces({
  cwd,
  runs,
  primaryMetric,
  preferHigher,
  customRegexSource,
  readRunMetricSeries,
}) {
  const palette = [
    "#62d6a6",
    "#71a7ff",
    "#f6c177",
    "#ff8b8b",
    "#c38bff",
    "#6ee7e7",
  ];
  const reader = typeof readRunMetricSeries === "function"
    ? readRunMetricSeries
    : () => [];

  return runs
    .filter((run) => !run.parse_error)
    .map((run, index) => {
      const values = reader(cwd, run, primaryMetric, customRegexSource);
      const metricRaw = run?.metrics?.[primaryMetric];
      const finalFromMetrics = metricRaw !== null && metricRaw !== undefined && metricRaw !== "" ? Number(metricRaw) : Number.NaN;
      const final = Number.isFinite(finalFromMetrics)
        ? finalFromMetrics
        : Number(values.length ? values[values.length - 1].value : Number.NaN);
      const fallbackValues = values.length
        ? values
        : (Number.isFinite(final) ? [{ step: 1, value: final }] : []);
      return {
        id: run.id,
        status: run.status,
        final,
        values: fallbackValues,
        log: run.log || "",
        notes: run.notes || "",
        color: palette[index % palette.length],
        isBest: false,
        isLatest: false,
        index,
      };
    })
    .filter((trace) => trace.values.length || Number.isFinite(trace.final))
    .map((trace) => ({
      ...trace,
      final: Number.isFinite(trace.final) ? trace.final : (trace.values.length ? trace.values[trace.values.length - 1].value : Number.NaN),
    }));
}

export function readSystemMetrics() {
  const cpus = os.cpus() || [];
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
  const cpuCount = cpus.length || 1;
  const loadPct = Math.min(100, (loadAvg[0] / cpuCount) * 100);
  const platform = `${os.platform()} ${os.arch()}`;
  const hostname = os.hostname();
  const nodeVersion = process.version;

  return {
    hostname,
    platform,
    nodeVersion,
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      count: cpuCount,
      model: cpus[0]?.model || "unknown",
      loadAvg: { "1m": loadAvg[0], "5m": loadAvg[1], "15m": loadAvg[2] },
      usagePct: Number.isFinite(loadPct) ? Number(loadPct.toFixed(1)) : 0,
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usagePct: Number(memPct.toFixed(1)),
    },
  };
}

export function readThreadTail(cwd, lineCount = 24) {
  const threadPath = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  const text = fs.existsSync(threadPath) ? fs.readFileSync(threadPath, "utf8") : "";
  if (!text) return { path: threadPath, lines: [], hasContent: false };
  const lines = text.split("\n").filter(Boolean).slice(-lineCount);
  return { path: threadPath, lines, hasContent: lines.length > 0 };
}

export function readLatestLogTail(cwd, runs, lineCount = 30) {
  const latest = [...(runs || [])].reverse().find((run) => run && run.log && !run.parse_error);
  if (!latest) return null;
  const logPath = path.join(cwd, latest.log);
  if (!fs.existsSync(logPath)) return { runId: latest.id, path: logPath, lines: [], modifiedAt: null };
  let modifiedAt = null;
  try {
    modifiedAt = fs.statSync(logPath).mtime.toISOString();
  } catch {
    modifiedAt = null;
  }
  const raw = fs.readFileSync(logPath, "utf8");
  const lines = raw ? raw.split("\n").slice(-lineCount) : [];
  return { runId: latest.id, path: logPath, lines, modifiedAt };
}

export function detectActiveRun(cwd, runs, logTail) {
  if (!runs || !runs.length) return { active: false };
  const latest = [...runs].reverse().find((run) => run && !run.parse_error);
  if (!latest) return { active: false };
  const inFlightStatuses = new Set(["running", "in_progress", "queued"]);
  const statusActive = inFlightStatuses.has(String(latest.status || "").toLowerCase());
  let recentlyTouched = false;
  if (logTail?.modifiedAt) {
    const mtime = new Date(logTail.modifiedAt).getTime();
    if (Number.isFinite(mtime)) {
      recentlyTouched = Date.now() - mtime < 60_000;
    }
  }
  if (!statusActive && !recentlyTouched) return { active: false, latestId: latest.id };
  return {
    active: true,
    latestId: latest.id,
    runId: latest.id,
    command: latest.command || "",
    agent: latest.agent || "",
    startedAt: latest.started_at || latest.timestamp || null,
    logPath: latest.log || "",
    logModifiedAt: logTail?.modifiedAt || null,
    reason: statusActive ? "status" : "log_recent",
    est_cost_usd: latest.est_cost_usd ?? null,
  };
}

export function readCurvesForRun(cwd, runId) {
  if (!runId) return { run_id: null, error: "missing run id", series: [] };
  const safeId = String(runId).replace(/[^A-Za-z0-9._-]/g, "");
  if (safeId !== String(runId)) {
    return { run_id: runId, error: "invalid run id", series: [] };
  }
  const file = path.join(cwd, ".researchloop", "scratchpad", "runs", safeId, "metrics.jsonl");
  if (!fs.existsSync(file)) {
    return { run_id: safeId, error: "no metrics.jsonl for run", series: [] };
  }
  const series = [];
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return { run_id: safeId, series: [] };
  for (const line of raw.split("\n")) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && Number.isFinite(Number(obj.step))) {
        series.push({
          metric: obj.metric ?? null,
          step: Number(obj.step),
          value: obj.value === null || obj.value === undefined ? null : Number(obj.value),
        });
      }
    } catch { /* skip malformed */ }
  }
  return { run_id: safeId, series };
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function valueIsEqual(a, b) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === b) return true;
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b)) return true;
  return false;
}

function compareDiffValue(path, a, b, out) {
  const pathLabel = String(path || "");
  if (a === undefined && b === undefined) {
    return;
  }
  if (a === undefined) {
    out.only_in_b.push(pathLabel);
    out.differences.push({ path: pathLabel, a: null, b });
    return;
  }
  if (b === undefined) {
    out.only_in_a.push(pathLabel);
    out.differences.push({ path: pathLabel, a, b: null });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    if (a.length === b.length) {
      for (let i = 0; i < max; i += 1) {
        compareDiffValue(`${pathLabel}[${i}]`, a[i], b[i], out);
      }
      return;
    }
    out.differences.push({ path: pathLabel, a, b });
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      compareDiffValue(pathLabel ? `${pathLabel}.${key}` : key, a[key], b[key], out);
    }
    return;
  }
  if (valueIsEqual(a, b)) {
    out.shared.push(pathLabel);
    return;
  }
  out.differences.push({ path: pathLabel, a, b });
}

function bucketDiffPath(path) {
  if (path.startsWith("params.")) return "params";
  if (path.startsWith("metrics.")) return "metrics";
  if (path.startsWith("env.")) return "env";
  return "meta";
}

const RUN_DIFF_FIELDS = [
  "status",
  "command",
  "agent",
  "parent_id",
  "replay_of",
  "retry_of",
  "wall_seconds",
  "est_cost_usd",
  "started_at",
  "ended_at",
  "exit_code",
  "kill_reason",
  "data_fingerprint",
  "params",
  "metrics",
  "env",
];

export function buildRunDiff(rowA, rowB, fields = RUN_DIFF_FIELDS) {
  const out = {
    id_a: rowA?.id ?? null,
    id_b: rowB?.id ?? null,
    identical: true,
    shared: [],
    only_in_a: [],
    only_in_b: [],
    differences: [],
    sections: {
      params: [],
      metrics: [],
      env: [],
      meta: [],
    },
  };

  for (const field of fields) {
    compareDiffValue(field, rowA?.[field], rowB?.[field], out);
  }

  for (const diff of out.differences) {
    const bucket = bucketDiffPath(diff.path);
    out.sections[bucket].push(diff);
  }

  out.identical = out.differences.length === 0 && out.only_in_a.length === 0 && out.only_in_b.length === 0;
  out.shared = { paths: out.shared, count: out.shared.length };
  out.only_in_a = { paths: out.only_in_a, count: out.only_in_a.length };
  out.only_in_b = { paths: out.only_in_b, count: out.only_in_b.length };
  return out;
}
