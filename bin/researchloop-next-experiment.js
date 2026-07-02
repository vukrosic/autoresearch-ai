import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./researchloop-core.js";

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

function extractSection(text, heading) {
  const lines = String(text ?? "").split("\n");
  const target = String(heading ?? "").trim().toLowerCase();
  let capture = false;
  const out = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^##\s+/.test(line)) {
      const current = line.replace(/^##\s+/, "").trim().toLowerCase();
      if (capture && current !== target) break;
      capture = current === target;
      continue;
    }
    if (capture) out.push(rawLine);
  }
  return out.join("\n").trim();
}

function parseKeyValueSection(section, key) {
  const re = new RegExp(`^\\s*-\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "mi");
  const match = String(section ?? "").match(re);
  return match && match[1] ? match[1].trim() : "";
}

function extractFieldValue(text, bulletKey, headingName = bulletKey) {
  return parseKeyValueSection(text, bulletKey) || extractSection(text, headingName) || "";
}

function resolvePath(cwd, file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.join(cwd, file);
}

function readJsonl(file) {
  const text = readTextIfExists(file);
  if (!text.trim()) return [];
  return text.split("\n")
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path.basename(file)} line ${index + 1}: ${err.message}`);
      }
    });
}

function proposalInputPath(cwd, inputOpt) {
  if (inputOpt && typeof inputOpt === "string") return resolvePath(cwd, inputOpt);
  const ranked = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.jsonl");
  if (fs.existsSync(ranked)) return ranked;
  return path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl");
}

function readGoalContext(cwd) {
  const goalText = readTextIfExists(path.join(cwd, ".researchloop", "goal.md"));
  const baselineText = readTextIfExists(path.join(cwd, ".researchloop", "baseline.md"));
  const targetText = goalText || baselineText;
  const whatToRecord = extractSection(baselineText, "What To Record") || baselineText;
  return {
    goal: extractSection(goalText, "Goal") || compressSpace(goalText.split("\n").find((line) => !line.startsWith("#")) || ""),
    metric:
      extractFieldValue(targetText, "Target Metric") ||
      extractFieldValue(whatToRecord, "Metric") ||
      "val_loss",
    direction:
      extractFieldValue(targetText, "Direction") ||
      extractFieldValue(whatToRecord, "Direction") ||
      "lower",
    baselineCommand:
      extractFieldValue(targetText, "Baseline Command") ||
      extractFieldValue(whatToRecord, "Command or config") ||
      "",
    evaluationCommand: extractFieldValue(targetText, "Evaluation Command") || "",
  };
}

function safeSlug(value) {
  return String(value || "proposal")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "proposal";
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\"'\"'")}'`;
}

