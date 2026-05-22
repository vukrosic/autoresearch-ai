import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, findRowById, readLedgerRows, rewriteLedger } from "./researchloop-core.js";
import { evaluateCommandSafety, loadSafetyPolicy, parseSafetyScalar } from "./researchloop-safety.js";

function readTextIfExists(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function compressSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function parseInlineObject(text) {
  const inner = text.replace(/^\{|\}$/g, "").trim();
  if (!inner) return null;
  const parts = [];
  let depth = 0;
  let buf = "";
  let inStr = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (inStr) {
      buf += ch;
      if (ch === inStr && inner[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  const obj = {};
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    let value = part.slice(idx + 1).trim();
    value = parseSafetyScalar(value);
    obj[key] = value;
  }
  return obj;
}

function parseEvalListSection(text, sectionName) {
  const lines = String(text || "").split(/\r?\n/);
  const out = [];
  let inSection = false;
  const headRe = new RegExp(`^${sectionName}\\s*:`);
  const flowEmptyRe = new RegExp(`^${sectionName}\\s*:\\s*\\[\\s*\\]\\s*$`);
  for (const line of lines) {
    if (!inSection) {
      if (flowEmptyRe.test(line)) return [];
      if (headRe.test(line)) {
        inSection = true;
      }
      continue;
    }
    if (/^\S/.test(line) && !/^\s*-/.test(line)) break;
    const item = line.match(/^\s*-\s*(\{.*\})\s*$/);
    if (item) {
      const parsed = parseInlineObject(item[1]);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function parseEvalScalar(text, key) {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine)) continue;
    const match = rawLine.match(re);
    if (!match) continue;
    const value = parseSafetyScalar(match[1]);
    if (value === null || value === undefined) return null;
    return String(value).trim() || null;
  }
  return null;
}

export function loadEvalSpec(cwd) {
  const evalFile = path.join(cwd, ".researchloop", "eval.yaml");
  if (!fs.existsSync(evalFile)) {
    return { present: false, metrics: [], evalCommand: null };
  }
  const raw = fs.readFileSync(evalFile, "utf8");
  const metrics = parseEvalListSection(raw, "metrics").map((metric) => ({
    name: String(metric.name || metric.metric || "").trim(),
    direction: String(metric.direction || "").trim().toLowerCase() || null,
    regex_or_jsonpath: String(metric.regex_or_jsonpath || metric.regex || metric.jsonpath || "").trim(),
    source: String(metric.source || "stdout").trim().toLowerCase() || "stdout",
    file: metric.file ? String(metric.file).trim() : null,
    path: metric.path ? String(metric.path).trim() : null,
  })).filter((metric) => metric.name && metric.regex_or_jsonpath);
  return {
    present: true,
    metrics,
    evalCommand: parseEvalScalar(raw, "eval_command"),
  };
}

function parseJsonValueFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Fall through to line-by-line parsing.
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    try {
      return JSON.parse(lines[idx]);
    } catch {
      // continue
    }
  }
  return null;
}

function lookupJsonPath(value, expr) {
  const pathText = String(expr || "").trim().replace(/^\$\.?/, "").replace(/^\./, "");
  if (!pathText) return value;
  const tokens = [];
  let i = 0;
  while (i < pathText.length) {
    if (pathText[i] === ".") {
      i += 1;
      continue;
    }
    if (pathText[i] === "[") {
      const end = pathText.indexOf("]", i);
      if (end === -1) return null;
      const rawIndex = pathText.slice(i + 1, end).trim();
      const index = Number(rawIndex);
      tokens.push(Number.isFinite(index) ? index : rawIndex.replace(/^["']|["']$/g, ""));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < pathText.length && pathText[j] !== "." && pathText[j] !== "[") j += 1;
    tokens.push(pathText.slice(i, j));
    i = j;
  }

  let current = value;
  for (const token of tokens) {
    if (current == null) return null;
    current = current[token];
  }
  return current;
}

function metricTextForSource({ cwd, runDir, metric }) {
  const source = String(metric.source || "stdout").toLowerCase();
  if (source === "file") {
    const fileRel = metric.file || metric.path || "eval.json";
    const filePath = path.isAbsolute(fileRel) ? fileRel : path.join(runDir, fileRel);
    return { source, text: readTextIfExists(filePath), filePath };
  }
  return { source: "stdout", text: "", filePath: null };
}

function parseMetricValue({ cwd, runDir, metric, stdout }) {
  const pattern = String(metric.regex_or_jsonpath || "").trim();
  if (!pattern) {
    return { value: null, warning: `metric ${metric.name}: missing regex_or_jsonpath` };
  }
  const source = String(metric.source || "stdout").toLowerCase();
  const sourceText = source === "file"
    ? metricTextForSource({ cwd, runDir, metric })
    : { source: "stdout", text: stdout || "", filePath: null };
  const text = sourceText.text || "";

  if (pattern.startsWith("$")) {
    const parsed = parseJsonValueFromText(text);
    if (parsed == null) {
      return {
        value: null,
        warning: `metric ${metric.name}: JSON source did not parse${source === "file" ? ` (${sourceText.filePath})` : ""}`,
      };
    }
    const value = lookupJsonPath(parsed, pattern);
    if (value === null || value === undefined || value === "") {
      return {
        value: null,
        warning: `metric ${metric.name}: JSONPath ${pattern} did not resolve${source === "file" ? ` (${sourceText.filePath})` : ""}`,
      };
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return {
        value: null,
        warning: `metric ${metric.name}: JSONPath ${pattern} did not resolve to a numeric value`,
      };
    }
    return { value: numeric, warning: null };
  }

  const re = new RegExp(pattern, "gim");
  let last = null;
  let match;
  while ((match = re.exec(text)) !== null) {
    last = match[1] !== undefined ? match[1] : match[0];
  }
  if (last === null || last === undefined || last === "") {
    return {
      value: null,
      warning: `metric ${metric.name}: regex did not match${source === "file" ? ` (${sourceText.filePath})` : ""}`,
    };
  }
  const numeric = Number(last);
  if (!Number.isFinite(numeric)) {
    return {
      value: null,
      warning: `metric ${metric.name}: regex did not match${source === "file" ? ` (${sourceText.filePath})` : ""}`,
    };
  }
  return { value: numeric, warning: null };
}

function collectMetricValues({ cwd, runDir, metrics, stdout }) {
  const values = {};
  const warnings = [];
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    if (!metric || !metric.name) continue;
    const result = parseMetricValue({ cwd, runDir, metric, stdout });
    values[metric.name] = result.value;
    if (result.warning) warnings.push(result.warning);
  }
  return { values, warnings };
}

function latestRunId(rows) {
  for (let idx = rows.length - 1; idx >= 0; idx -= 1) {
    const row = rows[idx];
    if (row && row.id) return String(row.id);
  }
  return null;
}

function safeCommandForOutput(command) {
  return String(command || "").trim();
}

function runEvalCommand({ cwd, runId, command, allowUnsafe = false, quiet = false }) {
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", runId);
  ensureDir(runDir);
  const logPath = path.join(runDir, "eval.log");
  const policy = loadSafetyPolicy(cwd);
  const safetyCheck = evaluateCommandSafety(command, policy);
  if (!allowUnsafe && !safetyCheck.allowed) {
    const message = `blocked by safety: ${safetyCheck.rule} ${safetyCheck.message}`;
    fs.writeFileSync(logPath, `${message}\n`);
    return {
      ok: false,
      status: "blocked",
      runId,
      command,
      logPath,
      stdout: "",
      stderr: message,
      exitCode: 126,
      warnings: [message],
      parseWarnings: [message],
      metrics: {},
    };
  }

  const child = spawnSync(command, {
    cwd: runDir,
    shell: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      RESEARCHLOOP_RUN_ID: runId,
      RESEARCHLOOP_RUN_DIR: runDir,
      RESEARCHLOOP_REPO_ROOT: cwd,
    },
    timeout: allowUnsafe || !Number.isFinite(safetyCheck.maxMs) ? undefined : safetyCheck.maxMs,
  });
  const stdout = String(child.stdout || "");
  const stderr = String(child.stderr || "");
  const combined = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n");
  fs.writeFileSync(logPath, `${combined ? `${combined}\n` : ""}`);

  const evalSpec = loadEvalSpec(cwd);
  const declaredMetrics = evalSpec.metrics.length ? evalSpec.metrics : [];
  const { values, warnings } = collectMetricValues({ cwd, runDir, metrics: declaredMetrics, stdout });
  const exitCode = Number.isFinite(Number(child.status)) ? Number(child.status) : 1;
  if (exitCode !== 0) warnings.push(`eval command exited ${exitCode}`);

  if (!quiet) {
    console.log(`autoresearch eval`);
    console.log(`run_id: ${runId}`);
    console.log(`command: ${safeCommandForOutput(command)}`);
    console.log(`log: ${path.relative(cwd, logPath)}`);
    for (const metric of declaredMetrics) {
      const value = values[metric.name];
      console.log(`- ${metric.name}: ${value === null ? "null" : value}`);
    }
    for (const warning of warnings) {
      console.log(`warning: ${warning}`);
    }
  }

  return {
    ok: true,
    status: exitCode === 0 ? "complete" : "failed",
    runId,
    command,
    logPath,
    stdout,
    stderr,
    exitCode,
    warnings,
    parseWarnings: warnings.slice(),
    metrics: values,
    evalSpec,
  };
}

function applyEvalResultToRow(row, evalResult, cwd = process.cwd()) {
  const next = { ...row };
  next.metrics = { ...(row.metrics || {}), ...(evalResult.metrics || {}) };
  const warnings = Array.isArray(row.parse_warnings) ? [...row.parse_warnings] : [];
  for (const warning of evalResult.parseWarnings || []) {
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  }
  if (warnings.length) next.parse_warnings = warnings;
  next.eval_command = evalResult.command;
  next.eval_log = evalResult.logPath ? path.relative(cwd, evalResult.logPath) : null;
  next.eval_status = evalResult.status;
  return next;
}

export async function cmdEval(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const rows = readLedgerRows(cwd);
  if (!rows.length) {
    console.error("eval: no runs found");
    process.exitCode = 1;
    return;
  }

  const requestedRunId = String(option("--run-id", option("--id", "")) || "").trim();
  const runId = requestedRunId || latestRunId(rows);
  if (!runId) {
    console.error("eval: no run id available");
    process.exitCode = 1;
    return;
  }

  const row = findRowById(rows, runId);
  if (!row) {
    console.error(`eval: run not found: ${runId}`);
    process.exitCode = 1;
    return;
  }

  const spec = loadEvalSpec(cwd);
  const overrideCommand = option("--command", null);
  const command = String(overrideCommand || spec.evalCommand || "").trim();
  if (!command) {
    console.error("eval: no eval command found in eval.yaml (use --command or add eval_command)");
    process.exitCode = 1;
    return;
  }

  const allowUnsafe = hasFlag("--allow-unsafe");
  const format = String(option("--format", "text")).toLowerCase();
  const result = runEvalCommand({ cwd, runId, command, allowUnsafe, quiet: format === "json" });
  if (!result.ok) {
    if (result.warnings.length) {
      for (const warning of result.warnings) console.error(`eval: ${warning}`);
    }
    process.exitCode = 1;
    return;
  }

  const updated = applyEvalResultToRow(row, result, cwd);
  rewriteLedger(cwd, rows.map((item) => (String(item.id) === String(runId) ? updated : item)));

  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      run_id: runId,
      command,
      status: result.status,
      exit_code: result.exitCode,
      log: path.relative(cwd, result.logPath),
      metrics: result.metrics,
      warnings: result.warnings,
    }, null, 2)}\n`);
  } else {
    console.log(`eval: recorded for ${runId}`);
    console.log(`status: ${result.status}`);
    console.log(`log: ${path.relative(cwd, result.logPath)}`);
  }
}

export async function runDeclaredEval({ cwd, runId, command = null, allowUnsafe = false, quiet = true }) {
  const spec = loadEvalSpec(cwd);
  const evalCommand = String(command || spec.evalCommand || "").trim();
  if (!evalCommand) {
    return {
      ok: false,
      status: "missing_command",
      runId,
      command: null,
      warnings: ["no eval command found"],
      parseWarnings: ["no eval command found"],
      metrics: {},
      logPath: null,
      exitCode: 1,
    };
  }

  const result = runEvalCommand({ cwd, runId, command: evalCommand, allowUnsafe, quiet });
  return result;
}

export function mergeEvalResultIntoRow(row, evalResult, cwd = process.cwd()) {
  if (!evalResult || !evalResult.ok) return row;
  return applyEvalResultToRow(row, evalResult, cwd);
}
