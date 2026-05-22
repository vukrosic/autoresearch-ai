import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const packageJsonPath = path.join(packageRoot, "package.json");

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

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

function firstSentence(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : clean).trim();
}

function compressSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
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

export function readRuns(cwd) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) return [];
  const rows = [];
  for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // skip malformed rows
    }
  }
  return rows.filter(Boolean);
}

export function readPaperNotes(cwd) {
  const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
  if (!fs.existsSync(papersDir)) return [];
  return fs.readdirSync(papersDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const id = file.replace(/\.md$/, "");
      const text = readTextIfExists(path.join(papersDir, file));
      return { id, path: path.join(papersDir, file), text, ...parsePaperNoteMarkdown(text, id) };
    });
}

function parsePaperNoteMarkdown(text, fallbackId = "") {
  const title = (String(text ?? "").match(/^#\s+(.+)$/m) || [])[1] || fallbackId;
  const paperId = (String(text ?? "").match(/^Paper id:\s*(.+)$/mi) || [])[1] || fallbackId;
  const authors = (String(text ?? "").match(/^Authors:\s*(.+)$/mi) || [])[1] || "";
  const published = (String(text ?? "").match(/^Published:\s*(.+)$/mi) || [])[1] || "";
  const link = (String(text ?? "").match(/^Link:\s*(.+)$/mi) || [])[1] || "";
  const abstract = extractSection(text, "Abstract");
  const howToPort = extractSection(text, "How To Port This") || extractSection(text, "How to port this");
  const claim = extractSection(text, "Claim");
  const mechanism = extractSection(text, "Mechanism");
  const limits = extractSection(text, "Limits");
  const baselineRelevance = extractSection(text, "Baseline Relevance");
  return {
    id: paperId || fallbackId,
    title: title || paperId || fallbackId,
    authors: authors ? authors.split(",").map((s) => s.trim()).filter(Boolean) : [],
    published,
    link,
    abstract,
    howToPort,
    claim,
    mechanism,
    limits,
    baselineRelevance,
  };
}

function decodeXmlEntities(text) {
  return String(text ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractXmlTag(block, tag) {
  const match = String(block ?? "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function parseArxivEntries(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(String(xml ?? ""))) !== null) {
    const block = match[1];
    const idUrl = extractXmlTag(block, "id");
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
    const authors = (block.match(/<author>[\s\S]*?<\/author>/g) || [])
      .map((authorBlock) => extractXmlTag(authorBlock, "name"))
      .filter(Boolean);
    entries.push({
      arxivId,
      idUrl,
      title: extractXmlTag(block, "title"),
      summary: extractXmlTag(block, "summary"),
      published: extractXmlTag(block, "published"),
      updated: extractXmlTag(block, "updated"),
      authors,
    });
  }
  return entries;
}

async function fetchArxivEntryById({ paperId, cacheDir, offline }) {
  if (!paperId) throw new Error("missing paper id");
  const fixture = process.env.RESEARCHLOOP_ARXIV_FIXTURE;
  if (fixture) {
    const xml = fs.readFileSync(fixture, "utf8");
    if (cacheDir) {
      ensureDir(cacheDir);
      const key = createHash("sha1").update(`id:${paperId}`).digest("hex").slice(0, 16);
      const cacheFile = path.join(cacheDir, `${key}.xml`);
      if (!fs.existsSync(cacheFile)) {
        fs.writeFileSync(cacheFile, xml);
      }
    }
    const entry = parseArxivEntries(xml).find((row) => row.arxivId === paperId);
    if (!entry) throw new Error(`paper ${paperId} not found in fixture ${fixture}`);
    return entry;
  }

  ensureDir(cacheDir);
  const key = createHash("sha1").update(`id:${paperId}`).digest("hex").slice(0, 16);
  const cacheFile = path.join(cacheDir, `${key}.xml`);
  let xml = "";
  if (fs.existsSync(cacheFile)) {
    xml = fs.readFileSync(cacheFile, "utf8");
  } else {
    if (offline || process.env.RESEARCHLOOP_OFFLINE === "1") {
      throw new Error(`offline mode: no cached arXiv paper for ${paperId}`);
    }
    const params = new URLSearchParams({ id_list: paperId });
    const url = `https://export.arxiv.org/api/query?${params.toString()}`;
    const res = await fetch(url, {
      headers: { "User-Agent": `autoresearch-ai/${packageVersion()}` },
    });
    if (!res.ok) {
      throw new Error(`arxiv fetch failed: HTTP ${res.status}`);
    }
    xml = await res.text();
    fs.writeFileSync(cacheFile, xml);
  }
  const entry = parseArxivEntries(xml).find((row) => row.arxivId === paperId);
  if (!entry) {
    throw new Error(`paper ${paperId} not found in arxiv response`);
  }
  return entry;
}

function paperMechanismPattern(text) {
  const source = compressSpace(text).toLowerCase();
  const patterns = [
    { re: /\bsweep\b|\bgrid search\b|\brandom search\b|\blr search\b|\bparameter sweep\b/, mechanism: "hyperparameter sweep", phrase: "hyperparameter sweep" },
    { re: /\bwarmup\b|\bcosine\b|\bdecay\b|\bschedule\b/, mechanism: "learning-rate schedule", phrase: "learning-rate schedule" },
    { re: /\boptimizer\b|\badamw\b|\badam\b/, mechanism: "optimizer change", phrase: "optimizer change" },
    { re: /\bdropout\b|\bregulari[sz]ation\b|\bweight decay\b/, mechanism: "regularization", phrase: "regularization" },
    { re: /\battention\b|\bsparse\b|\bsparsity\b/, mechanism: "attention design", phrase: "attention design" },
    { re: /\bdata augmentation\b|\baugmentation\b|\bcurriculum\b/, mechanism: "data curriculum", phrase: "data curriculum" },
    { re: /\bquanti[sz]ation\b|\bprun(e|ing)\b/, mechanism: "compression", phrase: "compression" },
    { re: /\bgradient clipping\b|\bclip(ping)?\b/, mechanism: "gradient clipping", phrase: "gradient clipping" },
    { re: /\bnormali[sz]ation\b|\bnorm\b/, mechanism: "normalization", phrase: "normalization" },
    { re: /\bretrieval\b|\bmemory\b/, mechanism: "retrieval augmentation", phrase: "retrieval augmentation" },
    { re: /\bbatch\b|\bbatching\b/, mechanism: "batch dynamics", phrase: "batch dynamics" },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(source)) return pattern;
  }
  return { mechanism: "paper-port", phrase: "paper port" };
}

function uniqueHints(text) {
  const out = [];
  const re = /`([^`]+)`|\b([A-Za-z0-9_.\/-]+\.(?:py|yaml|yml|json|toml|md|sh|js|mjs|ts|tsx|ipynb))\b/g;
  let match;
  while ((match = re.exec(String(text ?? ""))) !== null) {
    const hint = (match[1] || match[2] || "").trim();
    if (hint && !out.includes(hint)) out.push(hint);
  }
  return out.slice(0, 5);
}

function describeGoalContext(goal) {
  const bits = [];
  if (goal.metric) bits.push(`target metric ${goal.metric}`);
  if (goal.direction) bits.push(`direction ${goal.direction}`);
  if (goal.baselineCommand) bits.push(`baseline command ${goal.baselineCommand}`);
  return bits.length ? bits.join(" · ") : "no goal is documented yet";
}

function inferPaperClaim(paper) {
  const abstract = compressSpace(paper.abstract || "");
  const first = firstSentence(abstract);
  if (first) return first;
  if (paper.title) return `${paper.title} proposes ${paper.title.toLowerCase()}`;
  return `Paper ${paper.id || "unknown"} needs a read-through before the claim is clear.`;
}

function inferPaperMechanism(paper) {
  const pattern = paperMechanismPattern(`${paper.title || ""} ${paper.abstract || ""}`);
  const source = paper.abstract || paper.title || paper.id || "";
  const claim = firstSentence(source) || paper.title || paper.id || "the paper";
  if (pattern.mechanism === "paper-port") {
    return `The paper's mechanism is not explicit in the note yet; port it by reading the smallest change surface in the abstract and the local baseline.`;
  }
  return `The mechanism looks like ${pattern.phrase}: the paper pushes ${claim.toLowerCase()}.`;
}