function extractBacktickPaths(text) {
  const out = [];
  for (const match of String(text ?? "").matchAll(/`([^`]+)`/g)) {
    const value = match[1].trim();
    if (!value || value.includes("\n")) continue;
    if (/\s/.test(value) && !/[./\\]/.test(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

function selectProposal(rows, proposalId) {
  if (!rows.length) return null;
  if (proposalId) {
    return rows.find((row) => String(row.id) === String(proposalId)) || null;
  }
  const scored = rows.filter((row) => Number.isFinite(Number(row.score)));
  if (scored.length) {
    return [...scored].sort((a, b) => Number(b.score) - Number(a.score) || String(a.id || "").localeCompare(String(b.id || "")))[0];
  }
  return rows[0];
}

function buildRunCommand({ runId, command, metric }) {
  if (!command) return "";
  return [
    "autoresearch run",
    `  --id ${shellQuote(runId)}`,
    metric ? `  --metric ${shellQuote(metric)}` : null,
    `  --command ${shellQuote(command)}`,
  ].filter(Boolean).join(" \\\n");
}

function buildSmokeCommand({ runId, command, metric }) {
  if (!command) return "";
  return [
    "autoresearch smoke",
    `  --id ${shellQuote(`smoke-${runId}`)}`,
    metric ? `  --metric ${shellQuote(metric)}` : null,
    `  --command ${shellQuote(command)}`,
  ].filter(Boolean).join(" \\\n");
}

function priorLine(prior) {
  if (!prior || typeof prior !== "object") return null;
  const type = prior.type || "paper";
  const id = prior.id || prior.title || "unknown";
  const bits = [`${type}:${id}`];
  if (prior.title) bits.push(prior.title);
  if (prior.link) bits.push(prior.link);
  return `- ${bits.join(" | ")}`;
}

function buildPlan({ cwd, proposal, sourcePath, runId, goal }) {
  const command = proposal.command || proposal.run_command || goal.baselineCommand || "";
  const metric = proposal.metric || goal.metric || "val_loss";
  const direction = proposal.expected_direction || goal.direction || "lower";
  const targets = extractBacktickPaths(proposal.change);
  const runCommand = buildRunCommand({ runId, command, metric });
  const smokeCommand = buildSmokeCommand({ runId, command, metric });
  const preflightCommand = command ? `autoresearch preflight --command ${shellQuote(command)}` : "";
  const evidenceLines = (Array.isArray(proposal.priors) ? proposal.priors : [])
    .map(priorLine)
    .filter(Boolean);

  // Auto VRAM-fit + wall-time projection in the runbook.
  // Pulls arch hints from proposal.params/layers/d_model OR the repo profile;
  // calls analyzeVram from the gpu-fit module. Best-effort — silent if no arch.
  let resourceLines = [];
  try {
    const arch = (proposal.arch || proposal.config || {});
    const repoProfileFile = path.join(cwd, ".researchloop", "repo-profile.json");
    let profileModel = {};
    if (fs.existsSync(repoProfileFile)) {
      try { profileModel = (JSON.parse(fs.readFileSync(repoProfileFile, "utf8")) || {}).model || {}; } catch { /* ignore */ }
    }
    const vramOpts = {
      params: arch.params ?? profileModel.params ?? null,
      layers: arch.layers ?? profileModel.layers ?? null,
      dModel: arch.d_model ?? profileModel.d_model ?? profileModel.hidden_size ?? null,
      dFf: arch.d_ff ?? profileModel.d_ff ?? null,
      vocab: arch.vocab ?? profileModel.vocab_size ?? null,
      batch: arch.batch_size ?? profileModel.batch_size ?? 1,
      seq: arch.seq_len ?? profileModel.seq_len ?? profileModel.context_length ?? 2048,
      dtype: arch.dtype ?? profileModel.dtype ?? "bf16",
      optimizer: arch.optimizer ?? "adamw",
      gradCheckpoint: !!(arch.grad_checkpoint ?? profileModel.grad_checkpoint),
    };
    if (vramOpts.params || (vramOpts.layers && vramOpts.dModel)) {
      // Lazy-import so the runbook builder doesn't take a hard dependency on
      // gpu-fit's surface when the user never trains transformers.
      const mod = require?.main ? null : null;
    }
    // ESM lazy load happens below outside this try, since this builder is
    // synchronous and analyzeVram is sync but lives in a sibling module.
    resourceLines = [
      "## Resource Sanity",
      "",
    ];
    // Synchronous dynamic import isn't available — we just emit a checklist
    // pointer for the agent to run, with the resolved arch hints baked in.
    const argParts = [];
    if (vramOpts.params) argParts.push(`--params ${vramOpts.params}`);
    if (vramOpts.layers) argParts.push(`--layers ${vramOpts.layers}`);
    if (vramOpts.dModel) argParts.push(`--d-model ${vramOpts.dModel}`);
    if (vramOpts.dFf) argParts.push(`--d-ff ${vramOpts.dFf}`);
    if (vramOpts.vocab) argParts.push(`--vocab ${vramOpts.vocab}`);
    if (vramOpts.batch) argParts.push(`--batch ${vramOpts.batch}`);
    if (vramOpts.seq) argParts.push(`--seq ${vramOpts.seq}`);
    if (vramOpts.dtype) argParts.push(`--dtype ${vramOpts.dtype}`);
    if (vramOpts.gradCheckpoint) argParts.push(`--grad-checkpoint`);
    if (argParts.length === 0) {
      resourceLines.push("- Arch unknown to autoresearch (no proposal.arch and no `model` block in repo-profile.json). Run `autoresearch gpu-fit --layers N --d-model N ...` manually if you're training a transformer.");
    } else {
      resourceLines.push("Check VRAM fit before the run:");
      resourceLines.push("");
      resourceLines.push("```bash");
      resourceLines.push(`autoresearch gpu-fit ${argParts.join(" ")} --gpu H100`);
      resourceLines.push("```");
      resourceLines.push("");
      resourceLines.push("Project wall time + cost vs ledger history:");
      resourceLines.push("");
      resourceLines.push("```bash");
      resourceLines.push("autoresearch sweep-projection --n 1");
      resourceLines.push("```");
    }
    resourceLines.push("");
  } catch { resourceLines = []; }

  const lines = [
    `# Next Experiment: ${proposal.title || proposal.id || "proposal"}`,
    "",
    `- Proposal id: ${proposal.id || "unknown"}`,
    `- Source file: ${path.relative(cwd, sourcePath) || sourcePath}`,
    Number.isFinite(Number(proposal.score)) ? `- Rank score: ${proposal.score}` : null,
    proposal.score_breakdown?.why ? `- Rank reason: ${proposal.score_breakdown.why}` : null,
    `- Run id: ${runId}`,
    `- Metric: ${metric}`,
    `- Direction: ${direction}`,
    "",
    "## Hypothesis",
    "",
    proposal.hypothesis || "No hypothesis recorded.",
    "",
    "## Mechanism",
    "",
    proposal.mechanism || "No mechanism recorded.",
    "",
    "## Change",
    "",
    proposal.change || "No concrete change recorded.",
    "",
    "## Edit Targets",
    "",
    ...(targets.length ? targets.map((target) => `- ${target}`) : ["- No explicit file path found in the proposal change. Inspect the repo before editing."]),
    "",
    "## Prior Evidence",
    "",
    ...(evidenceLines.length ? evidenceLines : ["- No attached prior evidence. Consider `autoresearch priors --proposal <id>` before running an expensive experiment."]),
    "",
    ...resourceLines,
    "## Execution",
    "",
    "1. Implement only the proposal change above.",
    "2. Keep the baseline dataset, model size, seed, and evaluation surface frozen unless the proposal explicitly changes one of them.",
    "3. Run preflight, then a smoke test, then the full run.",
    "",
    preflightCommand ? "```bash" : null,
    preflightCommand || null,
    preflightCommand ? "```" : null,
    "",
    smokeCommand ? "```bash" : null,
    smokeCommand || null,
    smokeCommand ? "```" : null,
    "",
    runCommand ? "```bash" : null,
    runCommand || "No baseline command was found. Add a command before executing this plan.",
    runCommand ? "```" : null,
    "",
    "## Kill Criterion",
    "",
    proposal.kill_criterion || `${metric} does not move ${direction} after one baseline-sized run.`,
    "",
    "## After The Run",
    "",
    `- Compare: \`autoresearch compare --metric ${metric} --direction ${direction}\``,
    `- Inspect: \`autoresearch story ${runId}\``,
    `- If it wins: \`autoresearch promote --id ${runId}\``,
    "",
  ];

  return lines.filter((line) => line !== null).join("\n");
}

