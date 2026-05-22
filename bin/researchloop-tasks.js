import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir } from "./researchloop-core.js";

const LANES = ["orchestrator", "reviewer", "worker"];

function tasksLedgerPath(cwd) {
  return path.join(cwd, ".researchloop", "tasks.jsonl");
}

function tasksLockRoot(cwd) {
  return path.join(cwd, ".researchloop", "tasks.lock");
}

function claimLockPath(cwd) {
  return path.join(tasksLockRoot(cwd), "claim.lock");
}

function taskLockPath(cwd, taskId) {
  return path.join(tasksLockRoot(cwd), `${taskId}.json`);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
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

function writeJsonl(file, rows) {
  ensureDir(path.dirname(file));
  const text = rows.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(file, `${text}${rows.length ? "\n" : ""}`);
}

function readTasks(cwd) {
  return readJsonl(tasksLedgerPath(cwd));
}

function writeTasks(cwd, rows) {
  writeJsonl(tasksLedgerPath(cwd), rows);
}

function normalizeLane(lane, fallback = "worker") {
  const value = String(lane || fallback).toLowerCase();
  return LANES.includes(value) ? value : null;
}

function makeTaskId(text) {
  const stamp = new Date().toISOString();
  const hash = createHash("sha256").update(`${text}\n${stamp}`).digest("hex").slice(0, 8);
  return `task-${hash}`;
}

function pidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

function readLockMeta(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    try {
      return JSON.parse(text);
    } catch {
      const pid = parseInt(text.trim(), 10);
      if (Number.isFinite(pid)) return { pid };
      return { raw: text.trim() };
    }
  } catch {
    return null;
  }
}

function recoverStaleLock(file, maxAgeMinutes = 120) {
  if (!fs.existsSync(file)) return false;
  const st = fs.statSync(file);
  const meta = readLockMeta(file);
  const pid = meta && Number.isFinite(meta.pid) ? meta.pid : null;
  const alive = pid !== null ? pidAlive(pid) : null;
  const ageMinutes = (Date.now() - st.mtimeMs) / 60000;
  const stale = alive === false || (pid === null && ageMinutes > maxAgeMinutes);
  if (!stale) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function acquireExclusiveFile(file, payload) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
}

