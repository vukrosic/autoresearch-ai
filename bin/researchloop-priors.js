import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

function readTextIfExists(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function compressSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(text) {
  return compressSpace(text).toLowerCase();
}

function firstSentence(text) {
  const clean = compressSpace(text);
  if (!clean) return "";
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match ? match[1] : clean).trim();
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

const ARXIV_API_URL = "http://export.arxiv.org/api/query";

function packageRootFromMeta() {
  return path.resolve(new URL(".", import.meta.url).pathname, "..");
}

function packageVersion() {
  try {
    const pkg = JSON.parse(readTextIfExists(path.join(packageRootFromMeta(), "package.json")));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

function arxivCacheDir(packageName, cwd) {
  return path.join(os.homedir(), ".cache", packageName || "autoresearch-ai", "arxiv");
}

function arxivCacheKey(query, limit, since) {
  return createHash("sha1")
    .update(`${query}|${limit}|${since || ""}`)
    .digest("hex")
    .slice(0, 16);
}

async function fetchArxivXml({ query, limit, since, cacheDir, offline, packageName }) {
  const fixture = process.env.RESEARCHLOOP_ARXIV_FIXTURE;
  if (fixture) {
    return fs.readFileSync(fixture, "utf8");
  }
  ensureDir(cacheDir);
  const key = arxivCacheKey(query, limit, since);
  const cacheFile = path.join(cacheDir, `${key}.xml`);
  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile, "utf8");
  }
  if (offline) {
    throw new Error(`offline mode: no cache for query "${query}" (key=${key})`);
  }
  const params = new URLSearchParams({
    search_query: query,
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(limit),
  });
  const url = `${ARXIV_API_URL}?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": `${packageName || "autoresearch-ai"}/${packageVersion()}` } });
  if (!res.ok) {
    throw new Error(`arxiv fetch failed: HTTP ${res.status}`);
  }
  const xml = await res.text();
  fs.writeFileSync(cacheFile, xml);
  return xml;
}

function cleanTokens(text) {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "into",
    "into",
    "your",
    "their",
    "our",
    "are",
    "was",
    "were",
    "will",
    "can",
    "could",
    "should",
    "would",
    "also",
    "very",
    "when",
    "then",
    "than",
    "what",
    "why",
    "how",
    "one",
    "two",
    "three",
    "small",
    "smallest",
    "test",
    "change",
    "run",
    "baseline",
    "proposal",
    "proposals",
    "paper",
    "papers",
    "hypothesis",
    "metric",
    "lower",
    "higher",
    "target",
    "current",
    "edit",
    "keep",
    "rerun",
  ]);
  const tokens = [];
  for (const raw of normalizeText(text).split(/[^a-z0-9]+/g)) {
    if (!raw || raw.length < 4 || stopwords.has(raw)) continue;
    if (!tokens.includes(raw)) tokens.push(raw);
  }
  return tokens;
}

function proposalSearchQuery(proposal) {
  const tokens = cleanTokens([
    proposal?.title,
    proposal?.hypothesis,
    proposal?.change,
    proposal?.mechanism,
  ].join(" "));
  if (!tokens.length) return "all:deep learning";
  return `all:${tokens.slice(0, 6).join(" ")}`;
}

function proposalSearchText(proposal) {
  return normalizeText([
    proposal?.title,
    proposal?.hypothesis,
    proposal?.change,
    proposal?.mechanism,
    proposal?.metric,
    proposal?.expected_direction,
  ].join(" "));
}

function scoreEntryForProposal(entry, proposalText) {
  const text = normalizeText(`${entry.title || ""} ${entry.summary || ""}`);
  const tokens = cleanTokens(proposalText);
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (text.includes(token)) {
      score += token.length >= 7 ? 2 : 1;
    }
  }
  if (proposalText.includes("warmup") && text.includes("warmup")) score += 4;
  if (proposalText.includes("schedule") && text.includes("schedule")) score += 2;
  if (proposalText.includes("learning rate") && text.includes("learning rate")) score += 2;
  if (proposalText.includes("attention") && text.includes("attention")) score += 2;
  if (proposalText.includes("dropout") && text.includes("dropout")) score += 2;
  if (proposalText.includes("optimizer") && text.includes("optimizer")) score += 2;
  if (proposalText.includes("data") && text.includes("data")) score += 1;
  return score;
}

function selectPriorEntries(entries, proposalText, limit) {
  return [...entries]
    .map((entry, index) => ({ entry, index, score: scoreEntryForProposal(entry, proposalText) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}

function paperMechanismPattern(text) {
  const source = normalizeText(text);
  const patterns = [
    { re: /\bwarmup\b|\bcosine\b|\bdecay\b|\bschedule\b/, mechanism: "learning-rate schedule", phrase: "learning-rate schedule" },
    { re: /\battention\b|\bsparse\b|\bsparsity\b/, mechanism: "attention design", phrase: "attention design" },
    { re: /\boptimizer\b|\badamw\b|\badam\b/, mechanism: "optimizer change", phrase: "optimizer change" },
    { re: /\bdropout\b|\bregulari[sz]ation\b|\bweight decay\b/, mechanism: "regularization", phrase: "regularization" },
    { re: /\bdata augmentation\b|\baugmentation\b|\bcurriculum\b/, mechanism: "data curriculum", phrase: "data curriculum" },
    { re: /\bgradient clipping\b|\bclip(ping)?\b/, mechanism: "gradient clipping", phrase: "gradient clipping" },
    { re: /\bnormali[sz]ation\b|\bnorm\b/, mechanism: "normalization", phrase: "normalization" },
    { re: /\bretrieval\b|\bmemory\b/, mechanism: "retrieval augmentation", phrase: "retrieval augmentation" },
    { re: /\bbatch\b|\bbatching\b/, mechanism: "batch dynamics", phrase: "batch dynamics" },
    { re: /\bprun(e|ing)\b|\bquanti[sz]ation\b/, mechanism: "compression", phrase: "compression" },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(source)) return pattern;
  }
  return { mechanism: "paper-port", phrase: "paper port" };
}

function buildPaperNote(entry, proposal, goal) {
  const mechanism = paperMechanismPattern(`${entry.title || ""} ${entry.summary || ""}`).phrase;
  const claim = entry.summary || firstSentence(entry.summary) || entry.title || entry.arxivId;
  const limits = [
    "The evidence is strongest in the paper's own setting.",
    "Transfer may weaken if the local repo's architecture, data, or optimizer differs from the paper's regime.",
  ].join(" ");
  const howToPort = [
    `Start from the smallest change surface that controls ${mechanism}.`,
    proposal?.change ? `The proposal points at: ${proposal.change}.` : null,
    proposal?.metric ? `Compare against ${proposal.metric} and keep the baseline otherwise frozen.` : null,
  ].filter(Boolean).join(" ");
  const baselineRelevance = [
    `The current target metric is ${goal.metric || "unknown"}${goal.direction ? ` (${goal.direction})` : ""}.`,
    "Treat the paper as a candidate prior, not as proof that the local repo will move the same way.",
  ].join(" ");
  return [
    `# ${entry.title || entry.arxivId}`,
    "",
    `- Paper id: ${entry.arxivId || "unknown"}`,
    `- Source: arxiv`,
    `- Published: ${entry.published ? entry.published.slice(0, 10) : "unknown"}`,
    `- Authors: ${Array.isArray(entry.authors) && entry.authors.length ? entry.authors.join(", ") : "unknown"}`,
    entry.idUrl ? `- Link: ${entry.idUrl}` : null,
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

function readProposalRows(file) {
  const text = readTextIfExists(file);
  if (!text.trim()) return [];
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function writeProposalRows(file, rows) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function mergePriors(existing, fresh) {
  const merged = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(fresh) ? fresh : [])]) {
    if (!item || typeof item !== "object") continue;
    const key = `${String(item.type || "paper")}:${String(item.id || "")}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function readGoalContext(cwd) {
  const goalText = readTextIfExists(path.join(cwd, ".researchloop", "goal.md"));
  const baselineText = readTextIfExists(path.join(cwd, ".researchloop", "baseline.md"));
  const targetText = goalText || baselineText;
  const extractField = (key, heading = key) => {
    const section = extractSection(targetText, heading) || targetText;
    const match = String(section).match(new RegExp(`^\\s*-\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "mi"));
    return match && match[1] ? match[1].trim() : "";
  };
  return {
    metric: extractField("Target Metric") || extractField("Metric") || "val_loss",
    direction: normalizeText(extractField("Direction")) || "lower",
  };
}