function inferPaperLimits(paper) {
  const abstract = compressSpace(paper.abstract || "");
  const lower = abstract.toLowerCase();
  const cues = [];
  if (/small|few|limited|narrow|specific|toy/.test(lower)) cues.push("The evidence looks narrow and may depend on the same model/data scale.");
  if (/future work|open question|leave for future/.test(lower)) cues.push("The note itself leaves part of the story unresolved.");
  if (/transformer|language model|vision|diffusion|graph/.test(lower)) cues.push("Transfer may depend on whether the local repo matches the same architecture family.");
  if (!cues.length) cues.push("The main risk is transfer: the effect may disappear if the local repo's data, architecture, or optimization stack differs from the paper.");
  return cues.join(" ");
}

function inferPaperPorting(paper, goal, noteHints = []) {
  const hints = uniqueHints(paper.howToPort || `${paper.title || ""} ${paper.abstract || ""}`);
  const ports = [];
  if (noteHints.length) ports.push(`The note already points at ${noteHints.map((hint) => `\`${hint}\``).join(", ")}.`);
  if (hints.length) ports.push(`The likely implementation surface includes ${hints.map((hint) => `\`${hint}\``).join(", ")}.`);
  if (goal.baselineCommand) ports.push(`Start from the baseline command: \`${goal.baselineCommand}\`, change only one knob, and compare the target metric.`);
  else if (goal.metric) ports.push(`Start from the smallest command or config path that drives ${goal.metric}, then compare against the current ledger.`);
  else ports.push("Start from the smallest change in the training or eval entrypoint, then compare the recorded metric against the current ledger.");
  ports.push(`Keep the first test short: one baseline run, one candidate run, and a direct metric comparison.`);
  return ports.join(" ");
}

