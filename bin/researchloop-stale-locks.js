// `autoresearch stale-locks` — find and optionally clean zombie lock files.
//
// The sweep runner (G08 / G18) uses filesystem-mutex locks at
// `.researchloop/<scope>.lock/<row-id>` to prevent double-claiming queue rows.
// When a worker dies (SIGKILL, machine reboot, OOM), its lock files survive
// and block the next sweep from picking up those rows.
//
// This command walks the lock directories, identifies which locks are
// orphaned (process pid no longer exists, or older than `--max-age`), and
// either reports them (default) or removes them (`--clean`).

import fs from "node:fs";
import path from "node:path";

function findLockRoots(cwd) {
  const base = path.join(cwd, ".researchloop");
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const entry of fs.readdirSync(base)) {
    if (entry.endsWith(".lock") || entry.endsWith(".lock.d")) {
      const full = path.join(base, entry);
      if (fs.statSync(full).isDirectory()) out.push(full);
    }
  }
  // Also check the standard tasks-mutex location.
  const tasksLockDir = path.join(base, "tasks.lock");
  if (fs.existsSync(tasksLockDir) && !out.includes(tasksLockDir)) out.push(tasksLockDir);
  return out;
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    // signal 0 == existence check, no-op on the target
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "EPERM") return true; // exists but we can't signal it
    return false;
  }
}

function readLockMeta(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    // Try JSON first, then assume one-line PID, else null.
    try { return JSON.parse(text); } catch {}
    const n = parseInt(text.trim(), 10);
    if (Number.isFinite(n)) return { pid: n };
    return { raw: text.trim() };
  } catch {
    return null;
  }
}

export async function cmdStaleLocks(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const clean = hasFlag("--clean");
  const maxAgeMin = parseInt(String(option("--max-age", "60")), 10) || 60;
  const cutoffMs = Date.now() - maxAgeMin * 60 * 1000;

  const roots = findLockRoots(cwd);
  if (roots.length === 0) {
    if (formatJson) console.log(JSON.stringify({ n_locks: 0, stale: [] }, null, 2));
    else console.log(`No lock directories under .researchloop/. Nothing to inspect.`);
    return;
  }

  const findings = [];
  for (const root of roots) {
    for (const entry of fs.readdirSync(root)) {
      const full = path.join(root, entry);
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      const meta = readLockMeta(full);
      const pid = meta && Number.isFinite(meta.pid) ? meta.pid : null;
      const alive = pid !== null ? pidAlive(pid) : null;
      const ageMs = Date.now() - st.mtime.getTime();
      const ageStale = st.mtime.getTime() < cutoffMs;
      // Stale if: pid present and dead, OR no pid + older than cutoff.
      let isStale = false;
      let reason = "";
      if (alive === false) { isStale = true; reason = `pid ${pid} not running`; }
      else if (pid === null && ageStale) { isStale = true; reason = `no pid + age > ${maxAgeMin} min`; }
      findings.push({
        path: full,
        pid,
        pid_alive: alive,
        mtime: st.mtime.toISOString(),
        age_minutes: ageMs / 60000,
        stale: isStale,
        reason,
      });
    }
  }

  const stale = findings.filter((f) => f.stale);

  if (clean) {
    for (const f of stale) {
      try { fs.unlinkSync(f.path); } catch (err) { console.error(`failed to remove ${f.path}: ${err.message}`); }
    }
  }

  if (formatJson) {
    console.log(JSON.stringify({
      lock_roots: roots,
      n_locks_total: findings.length,
      n_stale: stale.length,
      cleaned: clean ? stale.length : 0,
      stale,
      all: findings,
    }, null, 2));
    return;
  }

  console.log("autoresearch stale-locks");
  console.log(`lock_roots: ${roots.length}`);
  for (const r of roots) console.log(`  - ${path.relative(cwd, r)}`);
  console.log(`n_locks_total: ${findings.length}  n_stale: ${stale.length}`);
  console.log("---");
  if (stale.length === 0) {
    console.log("no stale locks found.");
  } else {
    console.log("stale locks:");
    for (const f of stale) {
      console.log(`  ${path.relative(cwd, f.path)}  age=${f.age_minutes.toFixed(1)}m  reason=${f.reason}`);
    }
    if (clean) console.log(`removed ${stale.length} stale lock(s).`);
    else console.log("---\npass --clean to delete them.");
  }
}
