// `autoresearch fork <run-id>` — emit a ready-to-modify launch command from
// a known-good run.
//
// The natural follow-up to a winning run is "try one more thing on top of it."
// Today the researcher has to copy/paste the command, find the params, change
// one of them, and re-issue. This command does the boring half: it prints
// (or writes) a shell-ready `autoresearch run --command "..."` snippet using
// the parent run's exact command, with optional `--bump key=value`
// transformations applied inline, and a new id derived from the parent.
//
// The output is text — we don't execute it. The researcher reviews and runs.

import fs from "node:fs";
import { readLedgerRows, findRowById, numericParams } from "./researchloop-core.js";

function applyBumps(cmdText, bumps) {
  let out = cmdText;
  const applied = [];
  for (const { key, op, value } of bumps) {
    const flag = key.length === 1 ? `-${key}` : `--${key}`;
    // Match: --key VAL  OR  --key=VAL
    const reSpace = new RegExp(`(\\s|^)(${flag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})(\\s+)([^\\s]+)`, "g");
    const reEq = new RegExp(`(\\s|^)(${flag.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")})=([^\\s]+)`, "g");

    function transform(old) {
      const oldNum = Number(old);
      switch (op) {
        case "=": return String(value);
        case "*": return Number.isFinite(oldNum) ? String(oldNum * Number(value)) : old;
        case "/": return Number.isFinite(oldNum) && Number(value) !== 0 ? String(oldNum / Number(value)) : old;
        case "+": return Number.isFinite(oldNum) ? String(oldNum + Number(value)) : old;
        case "-": return Number.isFinite(oldNum) ? String(oldNum - Number(value)) : old;
        default: return String(value);
      }
    }

    let didReplace = false;
    out = out.replace(reSpace, (_m, lead, _flag, sp, old) => {
      didReplace = true;
      applied.push({ key, op, value, old, new: transform(old) });
      return `${lead}${flag}${sp}${transform(old)}`;
    });
    out = out.replace(reEq, (_m, lead, _flag, old) => {
      didReplace = true;
      applied.push({ key, op, value, old, new: transform(old) });
      return `${lead}${flag}=${transform(old)}`;
    });
    if (!didReplace) {
      // Append as a new --key value flag.
      out = `${out} ${flag} ${value}`;
      applied.push({ key, op, value, old: null, new: String(value) });
    }
  }
  return { command: out, applied };
}

function parseBumpFlag(raw) {
  // Accept --bump lr=*2, --bump batch_size=64, --bump warmup=+100
  // Format: KEY OP VALUE  where OP ∈ {=, *, /, +, -}
  // If no OP, default to "=".
  if (!raw || typeof raw !== "string") return null;
  const m = raw.match(/^([A-Za-z0-9_-]+)\s*([=*+/-])\s*(.+)$/);
  if (!m) return null;
  return { key: m[1], op: m[2], value: m[3].trim() };
}

export async function cmdFork(ctx) {
  const { option, hasFlag, targetDir, args, optionsAll } = ctx;
  const cwd = targetDir();

  const idx = args.findIndex((a) => a === "fork");
  let runId = String(option("--id", "")).trim();
  if (!runId && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    runId = String(args[idx + 1]).trim();
  }
  if (!runId) {
    console.error("Usage: autoresearch fork <run-id> [--bump key=value ...] [--new-id ID] [--out FILE.sh] [--seeds N] [--dry-run] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const rows = readLedgerRows(cwd);
  const source = findRowById(rows, runId);
  if (!source) { console.error(`Run not found: ${runId}`); process.exitCode = 1; return; }
  if (!source.command) { console.error(`Run ${runId} has no recorded command — cannot fork.`); process.exitCode = 1; return; }

  // Collect bump flags. `option` returns last; we need all.
  const bumpsRaw = (optionsAll ? optionsAll("--bump") : (option("--bump", null) ? [option("--bump", null)] : []));
  const bumps = (Array.isArray(bumpsRaw) ? bumpsRaw : [bumpsRaw])
    .map(parseBumpFlag)
    .filter(Boolean);

  const transform = applyBumps(source.command, bumps);
  const newId = String(option("--new-id", `fork-${runId}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const seedsRaw = option("--seeds", null);
  const seeds = seedsRaw && typeof seedsRaw === "string" ? parseInt(seedsRaw, 10) : null;

  const metricKeys = source.metrics ? Object.keys(source.metrics).filter((k) => !k.endsWith("_std")) : [];
  const metric = metricKeys[0] || null;

  const cmdLine = [
    `autoresearch run`,
    `  --id ${newId}`,
    metric ? `  --metric ${metric}` : null,
    seeds && seeds > 1 ? `  --seeds ${seeds}` : null,
    `  --command ${JSON.stringify(transform.command)}`,
  ].filter(Boolean).join(" \\\n");

  const header = [
    `# autoresearch fork`,
    `# parent: ${runId}`,
    `# parent_command: ${source.command}`,
    `# new_id: ${newId}`,
    transform.applied.length > 0 ? `# applied:` : `# applied: (no transforms)`,
    ...transform.applied.map((a) => `#   ${a.key}: ${a.old ?? "(new)"} -> ${a.new}  (op=${a.op})`),
    "",
  ].join("\n");

  const body = `${header}${cmdLine}\n`;

  const outRaw = option("--out", null);
  if (outRaw && typeof outRaw === "string") {
    fs.writeFileSync(outRaw, "#!/usr/bin/env bash\nset -euo pipefail\n\n" + body);
    try { fs.chmodSync(outRaw, 0o755); } catch {}
    console.log(`wrote ${outRaw}`);
  } else {
    process.stdout.write(body);
  }
  if (hasFlag("--dry-run")) {
    console.error("(dry-run: not executed — paste the command above to run it.)");
  }
}