function inferBaselineRelevance(goal, runs, paper) {
  const bits = [];
  if (goal.metric) {
    bits.push(`The current target metric is ${goal.metric}${goal.direction ? ` (${goal.direction})` : ""}.`);
  } else {
    bits.push("No metric is locked yet, so the paper should be turned into a baseline note before it becomes a real experiment.");
  }
  if (runs.length) {
    const latest = [...runs].reverse().find((row) => row && !row.parse_error) || null;
    const best = runs.find((row) => row && !row.parse_error && row.metrics && goal.metric && Number.isFinite(Number(row.metrics[goal.metric])));
    if (latest) bits.push(`The latest run in the ledger is ${latest.id || "unknown"}; use it to calibrate how far this paper drifts from current practice.`);
    if (best) bits.push(`The current ledger already has a comparable run (${best.id || "unknown"}); use it as the immediate comparison point.`);
  } else {
    bits.push("There are no recorded runs yet, so the paper is still a pre-baseline idea rather than a judged experiment.");
  }
  if (paper.id) {
    bits.push(`Paper ${paper.id} should be read against the baseline, not in isolation.`);
  }
  return bits.join(" ");
}

function buildPaperReadMarkdown({ paper, goal, runs, sourceMode }) {
  const claim = inferPaperClaim(paper);
  const mechanism = inferPaperMechanism(paper);
  const limits = inferPaperLimits(paper);
  const howToPort = inferPaperPorting(paper, goal, uniqueHints(paper.howToPort));
  const baselineRelevance = inferBaselineRelevance(goal, runs, paper);
  const title = paper.title || paper.id || "paper";
  const authors = paper.authors && paper.authors.length ? paper.authors.join(", ") : "unknown";
  const published = paper.published ? paper.published.slice(0, 10) : "unknown";
  const link = paper.link || paper.idUrl || "";
  return [
    `# ${title}`,
    "",
    `- Paper id: ${paper.id || "unknown"}`,
    `- Source: ${sourceMode}`,
    `- Published: ${published}`,
    `- Authors: ${authors}`,
    link ? `- Link: ${link}` : null,
    `- Read at: ${new Date().toISOString()}`,
    "",
    "## Claim",
    "",
    claim,
    "",
    "## Mechanism",
    "",
    mechanism,
    "",
    "## Limits",
    "",
    limits,
    "",
    "## How To Port This",
    "",
    howToPort,
    "",
    "## Baseline Relevance",
    "",
    baselineRelevance,
    "",
  ].filter(Boolean).join("\n");
}

