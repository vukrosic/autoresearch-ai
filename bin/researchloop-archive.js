// `autoresearch archive` — formalize "this didn't work" as durable evidence.
//
// The negative-results archive is the cheapest way to stop the agent from
// re-trying the same mechanism. Discarded runs sit in `.researchloop/scratchpad/runs/`
// with no semantic distinction from successful ones; archiving moves them to a
// dedicated `dead-ends/` directory with a structured WHY file, and tags the
// ledger row so `propose --novel` / `similar` queries can de-prioritize the
// underlying mechanism.
//
// Archive operations are reversible — restore moves the run dir back and clears
// the archive markers. The ledger row stays in `runs.jsonl` either way; only
// its `status` and `archive` fields change.

import fs from "node:fs";
import path from "node:path";
import { readLedgerRows, findRowById, rewriteLedger, ensureDir } from "./researchloop-core.js";

function deadEndsDir(cwd) {
  return path.join(cwd, ".researchloop", "dead-ends");
}

function runDir(cwd, runId) {
  return path.join(cwd, ".researchloop", "scratchpad", "runs", runId);
}

function archivedRunDir(cwd, runId) {
  return path.join(deadEndsDir(cwd), runId);
}

function listArchives(cwd) {
  const dir = deadEndsDir(cwd);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => fs.statSync(path.join(dir, d)).isDirectory())
    .map((id) => {
      const archiveFile = path.join(dir, id, "ARCHIVE.md");
      let reason = "";
      let archivedAt = "";
      if (fs.existsSync(archiveFile)) {
        const text = fs.readFileSync(archiveFile, "utf8");
        const reasonMatch = text.match(/^Reason:\s*(.+)$/m);
        const dateMatch = text.match(/^Archived:\s*(.+)$/m);
        reason = reasonMatch ? reasonMatch[1].trim() : "";
        archivedAt = dateMatch ? dateMatch[1].trim() : "";
      }
      return { id, reason, archived_at: archivedAt, path: path.join(dir, id) };
    })
    .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
}

export async function cmdArchive(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (hasFlag("--list")) {
    const items = listArchives(cwd);
    if (formatJson) {
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    if (items.length === 0) {
      console.log("No archived runs yet. Use: autoresearch archive --id <run-id> --reason \"TEXT\"");
      return;
    }
    console.log(`archived (${items.length}):`);
    for (const it of items) {
      console.log(`- ${it.id}  ${it.archived_at}`);
      if (it.reason) console.log(`    ${it.reason}`);
    }
    return;
  }

  const runId = String(option("--id", "")).trim();
  if (!runId) {
    console.error("Usage: autoresearch archive --id <run-id> --reason \"TEXT\" [--mechanism TEXT] [--restore] [--list] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  // --- restore: move back ---
  if (hasFlag("--restore")) {
    const archivedDir = archivedRunDir(cwd, runId);
    const liveDir = runDir(cwd, runId);
    if (!fs.existsSync(archivedDir)) {
      console.error(`Not archived: ${runId} (no directory at ${archivedDir})`);
      process.exitCode = 1;
      return;
    }
    if (fs.existsSync(liveDir)) {
      console.error(`Cannot restore: ${liveDir} already exists. Remove it first.`);
      process.exitCode = 1;
      return;
    }
    ensureDir(path.dirname(liveDir));
    fs.renameSync(archivedDir, liveDir);
    // Strip the ARCHIVE.md marker from the restored dir if present.
    const archiveFile = path.join(liveDir, "ARCHIVE.md");
    if (fs.existsSync(archiveFile)) fs.unlinkSync(archiveFile);

    const rows = readLedgerRows(cwd);
    const newRows = rows.map((r) => {
      if (String(r.id) === String(runId) && r.archive) {
        const restored = { ...r };
        delete restored.archive;
        if (restored.status === "archived") restored.status = restored.archive_prior_status || "complete";
        delete restored.archive_prior_status;
        return restored;
      }
      return r;
    });
    rewriteLedger(cwd, newRows);
    console.log(`restored ${runId} -> ${path.relative(cwd, liveDir)}`);
    return;
  }

  // --- archive: move out ---
  const reason = option("--reason", null);
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    console.error("Missing --reason. Pass a short string explaining why this run is a dead end.");
    process.exitCode = 1;
    return;
  }
  const mechanism = option("--mechanism", null);

  const rows = readLedgerRows(cwd);
  const row = findRowById(rows, runId);
  if (!row) {
    console.error(`Run not found in ledger: ${runId}`);
    process.exitCode = 1;
    return;
  }
  if (row.archive) {
    console.error(`Already archived: ${runId}. Use --restore first if you want to re-archive.`);
    process.exitCode = 1;
    return;
  }

  ensureDir(deadEndsDir(cwd));
  const liveDir = runDir(cwd, runId);
  const archivedDir = archivedRunDir(cwd, runId);
  if (fs.existsSync(liveDir)) {
    fs.renameSync(liveDir, archivedDir);
  } else {
    // No live dir to move — still mark the row + create a marker directory.
    ensureDir(archivedDir);
  }

  const stamp = new Date().toISOString();
  const archiveText = [
    `# Archived run: ${runId}`,
    "",
    `Archived: ${stamp}`,
    `Reason: ${reason.trim()}`,
    mechanism && typeof mechanism === "string" ? `Mechanism: ${mechanism.trim()}` : "",
    "",
    `Status before archive: ${row.status || "unknown"}`,
    `Command: ${row.command || "(none recorded)"}`,
    "",
    "Move this back with: `autoresearch archive --id " + runId + " --restore`",
    "",
  ].filter(Boolean).join("\n");
  fs.writeFileSync(path.join(archivedDir, "ARCHIVE.md"), archiveText);

  const newRows = rows.map((r) => {
    if (String(r.id) !== String(runId)) return r;
    return {
      ...r,
      archive_prior_status: r.status,
      status: "archived",
      archive: {
        archived_at: stamp,
        reason: reason.trim(),
        mechanism: typeof mechanism === "string" ? mechanism.trim() : null,
        path: path.relative(cwd, archivedDir),
      },
    };
  });
  rewriteLedger(cwd, newRows);

  console.log(`archived: ${runId}`);
  console.log(`location: ${path.relative(cwd, archivedDir)}`);
  console.log(`reason: ${reason.trim()}`);
}
