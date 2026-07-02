import fs from "node:fs";
import path from "node:path";
import { ensureDir, readLedgerRows, metricNumber } from "./researchloop-core.js";

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

function normalizeText(text) {
  return compressSpace(text).toLowerCase();
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

function readGoalContext(cwd) {
  const goalText = readTextIfExists(path.join(cwd, ".researchloop", "goal.md"));
  const baselineText = readTextIfExists(path.join(cwd, ".researchloop", "baseline.md"));
  const targetText = goalText || baselineText;
  const whatToRecord = extractSection(targetText, "What To Record") || targetText;
  const frozenSurfaces = extractSection(targetText, "Frozen Surfaces") || targetText;
  const baselineState = !baselineText
    ? "missing"
    : (() => {
        const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
        const requiredFrozen = ["Dataset", "Model size", "Seed"];
        const missing = [];
        for (const key of requiredWhatToRecord) {
          if (!parseKeyValueSection(whatToRecord || baselineText, key)) missing.push(key);
        }
        for (const key of requiredFrozen) {
          if (!parseKeyValueSection(frozenSurfaces || baselineText, key)) missing.push(key);
        }
        return missing.length === 0 ? "complete" : "incomplete";
      })();
  return {
    baselineState,
    metric:
      extractFieldValue(targetText, "Target Metric") ||
      extractFieldValue(targetText, "Metric") ||
      extractFieldValue(baselineText, "Metric") ||
      "val_loss",
    direction:
      normalizeText(extractFieldValue(targetText, "Direction") || extractFieldValue(baselineText, "Direction")) ||
      "lower",
  };
}

function readProposalRows(file) {
  const rows = [];
  const text = readTextIfExists(file);
  if (!text.trim()) return rows;
  const lines = text.split("\n").filter((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    try {
      rows.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`failed to parse proposals.jsonl line ${index + 1}: ${err.message}`);
    }
  }
  return rows;
}

function collectRunMechanisms(run) {
  const out = new Set();
  const add = (value) => {
    const text = normalizeText(value);
    if (text) out.add(text);
  };
  add(run?.mechanism);
  add(run?.hypothesis_mechanism);
  add(run?.config?.mechanism);
  add(run?.params?._mechanism);
  add(run?.params?.mechanism);
  add(run?.note);
  add(run?.command);
  return out;
}

function collectProposalPriorRunIds(priors) {
  const ids = new Set();
  for (const prior of Array.isArray(priors) ? priors : []) {
    if (typeof prior === "string") {
      const match = prior.match(/\brun:([A-Za-z0-9._-]+)\b/i);
      if (match) ids.add(match[1]);
      continue;
    }
    if (!prior || typeof prior !== "object") continue;
    const type = normalizeText(prior.type || prior.kind || "");
    const id = prior.id || prior.run_id || prior.runId;
    if (type === "run" && id) ids.add(String(id));
    if (prior.replay_of && id) ids.add(String(prior.replay_of));
  }
  return ids;
}

function proposalMechanismText(proposal) {
  return normalizeText([proposal?.mechanism, proposal?.title, proposal?.hypothesis, proposal?.change].join(" "));
}

function mechanismMatchesRunSets(proposal, runMechanisms) {
  const mech = proposalMechanismText(proposal);
  if (!mech) return false;
  for (const runMech of runMechanisms) {
    if (!runMech) continue;
    if (mech.includes(runMech) || runMech.includes(mech)) return true;
  }
  return false;
}

function findBestRun(runs, metric, direction) {
  const scored = [];
  for (const [index, run] of runs.entries()) {
    if (!run || run.parse_error) continue;
    const status = normalizeText(run.status || "");
    if (!/(complete|completed|promoted|kept)/.test(status)) continue;
    const metricValue = metric
      ? metricNumber(run.metrics && run.metrics[metric])
      : Number.NaN;
    const fallbackValue = metricNumber(run.value);
    const chosenValue = Number.isFinite(metricValue)
      ? metricValue
      : Number.isFinite(fallbackValue)
        ? fallbackValue
        : null;
    if (chosenValue == null) continue;
    scored.push({ run, index, metricValue: chosenValue });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => {
    if (a.metricValue !== b.metricValue) {
      return direction === "higher"
        ? b.metricValue - a.metricValue
        : a.metricValue - b.metricValue;
    }
    return a.index - b.index;
  });
  return scored[0].run;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round3(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

function riskValue(risk) {
  const lowered = normalizeText(risk);
  if (lowered === "low") return 0.2;
  if (lowered === "high") return 0.8;
  if (lowered === "med" || lowered === "medium") return 0.5;
  return 0.5;
}

function costValue(minutes) {
  const mins = Number.isFinite(Number(minutes)) ? Number(minutes) : 60;
  return clamp01(mins / 240);
}

function priorEvidenceCounts(priors) {
  const counts = { paper: 0, run: 0, other: 0 };
  const seen = new Set();
  for (const prior of Array.isArray(priors) ? priors : []) {
    if (!prior || typeof prior !== "object") continue;
    const id = String(prior.id || "").trim();
    if (!id) continue;
    const type = normalizeText(prior.type || prior.kind || "paper") || "paper";
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === "paper" || type === "arxiv") counts.paper += 1;
    else if (type === "run") counts.run += 1;
    else counts.other += 1;
  }
  return counts;
}

function evidenceValue(proposal) {
  const counts = priorEvidenceCounts(proposal.priors);
  if (counts.paper === 0 && counts.run === 0 && counts.other === 0) return 0.15;
  return clamp01(0.2 + Math.min(0.5, counts.paper * 0.25) + Math.min(0.25, counts.run * 0.12) + Math.min(0.15, counts.other * 0.08));
}

function impactValue(proposal, goal, bestRunId, runMechanisms) {
  const sourceType = normalizeText(proposal.source_type || "generic");
  let impact = 0.48;
  if (sourceType === "paper") impact = 0.78;
  else if (sourceType === "hypothesis") impact = 0.72;
  else if (sourceType === "run") impact = 0.6;

  if (normalizeText(proposal.metric) && normalizeText(proposal.metric) === normalizeText(goal.metric)) impact += 0.04;
  if (normalizeText(proposal.expected_direction) && normalizeText(proposal.expected_direction) === normalizeText(goal.direction)) impact += 0.04;

  if (proposal.source_type === "run" && proposal.source_id && String(proposal.source_id) === String(bestRunId)) {
    impact -= 0.25;
  }
  if (mechanismMatchesRunSets(proposal, runMechanisms)) {
    impact -= 0.05;
  }

  return clamp01(impact);
}

function noveltyValue(proposal, bestRunId, runMechanisms) {
  const sourceType = normalizeText(proposal.source_type || "generic");
  const sourceId = String(proposal.source_id || "");
  const priorRunIds = collectProposalPriorRunIds(proposal.priors);
  const mechMatches = mechanismMatchesRunSets(proposal, runMechanisms);

  if (sourceType === "run" && bestRunId && sourceId === String(bestRunId)) return 0.1;
  if (bestRunId && priorRunIds.has(String(bestRunId)) && sourceType === "run") return 0.15;
  if (mechMatches) return 0.2;
  if (sourceType === "run") return 0.35;
  if (priorRunIds.size > 0) return 0.65;
  return 0.85;
}

function scoreProposal(proposal, context) {
  const impact = impactValue(proposal, context.goal, context.bestRun?.id, context.runMechanisms);
  const cost = costValue(proposal.estimated_minutes);
  const risk = riskValue(proposal.risk);
  const novelty = noveltyValue(proposal, context.bestRun?.id, context.runMechanisms);
  const evidence = evidenceValue(proposal);
  const evidenceCounts = priorEvidenceCounts(proposal.priors);
  const score = round3(impact * 0.35 + novelty * 0.25 + (1 - cost) * 0.15 + (1 - risk) * 0.15 + evidence * 0.1);

  const why = [];
  if (normalizeText(proposal.source_type) === "paper") why.push("paper-backed");
  else if (normalizeText(proposal.source_type) === "hypothesis") why.push("hypothesis-backed");
  else if (normalizeText(proposal.source_type) === "run") why.push("run-derived");
  else why.push("generic fallback");
  if (cost < 0.3) why.push("cheap to run");
  else if (cost > 0.7) why.push("expensive to run");
  if (risk < 0.3) why.push("low risk");
  else if (risk > 0.6) why.push("high risk");
  if (novelty > 0.7) why.push("novel relative to runs");
  else if (novelty < 0.3) why.push("close to an existing run");
  if (impact > 0.7) why.push("strong goal alignment");
  else if (impact < 0.45) why.push("weak evidence signal");
  if (evidenceCounts.paper > 0) why.push(`${evidenceCounts.paper} paper prior${evidenceCounts.paper === 1 ? "" : "s"}`);
  if (evidenceCounts.run > 0) why.push(`${evidenceCounts.run} run prior${evidenceCounts.run === 1 ? "" : "s"}`);
  if (evidence < 0.2) why.push("thin prior evidence");

  return {
    score,
    score_breakdown: {
      impact: round3(impact),
      cost: round3(cost),
      risk: round3(risk),
      novelty_vs_runs: round3(novelty),
      evidence: round3(evidence),
      why: why.join("; ") || "mixed signals",
    },
  };
}

function markdownCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function buildMarkdown(rows, context) {
  const lines = [];
  lines.push("# Ranked Proposals");
  lines.push("");
  lines.push(`_Goal metric: ${context.goal.metric || "unknown"}; direction: ${context.goal.direction || "lower"}_`);
  lines.push("");
  lines.push("| Rank | Score | Title | Source | Mechanism | Cost | Risk | Novelty | Evidence | Why |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const [index, row] of rows.entries()) {
    lines.push(`| ${[
      index + 1,
      row.score,
      row.title,
      `${row.source_type || "generic"}:${row.source_id || row.id || "unknown"}`,
      row.mechanism || "unknown",
      row.score_breakdown.cost,
      row.score_breakdown.risk,
      row.score_breakdown.novelty_vs_runs,
      row.score_breakdown.evidence,
      row.score_breakdown.why,
    ].map(markdownCell).join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Details");
  lines.push("");
  for (const [index, row] of rows.entries()) {
    lines.push(`### ${index + 1}. ${row.title} (score: ${row.score})`);
    lines.push(`- **Hypothesis:** ${row.hypothesis}`);
    lines.push(`- **Change:** ${row.change}`);
    lines.push(`- **Metric:** ${row.metric}`);
    lines.push(`- **Expected direction:** ${row.expected_direction}`);
    lines.push(`- **Risk:** ${row.risk}`);
    lines.push(`- **Kill criterion:** ${row.kill_criterion}`);
    lines.push(`- **Why:** ${row.score_breakdown.why}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function cmdRank(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const inputFile = option("--input", null);
  const doWrite = hasFlag("--write");
  const inputPath = inputFile
    ? path.join(cwd, inputFile)
    : path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl");

  let proposals = [];
  try {
    if (!fs.existsSync(inputPath)) {
      console.error(`rank: no proposals found at ${inputPath} (use --input or run \`autoresearch propose --write\` first)`);
      process.exitCode = 1;
      return;
    }
    proposals = readProposalRows(inputPath);
  } catch (err) {
    console.error(`rank: failed to read proposals: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (proposals.length === 0) {
    console.error("rank: no proposals to rank");
    process.exitCode = 1;
    return;
  }

  const goal = readGoalContext(cwd);
  const runs = readLedgerRows(cwd);
  const bestRun = findBestRun(runs, goal.metric, goal.direction);
  const runMechanisms = new Set();
  for (const run of runs) {
    for (const mechanism of collectRunMechanisms(run)) {
      runMechanisms.add(mechanism);
    }
  }

  const context = {
    goal,
    bestRun,
    runMechanisms: [...runMechanisms],
  };

  const scored = proposals.map((proposal) => ({
    ...proposal,
    ...scoreProposal(proposal, context),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.score_breakdown.impact !== a.score_breakdown.impact) {
      return b.score_breakdown.impact - a.score_breakdown.impact;
    }
    if (b.score_breakdown.novelty_vs_runs !== a.score_breakdown.novelty_vs_runs) {
      return b.score_breakdown.novelty_vs_runs - a.score_breakdown.novelty_vs_runs;
    }
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  if (doWrite) {
    const rankedPath = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.jsonl");
    const scratchpadDir = path.dirname(rankedPath);
    ensureDir(scratchpadDir);
    fs.writeFileSync(rankedPath, `${scored.map((row) => JSON.stringify(row)).join("\n")}\n`);

    const mdPath = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.md");
    fs.writeFileSync(mdPath, `${buildMarkdown(scored, context)}\n`);

    console.log(`Ranked ${scored.length} proposals -> ${rankedPath}`);
    console.log(`Markdown summary -> ${mdPath}`);
  } else {
    process.stdout.write(`${JSON.stringify(scored, null, 2)}\n`);
  }
}