function choosePaperSource(cwd) {
  const notes = readPaperNotes(cwd);
  if (!notes.length) return null;
  return notes[0];
}

function chooseHypothesisMechanism({ sourceMode, paper, run, goal, runs, novel }) {
  const used = new Set();
  for (const row of runs) {
    if (row?.params && typeof row.params === "object") {
      if (row.params._mechanism) used.add(String(row.params._mechanism));
      if (row.params.mechanism) used.add(String(row.params.mechanism));
    }
    if (row?.hypothesis?.mechanism) used.add(String(row.hypothesis.mechanism));
  }

  const mechanismBlacklist = new Set([
    "hyperparameter sweep",
    "lr search",
    "learning rate search",
    "grid search",
    "random search",
    "parameter sweep",
    "sweep",
  ]);

  const runMechanismHints = new Map([
    ["lr", "learning-rate schedule"],
    ["learning_rate", "learning-rate schedule"],
    ["dropout", "regularization"],
    ["weight_decay", "regularization"],
    ["batch_size", "batch dynamics"],
    ["optimizer", "optimizer change"],
    ["warmup", "learning-rate schedule"],
    ["clip", "gradient clipping"],
    ["clip_norm", "gradient clipping"],
    ["epochs", "training budget"],
  ]);

  if (sourceMode === "paper" && paper) {
    const pattern = paperMechanismPattern(`${paper.mechanism || ""} ${paper.title || ""} ${paper.abstract || ""} ${paper.howToPort || ""}`);
    const phrase = pattern.phrase || "paper port";
    if (novel && mechanismBlacklist.has(phrase)) return { rejected: "sweep-like mechanism" };
    return {
      mechanism: phrase,
      title: paper.title ? `${paper.title} port hypothesis` : `Port ${paper.id || "paper"}`,
      evidenceSource: `paper:${paper.id || "unknown"}`,
      sourceSummary: paper.title || paper.id || "paper",
    };
  }

  if (sourceMode === "run" && run) {
    const params = run.params || {};
    const entries = Object.entries(params);
    let mechanism = "run-based adjustment";
    let title = `Explain why ${run.id || "this run"} moved the metric`;
    for (const [key, value] of entries) {
      const keyText = String(key).toLowerCase();
      for (const [needle, mapped] of runMechanismHints.entries()) {
        if (keyText.includes(needle)) {
          mechanism = mapped;
          title = `${mapped} hypothesis`;
          break;
        }
      }
      if (mechanism !== "run-based adjustment") break;
      if (keyText === "mechanism" && value) {
        mechanism = String(value);
        title = `${mechanism} hypothesis`;
        break;
      }
    }
    if (novel && mechanismBlacklist.has(mechanism.toLowerCase())) return { rejected: "sweep-like mechanism" };
    return {
      mechanism,
      title,
      evidenceSource: `run:${run.id || "unknown"}`,
      sourceSummary: run.id || "run",
    };
  }

  const candidateMechanisms = [
    { mechanism: "representation bottleneck", title: "Representation bottleneck hypothesis" },
    { mechanism: "attention sparsity", title: "Attention sparsity hypothesis" },
    { mechanism: "loss shaping", title: "Loss shaping hypothesis" },
    { mechanism: "input normalization", title: "Input normalization hypothesis" },
    { mechanism: "optimizer preconditioning", title: "Optimizer preconditioning hypothesis" },
    { mechanism: "layerwise learning-rate decay", title: "Layerwise learning-rate decay hypothesis" },
    { mechanism: "retrieval augmentation", title: "Retrieval augmentation hypothesis" },
    { mechanism: "curriculum pacing", title: "Curriculum pacing hypothesis" },
  ];
  for (const candidate of candidateMechanisms) {
    if (mechanismBlacklist.has(candidate.mechanism.toLowerCase())) continue;
    if (used.has(candidate.mechanism)) continue;
    return { ...candidate, evidenceSource: "null", sourceSummary: "novel" };
  }
  return null;
}

