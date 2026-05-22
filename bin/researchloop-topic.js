import fs from "node:fs";
import path from "node:path";
import { readPaperNotes, readRuns } from "./researchloop-research.js";
import { metricNumber } from "./researchloop-core.js";

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

function slugify(value, fallback = "note") {
  const out = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function extractSection(text, heading) {
  const lines = String(text ?? "").split("\n");
  const target = heading.trim().toLowerCase();
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

function sectionHasValue(section, key) {
  const re = new RegExp(`^\\s*-\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "mi");
  const match = String(section ?? "").match(re);
  return !!(match && match[1] && match[1].trim());
}

function extractValue(section, key) {
  const re = new RegExp(`^\\s*-\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "mi");
  const match = String(section ?? "").match(re);
  return match && match[1] ? match[1].trim() : "";
}

function parseBaseline(cwd) {
  const baselineFile = path.join(cwd, ".researchloop", "baseline.md");
  if (!fs.existsSync(baselineFile)) {
    return {
      state: "missing",
      metric: "",
      direction: "",
      command: "",
      artifact: "",
      missing: ["Baseline artifact", "Metric", "Direction", "Command or config", "Dataset", "Model size", "Seed"],
    };
  }

  const raw = readTextIfExists(baselineFile);
  const whatToRecord = extractSection(raw, "What To Record");
  const frozenSurfaces = extractSection(raw, "Frozen Surfaces");
  const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
  const requiredFrozen = ["Dataset", "Model size", "Seed"];
  const missing = [];

  for (const key of requiredWhatToRecord) {
    if (!sectionHasValue(whatToRecord, key)) missing.push(key);
  }
  for (const key of requiredFrozen) {
    if (!sectionHasValue(frozenSurfaces, key)) missing.push(key);
  }

  return {
    state: missing.length === 0 ? "complete" : "incomplete",
    metric: extractValue(whatToRecord, "Metric") || "",
    direction: extractValue(whatToRecord, "Direction") || "",
    command: extractValue(whatToRecord, "Command or config") || "",
    artifact: extractValue(whatToRecord, "Baseline artifact") || "",
    missing,
  };
}

function topicKeywords(topicText) {
  const lower = compressSpace(topicText).toLowerCase();
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "into",
    "that",
    "this",
    "then",
    "when",
    "what",
    "where",
    "how",
    "why",
    "like",
    "work",
    "workflows",
    "research",
    "topic",
    "mechanisms",
    "mechanism",
    "systems",
    "system",
    "model",
    "models",
    "architecture",
    "architectures",
  ]);
  const keep = [];
  for (const raw of lower.split(/[^a-z0-9]+/g)) {
    const term = raw.trim();
    if (!term) continue;
    if (stopwords.has(term)) continue;
    if (term.length >= 3 || ["lr", "llm", "gnn", "cnn", "rnn", "mlp", "attn"].includes(term)) {
      keep.push(term);
    }
  }
  if (lower.includes("learning rate")) keep.push("learning rate");
  if (lower.includes("validation loss")) keep.push("validation loss");
  if (lower.includes("attention")) keep.push("attention");
  if (lower.includes("optimizer")) keep.push("optimizer");
  return [...new Set(keep)];
}

function scoreText(text, terms) {
  const haystack = compressSpace(text).toLowerCase();
  const matches = [];
  for (const term of terms) {
    if (haystack.includes(term)) matches.push(term);
  }
  return {
    score: matches.length,
    matches,
  };
}

function paperSearchText(paper) {
  return [
    paper.id,
    paper.title,
    paper.claim,
    paper.mechanism,
    paper.abstract,
    paper.howToPort,
    paper.baselineRelevance,
    paper.published,
    Array.isArray(paper.authors) ? paper.authors.join(", ") : paper.authors,
  ].filter(Boolean).join(" ");
}

function runSearchText(run) {
  return [
    run.id,
    run.status,
    run.command,
    run.note,
    run.reason,
    JSON.stringify(run.params || {}),
    JSON.stringify(run.metrics || {}),
    run.value != null ? String(run.value) : "",
  ].filter(Boolean).join(" ");
}

