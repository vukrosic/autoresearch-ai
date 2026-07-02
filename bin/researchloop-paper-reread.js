import fs from "node:fs";
import path from "node:path";
import { readPaperNotes, readRuns } from "./researchloop-research.js";

const SHORT_SIGNAL_TOKENS = new Set(["lr", "l1", "l2", "f1", "mse", "sgd", "adam", "gnn"]);
const STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "into", "over", "under", "about", "after",
  "before", "when", "then", "than", "they", "them", "their", "our", "your", "you", "we", "us",
  "paper", "claim", "mechanism", "limits", "baseline", "relevance", "result", "results", "note",
  "run", "runs", "metric", "metrics", "model", "models", "data", "training", "train", "validation",
  "loss", "command", "config", "change", "changes", "step", "steps", "epoch", "epochs", "current",
  "smallest", "compare", "comparison", "paperread", "reread", "analysis", "experiment", "experiments",
  "plus", "improve", "improves", "stability", "stable",
]);

function readTextIfExists(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function normalizeId(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "_");
}

function firstSentence(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : clean).trim();
}

function slugify(value, fallback = "note") {
  const out = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function extractGoalContext(cwd) {
  const goalPath = path.join(cwd, ".researchloop", "goal.md");
  const baselinePath = path.join(cwd, ".researchloop", "baseline.md");
  const goal = readTextIfExists(goalPath) || readTextIfExists(baselinePath);
  const lines = goal.split("\n");
  const get = (...patterns) => {
    for (const pattern of patterns) {
      const line = lines.find((entry) => pattern.test(entry));
      if (line) {
        const value = line.replace(pattern, "").trim();
        if (value) return value;
      }
    }
    return "";
  };
  return {
    metric: get(/^\s*-\s*Target metric:\s*/i, /^\s*-\s*Metric:\s*/i, /^\s*Metric:\s*/i),
    direction: get(/^\s*-\s*Direction:\s*/i, /^\s*Direction:\s*/i),
    baselineCommand: get(/^\s*-\s*Baseline command:\s*/i, /^\s*-\s*Command or config:\s*/i),
    evaluationCommand: get(/^\s*-\s*Evaluation command:\s*/i, /^\s*-\s*Evaluation:\s*/i),
    raw: goal.trim(),
  };
}

function metricValue(row, metricName) {
  if (!row || !metricName) return null;
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  const direct = metrics[metricName];
  if (Number.isFinite(Number(direct))) return Number(direct);
  if (metricName === "value" && Number.isFinite(Number(row.value))) return Number(row.value);
  if (Number.isFinite(Number(row.value)) && (!row.metrics || metricName in metrics === false)) return Number(row.value);
  return null;
}

function findRunById(runs, runId) {
  if (!runId) return null;
  const needle = normalizeId(runId);
  return runs.find((row) => row && normalizeId(row.id) === needle) || null;
}

function findBaselineRun(runs, metricName) {
  const tagged = runs.find((row) => {
    if (!row) return false;
    const tags = Array.isArray(row.tags) ? row.tags : [];
    return tags.includes("baseline") && Number.isFinite(metricValue(row, metricName));
  });
  if (tagged) return tagged;
  return null;
}

function metricCandidates(row) {
  const metrics = row && row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  return Object.keys(metrics).filter((key) => !key.endsWith("_std") && Number.isFinite(Number(metrics[key])));
}

function inferDirection(metricName, goalDirection) {
  const raw = String(goalDirection || "").toLowerCase();
  if (raw.startsWith("high") || raw === "max" || raw === "maximize") return "higher";
  if (raw.startsWith("low") || raw === "min" || raw === "minimize") return "lower";
  const metric = String(metricName || "").toLowerCase();
  if (/(acc|accuracy|f1|precision|recall|auc|bleu|rouge|reward|score)$/i.test(metric)) return "higher";
  if (/(loss|error|perplexity|ppl|latency|time|cost)$/i.test(metric)) return "lower";
  return "lower";
}

function fmt(value) {
  if (!Number.isFinite(Number(value))) return "n/a";
  return Number(value).toFixed(4).replace(/\.?0+$/, "");
}

function tokenSet(text) {
  const tokens = new Set();
  for (const raw of String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) || []) {
    const token = raw.trim();
    if (!token) continue;
    if (STOPWORDS.has(token)) continue;
    if (token.length < 4 && !SHORT_SIGNAL_TOKENS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function paperText(paper) {
  return [
    paper.title,
    paper.claim,
    paper.mechanism,
    paper.howToPort,
    paper.limits,
    paper.baselineRelevance,
    paper.abstract,
  ].filter(Boolean).join(" ");
}

function runText(run) {
  const paramsText = run && run.params && typeof run.params === "object"
    ? Object.entries(run.params).map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" ")
    : "";
  const hypothesisText = run && run.hypothesis && typeof run.hypothesis === "object" ? JSON.stringify(run.hypothesis) : "";
  return [
    run?.command,
    run?.note,
    run?.mechanism,
    run?.description,
    hypothesisText,
    paramsText,
  ].filter(Boolean).join(" ");
}

function alignmentSignals(paper, run) {
  const paperTokens = tokenSet(paperText(paper));
  const runTokens = tokenSet(runText(run));
  const signals = [];
  for (const token of paperTokens) {
    if (runTokens.has(token)) signals.push(token);
  }
  return signals;
}

function renderMarkdown({
  paper,
  run,
  goal,
  metricName,
  direction,
  baseline,
  runValue,
  baselineValue,
  delta,
  signals,
  verdict,
  rationale,
  nextStep,
}) {
  const title = paper.title || paper.id || "paper";
  const lines = [
    `# Paper reread: ${title} vs ${run.id}`,
    "",
    `- Paper id: ${paper.id || "unknown"}`,
    `- Run id: ${run.id}`,
    `- Metric: ${metricName || "unknown"} (${direction})`,
    `- Verdict: ${verdict}`,
    "",
    "## Paper",
    "",
    `- Claim: ${paper.claim || firstSentence(paper.abstract) || "unknown"}`,
    `- Mechanism: ${paper.mechanism || "unknown"}`,
    `- Limits: ${paper.limits || "unknown"}`,
    `- How To Port This: ${paper.howToPort || "unknown"}`,
    `- Baseline Relevance: ${paper.baselineRelevance || "unknown"}`,
    "",
    "## Run",
    "",
    `- Status: ${run.status || "unknown"}`,
    `- Metric value: ${fmt(runValue)}`,
    baseline ? `- Baseline: ${baseline.id} = ${fmt(baselineValue)} (delta ${Number.isFinite(delta) ? `${delta >= 0 ? "+" : ""}${fmt(delta)}` : "n/a"})` : "- Baseline: not tagged in the ledger",
  ];

  if (run.command) {
    lines.push("- Command:");
    lines.push("");
    lines.push("```text");
    lines.push(run.command);
    lines.push("```");
    lines.push("");
  }
  if (run.note) lines.push(`- Note: ${run.note}`, "");
  if (run.params && typeof run.params === "object" && Object.keys(run.params).length > 0) {
    lines.push(`- Params: ${Object.entries(run.params).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ")}`);
    lines.push("");
  }

  lines.push(
    "## Alignment",
    "",
    signals.length ? `- Shared cues: ${signals.slice(0, 8).join(", ")}` : "- Shared cues: none obvious",
    `- Rationale: ${rationale}`,
    "",
    "## Next Step",
    "",
    nextStep,
    "",
    goal.metric || goal.direction ? `- Goal context: ${goal.metric ? `metric ${goal.metric}` : "metric unknown"}${goal.direction ? `, direction ${goal.direction}` : ""}` : null,
    "",
  );

  return lines.filter((line) => line !== null && line !== undefined).join("\n");
}

function chooseNextStep({ verdict, paperId, runId }) {
  if (verdict === "supports") {
    return `- Continue with \`autoresearch hypothesis --paper-id ${paperId} --write\` to turn the supported paper into a mechanism-first follow-up.`;
  }
  if (verdict === "partial") {
    return `- Tighten the mechanism with \`autoresearch hypothesis --paper-id ${paperId} --write\` and keep the next test small enough to isolate the shared cues.`;
  }
  if (verdict === "regressed") {
    return `- Record the dead end with \`autoresearch learn --id ${runId} --lesson "Paper ${paperId} did not transfer cleanly into this run"\` before trying another mechanism.`;
  }
  return `- Keep the note honest with \`autoresearch learn --id ${runId} --lesson "Paper reread was inconclusive; the run needs a clearer baseline or more explicit mechanism cue"\`.`;
}

export async function cmdPaperReread(ctx) {
  const { option, hasFlag, positionalText, targetDir } = ctx;
  const cwd = targetDir();
  const paperId = normalizeId(option("--paper-id", positionalText()) || "");
  const runId = normalizeId(option("--against", option("--run-id", "")) || "");
  const doWrite = hasFlag("--write");
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (!paperId || !runId) {
    console.error("Usage: autoresearch paper-reread <paper-id> --against <run-id> [--write] [--format text|json|markdown] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const papers = readPaperNotes(cwd);
  const paper = papers.find((entry) => normalizeId(entry.id) === paperId || normalizeId(path.basename(entry.path || "", ".md")) === paperId) || null;
  if (!paper) {
    console.error(`paper-reread: no paper note found for ${paperId}. Run \`autoresearch paper-read ${paperId} --write\` first.`);
    process.exitCode = 1;
    return;
  }

  const runs = readRuns(cwd);
  const run = findRunById(runs, runId);
  if (!run) {
    console.error(`paper-reread: no run found for ${runId}`);
    process.exitCode = 1;
    return;
  }

  const goal = extractGoalContext(cwd);
  const metricName = goal.metric
    || metricCandidates(run)[0]
    || (Number.isFinite(Number(run.value)) ? "value" : "");
  const direction = inferDirection(metricName, goal.direction);
  const baseline = findBaselineRun(runs, metricName);
  const runValue = metricValue(run, metricName);
  const baselineValue = baseline ? metricValue(baseline, metricName) : null;
  const delta = Number.isFinite(runValue) && Number.isFinite(baselineValue) ? runValue - baselineValue : null;
  const signals = alignmentSignals(paper, run);
  const improved = Number.isFinite(delta)
    ? (direction === "higher" ? delta > 0 : delta < 0)
    : false;
  const verdict = !Number.isFinite(runValue)
    ? "unclear"
    : !Number.isFinite(delta)
      ? "unclear"
      : improved && signals.length >= 2
        ? "supports"
        : improved && signals.length === 1
          ? "partial"
          : Number.isFinite(delta) && delta > 0 && direction === "lower"
            ? "regressed"
            : Number.isFinite(delta) && delta < 0 && direction === "higher"
              ? "regressed"
              : signals.length > 0
                ? "partial"
                : "unclear";

  const rationaleBits = [];
  if (signals.length > 0) {
    rationaleBits.push(`the run text shares ${signals.length} mechanism cue${signals.length === 1 ? "" : "s"} with the paper`);
  } else {
    rationaleBits.push("the run text does not obviously exercise the same mechanism as the paper note");
  }
  if (Number.isFinite(delta)) {
    const movement = improved ? "moved in the expected direction" : "moved against the expected direction";
    rationaleBits.push(`the metric ${movement} (${fmt(runValue)} vs ${baseline ? fmt(baselineValue) : "n/a"})`);
  } else {
    rationaleBits.push("there was no numeric baseline comparison available");
  }
  const rationale = rationaleBits.join("; ");
  const nextStep = chooseNextStep({ verdict, paperId, runId });

  const note = renderMarkdown({
    paper,
    run,
    goal,
    metricName,
    direction,
    baseline,
    runValue,
    baselineValue,
    delta: Number.isFinite(delta) ? delta : null,
    signals,
    verdict,
    rationale,
    nextStep,
  });

  const payload = {
    paper: {
      id: paper.id || paperId,
      title: paper.title || paper.id || paperId,
      claim: paper.claim || firstSentence(paper.abstract) || "",
      mechanism: paper.mechanism || "",
      limits: paper.limits || "",
      how_to_port: paper.howToPort || "",
      baseline_relevance: paper.baselineRelevance || "",
    },
    run: {
      id: run.id,
      status: run.status || null,
      command: run.command || null,
      note: run.note || null,
      params: run.params || null,
      metric_name: metricName || null,
      metric_value: Number.isFinite(runValue) ? runValue : null,
    },
    baseline: baseline ? {
      id: baseline.id,
      metric_value: Number.isFinite(baselineValue) ? baselineValue : null,
    } : null,
    verdict,
    shared_cues: signals,
    rationale,
    next_step: nextStep,
  };

  if (doWrite) {
    const outDir = path.join(cwd, ".researchloop", "scratchpad", "paper-rereads");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${paperId}-against-${runId}.md`);
    fs.writeFileSync(outPath, `${note}\n`);
    console.log(`paper reread written to: ${outPath}`);
    return;
  }

  if (formatJson) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  process.stdout.write(`${note}\n`);
}