function findProposalSource(cwd, proposalId, inputPath) {
  const candidates = [];
  if (inputPath) candidates.push(path.join(cwd, inputPath));
  candidates.push(path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl"));
  candidates.push(path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.jsonl"));
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const rows = readProposalRows(file);
    const index = rows.findIndex((row) => String(row.id) === String(proposalId));
    if (index !== -1) {
      return { file, rows, index };
    }
  }
  return null;
}

function normalizePriorRef(prior) {
  if (!prior || typeof prior !== "object") return null;
  const id = String(prior.id || "").trim();
  if (!id) return null;
  return {
    type: prior.type || "paper",
    id,
    title: prior.title || "",
    link: prior.link || "",
  };
}

function uniqueProposalText(row) {
  return proposalSearchText(row);
}

export async function attachPriorsToProposal({
  cwd,
  proposal,
  limit = 5,
  offline = false,
  cacheDir = path.join(os.homedir(), ".cache", "autoresearch-ai", "arxiv"),
  packageName = "autoresearch-ai",
  goal = null,
}) {
  const goalContext = goal || readGoalContext(cwd);
  const proposalText = uniqueProposalText(proposal);
  const query = proposalSearchQuery(proposal);
  const xml = await fetchArxivXml({ query, limit, since: null, cacheDir, offline, packageName });
  const entries = parseArxivEntries(xml);
  const selected = selectPriorEntries(entries, proposalText, limit);
  if (!selected.length) {
    return {
      proposal: { ...proposal },
      query,
      selected: [],
      freshPriors: [],
      notesWritten: [],
    };
  }

  const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
  ensureDir(papersDir);

  const freshPriors = [];
  const notesWritten = [];
  for (const entry of selected) {
    const safeId = String(entry.arxivId || entry.idUrl || entry.title || "paper").replace(/[/\\]/g, "_");
    const notePath = path.join(papersDir, `${safeId}.md`);
    if (!fs.existsSync(notePath)) {
      const note = buildPaperNote(entry, proposal, goalContext);
      fs.writeFileSync(notePath, `${note}\n`);
      notesWritten.push(path.relative(cwd, notePath));
    }
    freshPriors.push(normalizePriorRef({
      type: "paper",
      id: entry.arxivId,
      title: entry.title,
      link: entry.idUrl,
    }));
  }

  const filteredPriors = freshPriors.filter(Boolean);
  return {
    proposal: {
      ...proposal,
      priors: mergePriors(proposal.priors, filteredPriors),
    },
    query,
    selected,
    freshPriors: filteredPriors,
    notesWritten,
  };
}

export async function cmdPriors(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const proposalId = String(option("--proposal", "") || "").trim();
  const inputPath = String(option("--input", "") || "").trim();
  const limitRaw = Number(option("--limit", "5"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(20, Math.floor(limitRaw)) : 5;
  const offline = hasFlag("--offline");
  const cacheDirOpt = option("--cache-dir", null);
  const cacheDir = cacheDirOpt && typeof cacheDirOpt === "string"
    ? cacheDirOpt
    : path.join(os.homedir(), ".cache", "autoresearch-ai", "arxiv");

  if (!proposalId) {
    console.error("Usage: autoresearch priors --proposal <id> [--limit 5] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const source = findProposalSource(cwd, proposalId, inputPath);
  if (!source) {
    console.error(`priors: proposal ${proposalId} not found`);
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await attachPriorsToProposal({
      cwd,
      proposal: source.rows[source.index],
      limit,
      offline,
      cacheDir,
      packageName: "autoresearch-ai",
    });
  } catch (err) {
    console.error(`priors failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!result.selected.length) {
    console.error("priors: no prior-art candidates matched the proposal");
    process.exitCode = 1;
    return;
  }

  source.rows[source.index] = result.proposal;
  writeProposalRows(source.file, source.rows);

  console.log(`priors attached to: ${proposalId}`);
  console.log(`proposal file updated: ${path.relative(cwd, source.file)}`);
  for (const prior of result.freshPriors) {
    if (!prior) continue;
    const entry = result.selected.find((item) => item.arxivId === prior.id);
    const abstract = compressSpace(entry?.summary || "");
    const snippet = abstract.length > 120 ? `${abstract.slice(0, 117)}...` : abstract;
    console.log(`- ${prior.id} ${prior.title || "unknown"} | ${snippet}`);
  }
  if (result.notesWritten.length) {
    console.log(`paper notes written to: ${result.notesWritten.join(", ")}`);
  }
}