function buildScript(plan) {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Review the markdown plan and implement the proposed code/config change before running this script.",
    "# This wrapper only runs the checks and launch command; it does not edit your repo.",
    "",
  ];
  for (const block of plan.matchAll(/```bash\n([\s\S]*?)\n```/g)) {
    lines.push(block[1].trim(), "");
  }
  return `${lines.join("\n")}\n`;
}

export function cmdNextExperiment(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const idx = args.findIndex((arg) => arg === "next-experiment" || arg === "next");
  const positional = idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-") ? args[idx + 1] : "";
  const proposalId = String(option("--proposal", positional) || "").trim();
  const inputPath = proposalInputPath(cwd, option("--input", null));
  const format = String(option("--format", "markdown") || "markdown").toLowerCase();
  const doWrite = hasFlag("--write");

  let rows;
  try {
    if (!fs.existsSync(inputPath)) {
      console.error(`next-experiment: no proposals found at ${inputPath} (run \`autoresearch rank --write\` or \`autoresearch propose --write\` first)`);
      process.exitCode = 1;
      return;
    }
    rows = readJsonl(inputPath);
  } catch (err) {
    console.error(`next-experiment: failed to read proposals: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const proposal = selectProposal(rows, proposalId);
  if (!proposal) {
    console.error(proposalId ? `next-experiment: proposal not found: ${proposalId}` : "next-experiment: no proposal rows found");
    process.exitCode = 1;
    return;
  }

  const runId = String(option("--run-id", `exp-${safeSlug(proposal.id || proposal.title)}`)).trim();
  const goal = readGoalContext(cwd);
  const plan = buildPlan({ cwd, proposal, sourcePath: inputPath, runId, goal });

  if (format === "json") {
    process.stdout.write(`${JSON.stringify({
      proposal_id: proposal.id || null,
      title: proposal.title || null,
      source: path.relative(cwd, inputPath) || inputPath,
      run_id: runId,
      metric: proposal.metric || goal.metric,
      direction: proposal.expected_direction || goal.direction,
      command: proposal.command || proposal.run_command || goal.baselineCommand || null,
      plan,
    }, null, 2)}\n`);
    return;
  }

  let outPath = null;
  if (doWrite) {
    const outOpt = option("--out", null);
    outPath = outOpt && typeof outOpt === "string"
      ? resolvePath(cwd, outOpt)
      : path.join(cwd, ".researchloop", "scratchpad", "experiments", `${safeSlug(proposal.id || runId)}.md`);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, `${plan}\n`);
  }

  const scriptOpt = option("--script", null);
  if (scriptOpt && typeof scriptOpt === "string") {
    const scriptPath = resolvePath(cwd, scriptOpt);
    ensureDir(path.dirname(scriptPath));
    fs.writeFileSync(scriptPath, buildScript(plan));
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch {}
    console.log(`experiment script written to: ${scriptPath}`);
  }

  if (outPath) {
    console.log(`experiment plan written to: ${outPath}`);
  } else {
    process.stdout.write(`${plan}\n`);
  }
}