function buildHypothesisMarkdown({
  title,
  mechanism,
  whyItWins,
  whyItFails,
  smallestTest,
  expectedMovement,
  killCriterion,
  implementationSurface,
  evidenceSource,
  sourceSummary,
  goal,
}) {
  return [
    `# Hypothesis: ${title}`,
    "",
    `- Mode: ${sourceSummary}`,
    `- Evidence source: ${evidenceSource}`,
    `- Created at: ${new Date().toISOString()}`,
    "",
    "## Mechanism",
    "",
    mechanism,
    "",
    "## Why This Beats Baseline",
    "",
    whyItWins,
    "",
    "## Why This Might Fail",
    "",
    whyItFails,
    "",
    "## Smallest Test",
    "",
    smallestTest,
    "",
    "## Expected Metric Movement",
    "",
    expectedMovement,
    "",
    "## Kill Criterion",
    "",
    killCriterion,
    "",
    "## Implementation Surface (Files / Configs)",
    "",
    implementationSurface,
    "",
    "## Evidence Source",
    "",
    evidenceSource,
    "",
    goal?.metric || goal?.direction ? `- Goal context: ${describeGoalContext(goal)}` : null,
    "",
  ].filter(Boolean).join("\n");
}

function sameId(left, right) {
  return normalizeId(left) === normalizeId(right);
}

function findPaperNoteById(papers, paperId) {
  if (!paperId) return null;
  return papers.find((paper) => sameId(paper.id, paperId)) || null;
}

function findRunById(runs, runId) {
  if (!runId) return null;
  return runs.find((row) => row && !row.parse_error && sameId(row.id, runId)) || null;
}

function selectHypothesisSeed({ papers, runs, fromPapers, fromRuns, paperId, runId }) {
  if (paperId) return findPaperNoteById(papers, paperId);
  if (runId) return findRunById(runs, runId);
  if (fromPapers) {
    const candidates = papers.filter((paper) => paper && (paper.claim || paper.abstract || paper.howToPort));
    return candidates[0] || null;
  }
  if (fromRuns) {
    const scored = runs.filter((row) => row && !row.parse_error && /^(complete|completed|promoted|kept)$/i.test(String(row.status || "")) && row.metrics && Object.keys(row.metrics).length > 0);
    return scored[scored.length - 1] || runs.find((row) => row && !row.parse_error && row.metrics && Object.keys(row.metrics).length > 0) || null;
  }
  return papers[0] || runs[runs.length - 1] || null;
}

