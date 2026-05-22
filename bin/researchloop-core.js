// Shared helpers for the researchloop-* feature modules.
//
// Kept minimal on purpose — only put something here when a second module needs
// it. Resist the temptation to centralize anything from the legacy monolith
// `researchloop.js`; that file owns its own copies for now and will get pulled
// across deliberately as new features need the same primitives.

import fs from "node:fs";
import path from "node:path";

export function ledgerPath(cwd) {
  return path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
}

export function readLedgerRows(cwd) {
  const p = ledgerPath(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
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

export function findRowById(rows, id) {
  return rows.find((r) => String(r.id) === String(id)) || null;
}

export function rewriteLedger(cwd, rows) {
  const p = ledgerPath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : ""));
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function arrMean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function arrStd(arr) {
  if (arr.length <= 1) return 0;
  const m = arrMean(arr);
  const ss = arr.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (arr.length - 1));
}

export function arrMedian(arr) {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

export function percentile(arr, p) {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function fmt(n, digits = 6) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "null";
  return Number(n).toFixed(digits);
}

export function metricNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "string" && value.trim() === "") return Number.NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function rowMetricValue(row, key) {
  if (!row || !row.metrics || !(key in row.metrics)) return Number.NaN;
  return metricNumber(row.metrics[key]);
}

// Extracts numeric params from a row's `params` object. Falls back to the
// nested `config.params` if `params` isn't directly populated. Non-numeric
// values are ignored.
export function numericParams(row) {
  const src = (row && row.params) || (row && row.config && row.config.params) || {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

export function loadCostYaml(cwd) {
  const p = path.join(cwd, ".researchloop", "cost.yaml");
  if (!fs.existsSync(p)) return null;
  const text = fs.readFileSync(p, "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([a-zA-Z_][\w]*):\s*([^#]+?)\s*(?:#.*)?$/);
    if (!m) continue;
    const key = m[1];
    const raw = m[2].trim().replace(/^['"]|['"]$/g, "");
    const num = Number(raw);
    out[key] = Number.isFinite(num) ? num : raw;
  }
  return out;
}
