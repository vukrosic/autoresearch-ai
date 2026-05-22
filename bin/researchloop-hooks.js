// `autoresearch hooks` — pre / post / on_promote shell hooks.
//
// Each hook is a shell script in `.researchloop/hooks/<event>.sh` (or .d/*.sh
// for multiple). Events:
//   - pre_run        : runs before `autoresearch run` spawns the child
//   - post_run       : runs after `run` completes (sees $RESEARCHLOOP_RUN_ID)
//   - on_promote     : runs after `promote` succeeds
//   - on_failure     : runs when `run` exits non-zero
//
// This command is the management surface — it lists configured hooks,
// installs a stub for a given event, removes one, and dry-tests by sourcing
// the script in a subshell with realistic env vars. We do NOT execute hooks
// here in production — that's the job of `run`/`promote` themselves (which
// can opt in later via a small wrapper around their existing exec path).

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir } from "./researchloop-core.js";

const EVENTS = ["pre_run", "post_run", "on_promote", "on_failure", "on_archive"];

function hooksDir(cwd) {
  return path.join(cwd, ".researchloop", "hooks");
}

function listHooksForEvent(cwd, event) {
  const dir = hooksDir(cwd);
  const flat = path.join(dir, `${event}.sh`);
  const subdir = path.join(dir, `${event}.d`);
  const out = [];
  if (fs.existsSync(flat)) out.push(flat);
  if (fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
    for (const f of fs.readdirSync(subdir).sort()) {
      if (f.endsWith(".sh")) out.push(path.join(subdir, f));
    }
  }
  return out;
}

function listAllHooks(cwd) {
  const out = {};
  for (const ev of EVENTS) out[ev] = listHooksForEvent(cwd, ev);
  return out;
}

function stubScript(event) {
  return [
    "#!/usr/bin/env bash",
    `# autoresearch hook: ${event}`,
    "# Available env vars (depending on event):",
    "#   RESEARCHLOOP_RUN_ID, RESEARCHLOOP_RUN_DIR, RESEARCHLOOP_COMMAND,",
    "#   RESEARCHLOOP_STATUS, RESEARCHLOOP_METRIC, RESEARCHLOOP_METRIC_VALUE,",
    "#   RESEARCHLOOP_EXIT_CODE",
    "#",
    "# Exit non-zero to abort `run` (pre_run only) — other events ignore exit code.",
    "",
    "set -euo pipefail",
    "",
    "# Your code here:",
    `echo "[${event}] run=${'${RESEARCHLOOP_RUN_ID:-?}'}"`,
    "",
  ].join("\n");
}