function formatMetricValue(value) {
  if (value == null || value === "") return "unknown";
  const num = metricNumber(value);
  return Number.isFinite(num) ? String(num) : String(value);
}

function selectBestRun(runs, metric, direction) {
  const completed = runs.filter((row) => {
    if (!row || row.parse_error) return false;
    return /^(complete|completed|promoted|kept)$/i.test(String(row.status || ""));
  });
  const scored = completed.map((row, index) => {
    const metricValue = metric ? metricNumber(row.metrics && row.metrics[metric]) : Number.NaN;
    const fallbackValue = metricNumber(row.value);
    const chosenValue = Number.isFinite(metricValue)
      ? metricValue
      : Number.isFinite(fallbackValue)
        ? fallbackValue
        : null;
    return { row, index, metricValue: chosenValue };
  }).filter((item) => item.metricValue != null);

  if (!scored.length) {
    return completed.length ? completed[completed.length - 1] : null;
  }

  const sorted = scored.sort((a, b) => {
    if (a.metricValue !== b.metricValue) {
      return direction === "higher"
        ? b.metricValue - a.metricValue
        : a.metricValue - b.metricValue;
    }
    return a.index - b.index;
  });
  return sorted[0].row;
}

function summarizePapers(topicText, papers) {
  const terms = topicKeywords(topicText);
  return papers
    .map((paper) => {
      const { score, matches } = scoreText(paperSearchText(paper), terms);
      return {
        kind: "paper",
        id: paper.id || "paper",
        title: paper.title || paper.id || "paper note",
        score,
        matches,
        commands: paper.id
          ? [
              `autoresearch paper-read ${paper.id} --write`,
              `autoresearch hypothesis --paper-id ${paper.id} --write`,
            ]
          : [],
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3);
}

function summarizeRuns(topicText, runs) {
  const terms = topicKeywords(topicText);
  return runs
    .map((run) => {
      const { score, matches } = scoreText(runSearchText(run), terms);
      const metricValue = Number.isFinite(Number(run.value)) ? Number(run.value) : null;
      return {
        kind: "run",
        id: run.id || "run",
        title: run.note || run.command || `run ${run.id || ""}`.trim(),
        score,
        matches,
        metricValue,
        commands: run.id ? [`autoresearch hypothesis --run-id ${run.id} --write`] : [],
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3);
}

function renderEvidenceLine(item, baseline) {
  const matches = item.matches.length ? `matches: ${item.matches.join(", ")}` : "matches: none";
  if (item.kind === "paper") {
    return `- \`${item.kind}:${item.id}\` (score ${item.score}; ${matches}) - ${item.title}`;
  }
  const metricLabel = baseline.metric || "value";
  const metricValue = item.metricValue != null ? `${metricLabel}=${formatMetricValue(item.metricValue)}` : "value=unknown";
  return `- \`${item.kind}:${item.id}\` (score ${item.score}; ${matches}) - ${item.title} (${metricValue})`;
}

function renderNextSteps(relevantPapers, relevantRuns) {
  const lines = [];
  const seen = new Set();
  const push = (line) => {
    if (!line || seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };

  if (relevantPapers.length) {
    push(`autoresearch paper-read ${relevantPapers[0].id} --write`);
    push(`autoresearch hypothesis --paper-id ${relevantPapers[0].id} --write`);
  }
  if (relevantRuns.length) {
    push(`autoresearch hypothesis --run-id ${relevantRuns[0].id} --write`);
  }

  if (!lines.length) {
    lines.push("autoresearch paper-read <paper-id> --write");
    lines.push("autoresearch hypothesis --from-papers --write");
    lines.push("autoresearch hypothesis --from-runs --write");
  }

  return lines;
}

export function buildTopicNote({ cwd, topicText, mode }) {
  const baseline = parseBaseline(cwd);
  const runs = readRuns(cwd);
  const papers = readPaperNotes(cwd);
  const terms = topicKeywords(topicText);
  const relevantPapers = summarizePapers(topicText, papers);
  const relevantRuns = summarizeRuns(topicText, runs);
  const bestRun = selectBestRun(runs, baseline.metric, baseline.direction);
  const slug = slugify(topicText, "topic");
  const timestamp = new Date().toISOString().split("T")[0];

  const lines = [];
  lines.push(`# Topic: ${topicText}`);
  lines.push("");
  lines.push(`_Generated: ${timestamp} | Mode: ${mode}_`);
  lines.push("");
  lines.push("## Baseline State");
  lines.push(`- Status: **${baseline.state}**`);
  if (baseline.metric) lines.push(`- Metric: ${baseline.metric}`);
  if (baseline.direction) lines.push(`- Direction: ${baseline.direction}`);
  if (baseline.command) lines.push(`- Command or config: ${baseline.command}`);
  if (baseline.artifact) lines.push(`- Baseline artifact: ${baseline.artifact}`);
  lines.push(`- Prior runs: ${runs.length}`);
  if (bestRun) {
    const bestValueMetric = baseline.metric ? metricNumber(bestRun.metrics && bestRun.metrics[baseline.metric]) : Number.NaN;
    const bestValueFallback = metricNumber(bestRun.value);
    const bestValue = Number.isFinite(bestValueMetric)
      ? bestValueMetric
      : Number.isFinite(bestValueFallback)
        ? bestValueFallback
        : null;
    const bestLabel = baseline.metric && bestValue != null
      ? `${baseline.metric}=${formatMetricValue(bestValue)}`
      : bestValue != null
        ? `value=${formatMetricValue(bestValue)}`
        : "value=unknown";
    lines.push(`- Best run: ${bestRun.id} (${bestLabel})`);
  }
  if (baseline.state === "incomplete" && baseline.missing.length) {
    lines.push(`- Missing: ${baseline.missing.join(", ")}`);
  }
  lines.push("");

  if (baseline.state !== "complete") {
    lines.push(`**Action required:** Baseline is ${baseline.state}. Create or complete \`.researchloop/baseline.md\` before proceeding with experiments.`);
    lines.push("");
  }

  lines.push("## Relevant Evidence");
  if (relevantPapers.length) {
    lines.push("");
    lines.push("### Paper Notes");
    for (const item of relevantPapers) {
      lines.push(renderEvidenceLine(item, baseline));
      if (item.commands.length) {
        lines.push("  Follow-up:");
        for (const command of item.commands) {
          lines.push(`  - \`${command}\``);
        }
      }
    }
  }
  if (relevantRuns.length) {
    lines.push("");
    lines.push("### Runs");
    for (const item of relevantRuns) {
      lines.push(renderEvidenceLine(item, baseline));
      if (item.commands.length) {
        lines.push("  Follow-up:");
        for (const command of item.commands) {
          lines.push(`  - \`${command}\``);
        }
      }
    }
  }
  if (!relevantPapers.length && !relevantRuns.length) {
    lines.push("");
    lines.push("No matching paper notes or runs were found for this topic yet.");
  }
  lines.push("");

  lines.push("## Available Modes");
  lines.push("");
  lines.push("### propose (default)");
  lines.push("Read repo history and optionally search papers to propose 2-4 grounded next experiments.");
  lines.push("");
  lines.push("### novel");
  lines.push("Generate 3-5 genuinely different hypotheses with mechanism, why it might work, why it might fail, smallest test, and kill criterion.");
  lines.push("");
  lines.push("### autonomous");
  lines.push("Run the full loop (read history, search papers, write notes, choose cheapest meaningful test, run it, record it, compare it) within an agreed time budget. **Requires baseline lock.**");
  lines.push("");

  lines.push("**Needs approval:** do not run training, sweeps, or autonomous experiments until the user approves the plan.");
  lines.push("");

  lines.push("## Next Steps");
  lines.push("");
  lines.push("Choose a mode and run:");
  lines.push("");
  lines.push("```bash");
  for (const command of renderNextSteps(relevantPapers, relevantRuns)) {
    lines.push(command);
  }
  lines.push("```");
  lines.push("");

  lines.push("_Topic intake generated by AutoResearch-AI G28_");

  return {
    slug,
    baselineState: baseline.state,
    output: lines.join("\n"),
    terms,
  };
}
