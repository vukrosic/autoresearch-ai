// `autoresearch disk-check` — free-space guard before launching big runs.
//
// Standalone command and pre-flight gate. Designed to be cheap to call from
// hooks, sweeps, and CI: walks one or more paths, calls `df -k` for the
// containing filesystem, and reports free bytes + a verdict against
// `--min-free-gb`. Exits non-zero when any path is below the threshold.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

function bytesToGb(b) {
  return b / (1024 * 1024 * 1024);
}

function dfFreeBytes(p) {
  try {
    const out = execSync(`df -k ${JSON.stringify(p)}`, { encoding: "utf8" });
    const lines = out.trim().split("\n");
    if (lines.length < 2) return null;
    // Last line is the filesystem row (handles cases where df wraps long device names).
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    // Standard df -k output: Filesystem 1K-blocks Used Available Capacity Mounted
    // Available is typically index 3 from the end (Mounted, Capacity, Available, Used, 1K-blocks).
    let available = null;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const n = Number(parts[i]);
      if (Number.isFinite(n)) { available = n; break; }
    }
    // We want the *third* numeric from the right (Available column on macOS/Linux df).
    let count = 0;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const n = Number(parts[i]);
      if (Number.isFinite(n)) {
        count += 1;
        if (count === 2) { available = n; break; } // Available is the 2nd numeric from the right after the trailing Capacity %
      }
    }
    return available !== null ? available * 1024 : null;
  } catch {
    return null;
  }
}

function statvfsFallback(p) {
  // Node has no statvfs binding. Best effort: report null and let the caller decide.
  return null;
}

function checkPath(p, minFreeGb) {
  const resolved = path.resolve(p);
  let usable = path.dirname(resolved);
  // Walk up if the path doesn't exist yet (so we still report the parent FS).
  while (!fs.existsSync(usable) && usable !== "/") usable = path.dirname(usable);
  const free = dfFreeBytes(usable) ?? statvfsFallback(usable);
  if (free === null) {
    return { path: resolved, fs_path: usable, free_bytes: null, free_gb: null, ok: null, reason: "unable to read free space" };
  }
  const freeGb = bytesToGb(free);
  return {
    path: resolved,
    fs_path: usable,
    free_bytes: free,
    free_gb: freeGb,
    ok: freeGb >= minFreeGb,
    threshold_gb: minFreeGb,
  };
}

export async function cmdDiskCheck(ctx) {
  const { option, targetDir, optionsAll } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const minFreeGb = parseFloat(String(option("--min-free-gb", "10")));

  // Default targets: cwd + .researchloop run dir + system tmp.
  const pathArgs = optionsAll ? optionsAll("--path") : [];
  let targets = (Array.isArray(pathArgs) && pathArgs.length > 0)
    ? pathArgs
    : [cwd, path.join(cwd, ".researchloop"), os.tmpdir()];
  targets = Array.from(new Set(targets));

  const results = targets.map((p) => checkPath(p, minFreeGb));
  const anyFail = results.some((r) => r.ok === false);
  const anyUnknown = results.some((r) => r.ok === null);

  if (formatJson) {
    console.log(JSON.stringify({
      min_free_gb: minFreeGb,
      results,
      all_ok: !anyFail && !anyUnknown,
      any_fail: anyFail,
      any_unknown: anyUnknown,
    }, null, 2));
  } else {
    console.log("autoresearch disk-check");
    console.log(`min_free_gb: ${minFreeGb}`);
    console.log("---");
    console.log("| path | fs | free_gb | ok |");
    console.log("| --- | --- | --- | --- |");
    for (const r of results) {
      const free = r.free_gb === null ? "?" : r.free_gb.toFixed(2);
      const ok = r.ok === null ? "?" : (r.ok ? "yes" : "NO");
      console.log(`| ${r.path} | ${r.fs_path} | ${free} | ${ok} |`);
    }
    console.log("---");
    if (anyFail) console.log("verdict: FAIL — at least one path is below the threshold");
    else if (anyUnknown) console.log("verdict: unknown — could not read free space on at least one path");
    else console.log("verdict: ok — all paths have headroom");
  }

  if (anyFail) process.exitCode = 1;
}