function releaseExclusiveFile(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function dependencyIds(row) {
  const raw = Array.isArray(row?.depends)
    ? row.depends
    : row?.depends
      ? [row.depends]
      : [];
  return raw.map((value) => String(value).trim()).filter(Boolean);
}

function dependenciesSatisfied(row, rows) {
  const deps = dependencyIds(row);
  if (!deps.length) return true;
  for (const depId of deps) {
    const dep = rows.find((item) => String(item.id) === depId);
    if (!dep || String(dep.status) !== "done") {
      return false;
    }
  }
  return true;
}

function taskState(row, rows, cwd) {
  if (String(row?.status) === "done") return "done";
  if (fs.existsSync(taskLockPath(cwd, row.id))) return "claimed";
  if (!dependenciesSatisfied(row, rows)) return "blocked";
  return "open";
}

function sortTasks(rows) {
  return [...rows].sort((a, b) => {
    const aTime = String(a.created_at || a.added_at || "");
    const bTime = String(b.created_at || b.added_at || "");
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function taskBoard(cwd, rows) {
  const board = [];
  for (const lane of LANES) {
    const laneRows = sortTasks(rows.filter((row) => normalizeLane(row.lane) === lane));
    const tasks = laneRows.map((row) => {
      const state = taskState(row, rows, cwd);
      return {
        id: row.id,
        description: row.description || "",
        lane,
        depends: dependencyIds(row),
        status: state,
        created_at: row.created_at || null,
        claimed_at: row.claimed_at || null,
        claimed_by: row.claimed_by || null,
        done_at: row.done_at || null,
        note: row.note || row.done_note || null,
      };
    });
    const counts = tasks.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, { open: 0, claimed: 0, blocked: 0, done: 0 });
    board.push({ lane, counts, tasks });
  }
  return board;
}

function taskSummaryLine(task) {
  const pieces = [`[${task.status}]`, task.id];
  if (task.description) pieces.push(`- ${task.description}`);
  if (task.depends.length) pieces.push(`(depends: ${task.depends.join(", ")})`);
  if (task.status === "claimed" && task.claimed_by) {
    pieces.push(`(claimed by ${task.claimed_by})`);
  }
  if (task.status === "done" && task.done_at) {
    pieces.push(`(done ${task.done_at.slice(0, 10)})`);
  }
  return pieces.join(" ");
}

function formatTaskBoard(board) {
  const lines = ["autoresearch tasks", "---"];
  for (const lane of board) {
    lines.push(`Lane ${lane.lane}: open=${lane.counts.open} claimed=${lane.counts.claimed} blocked=${lane.counts.blocked} done=${lane.counts.done}`);
    if (!lane.tasks.length) {
      lines.push("  (empty)");
      continue;
    }
    for (const task of lane.tasks) {
      lines.push(`  - ${taskSummaryLine(task)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function laneMatchesTask(row, lane) {
  return normalizeLane(row.lane) === lane;
}

function claimNextTask(cwd, { agent, lane }) {
  const normalizedLane = normalizeLane(lane, null);
  if (!normalizedLane) {
    throw new Error(`invalid lane: ${lane}`);
  }

  const lockRoot = tasksLockRoot(cwd);
  ensureDir(lockRoot);

  const queueLock = claimLockPath(cwd);
  recoverStaleLock(queueLock);
  try {
    acquireExclusiveFile(queueLock, {
      scope: "tasks",
      kind: "queue-claim",
      pid: process.pid,
      agent,
      lane: normalizedLane,
      acquired_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err && err.code === "EEXIST") {
      return { state: "no-task", task: null };
    }
    throw err;
  }

  try {
    let rows = readTasks(cwd);
    const candidates = sortTasks(rows).filter((row) => {
      if (!laneMatchesTask(row, normalizedLane)) return false;
      if (String(row.status) === "done") return false;
      if (!dependenciesSatisfied(row, rows)) return false;
      return !fs.existsSync(taskLockPath(cwd, row.id));
    });

    for (const candidate of candidates) {
      const now = new Date().toISOString();
      const lockPath = taskLockPath(cwd, candidate.id);
      try {
        acquireExclusiveFile(lockPath, {
          scope: "tasks",
          kind: "task-claim",
          agent,
          lane: normalizedLane,
          task_id: candidate.id,
          claimed_at: now,
          description: candidate.description || "",
        });
      } catch (err) {
        if (err && err.code === "EEXIST") {
          continue;
        }
        throw err;
      }

      const updated = rows.map((row) => {
        if (String(row.id) !== String(candidate.id)) return row;
        return {
          ...row,
          status: "claimed",
          claimed_at: now,
          claimed_by: agent,
          claimed_lane: normalizedLane,
          lock_path: path.relative(cwd, lockPath),
        };
      });

      try {
        writeTasks(cwd, updated);
      } catch (err) {
        releaseExclusiveFile(lockPath);
        throw err;
      }

      return {
        state: "claimed",
        lock_path: lockPath,
        task: updated.find((row) => String(row.id) === String(candidate.id)) || candidate,
      };
    }

    return { state: "no-task", task: null };
  } finally {
    releaseExclusiveFile(queueLock);
  }
}

function addTask(cwd, { id, description, lane, depends }) {
  const rows = readTasks(cwd);
  if (rows.some((row) => String(row.id) === String(id))) {
    throw new Error(`task id already exists: ${id}`);
  }
  const now = new Date().toISOString();
  const task = {
    id,
    description,
    lane,
    depends,
    status: "open",
    created_at: now,
    claimed_at: null,
    claimed_by: null,
    claimed_lane: null,
    done_at: null,
    note: null,
  };
  rows.push(task);
  writeTasks(cwd, rows);
  return task;
}

function markTaskDone(cwd, taskId, note = "") {
  const rows = readTasks(cwd);
  const index = rows.findIndex((row) => String(row.id) === String(taskId));
  if (index === -1) {
    throw new Error(`task not found: ${taskId}`);
  }
  const now = new Date().toISOString();
  rows[index] = {
    ...rows[index],
    status: "done",
    done_at: now,
    note: note || rows[index].note || null,
  };
  writeTasks(cwd, rows);
  releaseExclusiveFile(taskLockPath(cwd, taskId));
  return rows[index];
}

function formatTaskJsonBoard(board) {
  return `${JSON.stringify({ lanes: board, generated_at: new Date().toISOString() }, null, 2)}\n`;
}

export function readTaskRows(cwd) {
  return readTasks(cwd);
}

export function taskQueuePath(cwd) {
  return tasksLedgerPath(cwd);
}

export function taskQueueLockDir(cwd) {
  return tasksLockRoot(cwd);
}

export function taskClaimLockPath(cwd) {
  return claimLockPath(cwd);
}

export function taskItemLockPath(cwd, taskId) {
  return taskLockPath(cwd, taskId);
}

export function claimTask(cwd, lane, agent) {
  return claimNextTask(cwd, { lane, agent });
}

export async function cmdTasks(ctx) {
  const { option, optionsAll, targetDir, args } = ctx;
  const cwd = targetDir();
  const subcommands = new Set(["add", "claim", "done", "status", "list"]);
  const sub = args.find((arg, index) => index > 0 && !arg.startsWith("-") && subcommands.has(arg)) || "status";
  const format = String(option("--format", sub === "claim" ? "json" : "text")).toLowerCase();

  if (sub === "add") {
    const addIndex = args.indexOf("add");
    let description = "";
    for (let i = addIndex + 1; i < args.length; i += 1) {
      const token = args[i];
      if (token.startsWith("-")) break;
      description += (description ? " " : "") + token;
    }
    if (!description) {
      console.error("Usage: autoresearch tasks add \"TEXT\" [--lane worker|reviewer|orchestrator] [--depends TASK_ID] [--id ID]");
      process.exitCode = 1;
      return;
    }

    const laneRaw = option("--lane", "worker");
    const lane = normalizeLane(laneRaw, "worker");
    if (!lane) {
      console.error(`tasks add: invalid lane: ${laneRaw}`);
      process.exitCode = 1;
      return;
    }

    const dependsValues = typeof optionsAll === "function"
      ? optionsAll("--depends")
      : (option("--depends", null) ? [option("--depends", null)] : []);
    const depends = dependsValues
      .map((value) => String(value || "").trim())
      .filter((value) => value && value !== "true");
    const id = String(option("--id", "") || "").trim() || makeTaskId(description);

    try {
      const task = addTask(cwd, { id, description, lane, depends });
      if (format === "json") {
        console.log(JSON.stringify(task, null, 2));
      } else {
        console.log(`added: ${task.id}`);
        console.log(`lane: ${task.lane}`);
        console.log(`description: ${task.description}`);
        if (task.depends.length) {
          console.log(`depends: ${task.depends.join(", ")}`);
        }
      }
    } catch (err) {
      console.error(`tasks add: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "claim") {
    const laneRaw = option("--lane", null);
    const lane = laneRaw && typeof laneRaw === "string" ? normalizeLane(laneRaw, null) : null;
    const agent = String(option("--agent", "") || "").trim();
    if (!agent) {
      console.error("tasks claim: missing --agent <name>");
      process.exitCode = 1;
      return;
    }
    if (!lane) {
      console.error("tasks claim: missing --lane <worker|reviewer|orchestrator>");
      process.exitCode = 1;
      return;
    }

    try {
      const result = claimNextTask(cwd, { agent, lane });
      if (!result.task) {
        console.log("no-task");
        return;
      }
      if (format === "json") {
        console.log(JSON.stringify(result.task));
      } else {
        console.log(`claimed: ${result.task.id}`);
        console.log(`agent: ${agent}`);
        console.log(`lane: ${lane}`);
        console.log(`description: ${result.task.description || ""}`);
      }
    } catch (err) {
      console.error(`tasks claim: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "done") {
    const doneIndex = args.indexOf("done");
    const taskId = String(args[doneIndex + 1] || "").trim();
    if (!taskId || taskId.startsWith("-")) {
      console.error("Usage: autoresearch tasks done <task-id> [--note TEXT]");
      process.exitCode = 1;
      return;
    }
    const note = String(option("--note", "") || "").trim();
    try {
      const task = markTaskDone(cwd, taskId, note);
      if (format === "json") {
        console.log(JSON.stringify(task, null, 2));
      } else {
        console.log(`done: ${task.id}`);
        if (task.note) {
          console.log(`note: ${task.note}`);
        }
      }
    } catch (err) {
      console.error(`tasks done: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (sub === "status" || sub === "list") {
    const rows = readTasks(cwd);
    const board = taskBoard(cwd, rows);
    if (format === "json") {
      process.stdout.write(formatTaskJsonBoard(board));
    } else {
      process.stdout.write(formatTaskBoard(board));
    }
    return;
  }

  console.error("Usage: autoresearch tasks add|claim|done|status");
  process.exitCode = 1;
}