export async function cmdHooks(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Subcommands: list (default), install, remove, test, env-template
  const sub = args.find((a, i) => i > 0 && a !== "hooks" && !a.startsWith("-")) || "list";

  if (sub === "list") {
    const all = listAllHooks(cwd);
    if (formatJson) {
      console.log(JSON.stringify(all, null, 2));
      return;
    }
    console.log("autoresearch hooks");
    console.log(`dir: ${path.relative(cwd, hooksDir(cwd))}`);
    console.log("---");
    for (const ev of EVENTS) {
      const files = all[ev];
      if (files.length === 0) {
        console.log(`  ${ev}:  (none)`);
      } else {
        console.log(`  ${ev}:`);
        for (const f of files) console.log(`    - ${path.relative(cwd, f)}`);
      }
    }
    console.log("---");
    console.log("install one: autoresearch hooks install <event>");
    return;
  }

  if (sub === "install") {
    const event = args[args.indexOf("install") + 1];
    if (!event || !EVENTS.includes(event)) {
      console.error(`Usage: autoresearch hooks install <${EVENTS.join("|")}> [--into FILE]`);
      process.exitCode = 1;
      return;
    }
    const intoFlag = option("--into", null);
    const dest = intoFlag && typeof intoFlag === "string"
      ? path.resolve(cwd, intoFlag)
      : path.join(hooksDir(cwd), `${event}.sh`);
    if (fs.existsSync(dest)) {
      console.error(`refusing to overwrite ${dest}. Pass --into <other-path> or remove the existing file.`);
      process.exitCode = 1;
      return;
    }
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, stubScript(event));
    try { fs.chmodSync(dest, 0o755); } catch {}
    console.log(`installed ${event} hook -> ${path.relative(cwd, dest)}`);
    return;
  }

  if (sub === "remove") {
    const event = args[args.indexOf("remove") + 1];
    if (!event) { console.error("Usage: autoresearch hooks remove <event> [--file PATH]"); process.exitCode = 1; return; }
    const fileFlag = option("--file", null);
    if (fileFlag && typeof fileFlag === "string") {
      const p = path.resolve(cwd, fileFlag);
      if (!fs.existsSync(p)) { console.error(`Not found: ${p}`); process.exitCode = 1; return; }
      fs.unlinkSync(p);
      console.log(`removed ${p}`);
      return;
    }
    const candidate = path.join(hooksDir(cwd), `${event}.sh`);
    if (!fs.existsSync(candidate)) {
      console.error(`No flat hook for ${event}. Use --file PATH for hooks under ${event}.d/.`);
      process.exitCode = 1;
      return;
    }
    fs.unlinkSync(candidate);
    console.log(`removed ${candidate}`);
    return;
  }

  if (sub === "test") {
    const event = args[args.indexOf("test") + 1];
    if (!event || !EVENTS.includes(event)) {
      console.error(`Usage: autoresearch hooks test <${EVENTS.join("|")}>`);
      process.exitCode = 1;
      return;
    }
    const files = listHooksForEvent(cwd, event);
    if (files.length === 0) { console.log(`No ${event} hooks installed.`); return; }
    const env = {
      ...process.env,
      RESEARCHLOOP_RUN_ID: "test-run-id",
      RESEARCHLOOP_RUN_DIR: path.join(cwd, ".researchloop", "scratchpad", "runs", "test-run-id"),
      RESEARCHLOOP_COMMAND: "echo dry-run",
      RESEARCHLOOP_STATUS: "complete",
      RESEARCHLOOP_METRIC: "val_loss",
      RESEARCHLOOP_METRIC_VALUE: "0.42",
      RESEARCHLOOP_EXIT_CODE: "0",
    };
    let anyFail = false;
    for (const f of files) {
      console.log(`---  test: ${path.relative(cwd, f)}  ---`);
      const res = spawnSync("bash", [f], { env, cwd, stdio: "inherit" });
      console.log(`(exit=${res.status})`);
      if (res.status !== 0) anyFail = true;
    }
    if (anyFail) process.exitCode = 1;
    return;
  }

  if (sub === "env-template") {
    console.log("# These are the env vars autoresearch will pass to your hook scripts.");
    console.log("# Not every event sets every variable — check the hook stub comments.");
    console.log("");
    const vars = [
      ["RESEARCHLOOP_RUN_ID", "Run id (always)"],
      ["RESEARCHLOOP_RUN_DIR", "Absolute path to per-run dir"],
      ["RESEARCHLOOP_COMMAND", "Full command that was executed"],
      ["RESEARCHLOOP_STATUS", "Terminal status (post_run / on_failure / on_promote / on_archive)"],
      ["RESEARCHLOOP_METRIC", "Primary metric name"],
      ["RESEARCHLOOP_METRIC_VALUE", "Primary metric value (post_run if parsed)"],
      ["RESEARCHLOOP_EXIT_CODE", "Child exit code (post_run / on_failure)"],
      ["RESEARCHLOOP_WALL_SECONDS", "Wall time of the run"],
      ["RESEARCHLOOP_ARCHIVE_REASON", "Archive reason (on_archive)"],
    ];
    for (const [k, desc] of vars) console.log(`export ${k}=""   # ${desc}`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}. Use: list | install <event> | remove <event> | test <event> | env-template`);
  process.exitCode = 1;
}
