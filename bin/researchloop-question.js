// `autoresearch question` — open research questions parking lot.
//
// Mid-experiment ideas — "I wonder if X also matters", "what if the seed
// affects this differently at higher batch size", "is the eval set
// contaminated?" — usually get lost to the day's tactical work and never
// resurface. This command is a one-line capture surface for those questions,
// with a small amount of structure to keep them useful weeks later.
//
// Storage is `.researchloop/questions.jsonl`. Each row carries:
//   {id, text, created_at, status, related_run_ids, answered_at?, answer?}
//
// Modes:
//   question add "TEXT" [--run RUN_ID ...]   adds a new question
//   question list [--open | --answered]      list / filter
//   question answer <id> "ANSWER"            mark answered with a one-line answer
//   question close <id>                      mark closed without an answer

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ensureDir } from "./researchloop-core.js";

function questionsFile(cwd) {
  return path.join(cwd, ".researchloop", "questions.jsonl");
}

function readQuestions(cwd) {
  const p = questionsFile(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function writeQuestions(cwd, rows) {
  const p = questionsFile(cwd);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function makeId(text) {
  return "q-" + createHash("sha256").update(text + new Date().toISOString()).digest("hex").slice(0, 8);
}

export async function cmdQuestion(ctx) {
  const { option, hasFlag, targetDir, args, optionsAll } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const sub = args.find((a, i) => i > 0 && a !== "question" && !a.startsWith("-")) || "list";

  if (sub === "add") {
    const subIdx = args.indexOf("add");
    // Question text is the next positional after "add".
    let text = "";
    for (let i = subIdx + 1; i < args.length; i += 1) {
      if (args[i].startsWith("-")) break;
      text += (text ? " " : "") + args[i];
    }
    if (!text) {
      console.error("Usage: autoresearch question add \"YOUR QUESTION\" [--run RUN_ID ...]");
      process.exitCode = 1;
      return;
    }
    const runIds = optionsAll ? optionsAll("--run") : (option("--run", null) ? [option("--run", null)] : []);
    const id = makeId(text);
    const row = {
      id,
      text,
      created_at: new Date().toISOString(),
      status: "open",
      related_run_ids: (Array.isArray(runIds) ? runIds : [runIds]).filter(Boolean),
    };
    const rows = readQuestions(cwd);
    rows.push(row);
    writeQuestions(cwd, rows);
    console.log(`added: ${id}`);
    console.log(`text: ${text}`);
    return;
  }

  if (sub === "answer") {
    const subIdx = args.indexOf("answer");
    const id = args[subIdx + 1];
    let answer = "";
    for (let i = subIdx + 2; i < args.length; i += 1) {
      if (args[i].startsWith("-")) break;
      answer += (answer ? " " : "") + args[i];
    }
    if (!id || !answer) {
      console.error("Usage: autoresearch question answer <id> \"ANSWER TEXT\"");
      process.exitCode = 1;
      return;
    }
    const rows = readQuestions(cwd);
    const target = rows.find((r) => r.id === id);
    if (!target) { console.error(`Not found: ${id}`); process.exitCode = 1; return; }
    target.status = "answered";
    target.answered_at = new Date().toISOString();
    target.answer = answer;
    writeQuestions(cwd, rows);
    console.log(`answered: ${id}`);
    return;
  }

  if (sub === "close") {
    const subIdx = args.indexOf("close");
    const id = args[subIdx + 1];
    if (!id) { console.error("Usage: autoresearch question close <id>"); process.exitCode = 1; return; }
    const rows = readQuestions(cwd);
    const target = rows.find((r) => r.id === id);
    if (!target) { console.error(`Not found: ${id}`); process.exitCode = 1; return; }
    target.status = "closed";
    target.closed_at = new Date().toISOString();
    writeQuestions(cwd, rows);
    console.log(`closed: ${id}`);
    return;
  }

  if (sub === "list" || sub === undefined) {
    const rows = readQuestions(cwd);
    const showOpen = hasFlag("--open");
    const showAnswered = hasFlag("--answered");
    const showClosed = hasFlag("--closed");
    const wantAll = !(showOpen || showAnswered || showClosed);
    const filtered = rows.filter((r) => {
      if (wantAll) return true;
      if (showOpen && r.status === "open") return true;
      if (showAnswered && r.status === "answered") return true;
      if (showClosed && r.status === "closed") return true;
      return false;
    });

    if (formatJson) {
      console.log(JSON.stringify({ n: filtered.length, questions: filtered }, null, 2));
      return;
    }

    console.log(`autoresearch question (${filtered.length}${wantAll ? "" : " filtered"} of ${rows.length})`);
    console.log("---");
    if (filtered.length === 0) {
      console.log("(empty)  add one: autoresearch question add \"...\"");
      return;
    }
    for (const r of filtered) {
      const tag = r.status === "open" ? "?" : (r.status === "answered" ? "✓" : "·");
      console.log(`[${tag}] ${r.id}  ${r.created_at.slice(0, 10)}`);
      console.log(`     Q: ${r.text}`);
      if (r.related_run_ids && r.related_run_ids.length > 0) {
        console.log(`     related: ${r.related_run_ids.join(", ")}`);
      }
      if (r.answer) console.log(`     A: ${r.answer}`);
    }
    return;
  }

  console.error(`Unknown subcommand: ${sub}. Use: add | list | answer <id> | close <id>`);
  process.exitCode = 1;
}