function inferHypothesisSections({ goal, sourceMode, paper, run, runs, novel }) {
  const goalMetric = goal.metric || "the target metric";
  const direction = goal.direction || "move in the right direction";
  let mechanismInfo = chooseHypothesisMechanism({ sourceMode, paper, run, goal, runs: runs || [], novel });
  if (!mechanismInfo) {
    return null;
  }
  if (mechanismInfo.rejected) {
    return mechanismInfo;
  }
  const mechanism = mechanismInfo.mechanism;
  const title = mechanismInfo.title;
  const whyItWins = sourceMode === "paper"
    ? `If the paper's mechanism transfers, it should improve ${goalMetric} because it changes the causal path the baseline currently uses.`
    : sourceMode === "run"
      ? `The ledger already shows the run family moving ${goalMetric}; this hypothesis isolates the likely mechanism instead of treating the improvement as accidental.`
      : `This is a new causal surface rather than a parameter-only tweak, so it has a shot at moving ${goalMetric} without just repeating the same knobs.`;
  const whyItFails = sourceMode === "paper"
    ? `It may be paper-specific: the effect could depend on a different architecture, data scale, or training regime than this repo uses.`
    : sourceMode === "run"
      ? `The run may have improved for unrelated reasons, so the same effect might disappear under a controlled rerun.`
      : `Novel mechanisms are risky; if the repo's current bottleneck is elsewhere, this idea will not move ${goalMetric}.`;
  const smallestTest = sourceMode === "paper"
    ? `Change one config or training knob that corresponds to ${mechanism}, then run the current baseline once and compare ${goalMetric}.`
    : sourceMode === "run"
      ? `Replay the smallest version of ${run.id || "the run"} with only the suspected mechanism changed, then compare ${goalMetric}.`
      : `Make the smallest change that actually exercises ${mechanism}, then run one baseline-sized comparison against the current ledger.`;
  const expectedMovement = goal.direction
    ? `Expect ${goalMetric} to move ${direction} if the mechanism is real.`
    : `Expect ${goalMetric} to move in the direction the baseline defines.`;
  const killCriterion = `Kill it if ${goalMetric} fails to move ${goal.direction || "away from baseline"} after one or two small runs, or if the result regresses beyond the baseline noise band.`;
  const implementationSurface = sourceMode === "paper"
    ? `Likely files/configs: ${uniqueHints((paper && (paper.howToPort || paper.abstract || paper.title)) || "").map((hint) => `\`${hint}\``).join(", ") || "the smallest training or eval config surface"}.`
    : sourceMode === "run"
      ? `Likely files/configs: the command and config surface implied by run ${run.id || "unknown"}; start with the smallest file that changes ${mechanism}.`
      : `Likely files/configs: the smallest training entrypoint or config file that controls ${mechanism}.`;
  return {
    title,
    mechanism,
    whyItWins,
    whyItFails,
    smallestTest,
    expectedMovement,
    killCriterion,
    implementationSurface,
    evidenceSource: mechanismInfo.evidenceSource,
    sourceSummary: mechanismInfo.sourceSummary,
  };
}

export async function cmdPaperRead(ctx) {
  const { option, hasFlag, positionalText, targetDir } = ctx;
  const cwd = targetDir();
  const sourceMode = String(option("--from", "local")).toLowerCase();
  const cacheDirOpt = option("--cache-dir", null);
  const cacheDir = cacheDirOpt && typeof cacheDirOpt === "string"
    ? cacheDirOpt
    : path.join(os.homedir(), ".cache", "autoresearch-ai", "arxiv");
  const doWrite = hasFlag("--write");
  const offline = hasFlag("--offline");
  const paperId = normalizeId(option("--paper-id", option("--id", positionalText())) || "");

  if (!paperId) {
    console.error("Usage: autoresearch paper-read <paper-id> [--from arxiv|local] [--cache-dir PATH] [--write] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
  ensureDir(papersDir);

  let paper = null;
  const localPath = path.join(papersDir, `${paperId}.md`);
  const localText = readTextIfExists(localPath);
  if (localText && sourceMode !== "arxiv") {
    paper = parsePaperNoteMarkdown(localText, paperId);
    paper.id = paper.id || paperId;
    paper.path = localPath;
  } else {
    try {
      const entry = await fetchArxivEntryById({ paperId, cacheDir, offline });
      paper = {
        id: entry.arxivId || paperId,
        title: entry.title,
        authors: entry.authors,
        published: entry.published,
        link: entry.idUrl,
        abstract: entry.summary,
        howToPort: "",
      };
    } catch (err) {
      if (localText) {
        paper = parsePaperNoteMarkdown(localText, paperId);
        paper.id = paper.id || paperId;
        paper.path = localPath;
      } else {
        console.error(`paper-read failed: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }
  }

  const goal = extractGoalContext(cwd);
  const runs = readRuns(cwd);
  const rendered = buildPaperReadMarkdown({ paper, goal, runs, sourceMode: sourceMode === "local" ? "local" : "arxiv" });
  if (doWrite) {
    fs.writeFileSync(localPath, `${rendered}\n`);
    console.log(`paper note written to: ${localPath}`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

export function cmdHypothesis(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const fromPapers = hasFlag("--from-papers");
  const fromRuns = hasFlag("--from-runs");
  const novel = hasFlag("--novel");
  const doWrite = hasFlag("--write");
  const paperIdOpt = String(option("--paper-id", "") || "").trim();
  const runIdOpt = String(option("--run-id", "") || "").trim();

  const goal = extractGoalContext(cwd);
  const runs = readRuns(cwd);
  const papers = readPaperNotes(cwd);
  let sourceMode = "novel";
  if (paperIdOpt && runIdOpt) {
    console.error("hypothesis: pass only one of --paper-id or --run-id");
    process.exitCode = 1;
    return;
  }
  if (paperIdOpt) sourceMode = "paper";
  else if (runIdOpt) sourceMode = "run";
  else if (fromPapers) sourceMode = "paper";
  else if (fromRuns) sourceMode = "run";
  else if (!novel) {
    if (papers.length) sourceMode = "paper";
    else if (runs.length) sourceMode = "run";
  }

  const seed = selectHypothesisSeed({
    papers,
    runs,
    fromPapers,
    fromRuns,
    paperId: paperIdOpt,
    runId: runIdOpt,
  });

  if (sourceMode === "paper" && !seed) {
    console.error(paperIdOpt
      ? `hypothesis: no paper note found for ${paperIdOpt}`
      : "hypothesis: --from-papers needs at least one paper note in .researchloop/scratchpad/papers/");
    process.exitCode = 1;
    return;
  }
  if (sourceMode === "run" && !seed) {
    console.error(runIdOpt
      ? `hypothesis: no run found for ${runIdOpt}`
      : "hypothesis: --from-runs needs at least one recorded run in .researchloop/scratchpad/runs.jsonl");
    process.exitCode = 1;
    return;
  }

  if (fromPapers && !papers.length) {
    console.error("hypothesis: --from-papers needs at least one paper note in .researchloop/scratchpad/papers/");
    process.exitCode = 1;
    return;
  }
  if (fromRuns && !runs.length) {
    console.error("hypothesis: --from-runs needs at least one recorded run in .researchloop/scratchpad/runs.jsonl");
    process.exitCode = 1;
    return;
  }

  const choice = inferHypothesisSections({
    goal,
    sourceMode,
    paper: sourceMode === "paper" ? seed : null,
    run: sourceMode === "run" ? seed : null,
    runs,
    novel,
  });

  if (!choice) {
    console.error("hypothesis: could not derive a non-sweep mechanism from the available evidence");
    process.exitCode = 1;
    return;
  }
  if (choice.rejected) {
    console.error(`hypothesis: --novel rejected a ${choice.rejected}`);
    process.exitCode = 1;
    return;
  }

  const text = buildHypothesisMarkdown({
    title: choice.title,
    mechanism: choice.mechanism,
    whyItWins: choice.whyItWins,
    whyItFails: choice.whyItFails,
    smallestTest: choice.smallestTest,
    expectedMovement: choice.expectedMovement,
    killCriterion: choice.killCriterion,
    implementationSurface: choice.implementationSurface,
    evidenceSource: choice.evidenceSource,
    sourceSummary: choice.sourceSummary,
    goal,
  });

  if (novel) {
    const lowered = choice.mechanism.toLowerCase();
    const blacklisted = [
      "hyperparameter sweep",
      "lr search",
      "learning rate search",
      "grid search",
      "random search",
      "parameter sweep",
      "sweep",
    ];
    if (blacklisted.some((needle) => lowered.includes(needle))) {
      console.error("hypothesis: --novel rejected a sweep-like mechanism");
      process.exitCode = 1;
      return;
    }
  }

  if (doWrite) {
    const hypDir = path.join(cwd, ".researchloop", "scratchpad", "hypotheses");
    ensureDir(hypDir);
    const slug = slugify(`${choice.mechanism}-${choice.evidenceSource}`, "hypothesis");
    const outPath = path.join(hypDir, `${slug}.md`);
    fs.writeFileSync(outPath, `${text}\n`);
    console.log(`hypothesis written to: ${outPath}`);
  } else {
    process.stdout.write(`${text}\n`);
  }
}
