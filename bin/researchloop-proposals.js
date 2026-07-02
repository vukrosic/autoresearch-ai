import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { attachPriorsToProposal } from "./researchloop-priors.js";
import { readPaperNotes, readRuns } from "./researchloop-research.js";
import { metricNumber } from "./researchloop-core.js";

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

function parseMarkdownSection(text, heading) {
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

function readMarkdownNotes(cwd, subdir) {
  const dir = path.join(cwd, ".researchloop", "scratchpad", subdir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const id = file.replace(/\.md$/, "");
      const text = readTextIfExists(path.join(dir, file));
      return { id, path: path.join(dir, file), text };
    });
}

function loadRepoProfile(cwd) {
  const file = path.join(cwd, ".researchloop", "repo-profile.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(readTextIfExists(file));
  } catch {
    return null;
  }
}

function readGoalContext(cwd) {
  const goalText = readTextIfExists(path.join(cwd, ".researchloop", "goal.md"));
  const baselineText = readTextIfExists(path.join(cwd, ".researchloop", "baseline.md"));
  const targetText = goalText || baselineText;
  const baselineFile = path.join(cwd, ".researchloop", "baseline.md");
  const baselineState = !baselineText
    ? "missing"
    : (() => {
        const whatToRecord = extractSection(baselineText, "What To Record");
        const frozenSurfaces = extractSection(baselineText, "Frozen Surfaces");
        const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
        const requiredFrozen = ["Dataset", "Model size", "Seed"];
        const missing = [];
        for (const key of requiredWhatToRecord) {
          if (!parseKeyValueSection(whatToRecord, key)) missing.push(key);
        }
        for (const key of requiredFrozen) {
          if (!parseKeyValueSection(frozenSurfaces, key)) missing.push(key);
        }
        return missing.length === 0 ? "complete" : "incomplete";
      })();
  const whatToRecord = extractSection(targetText, "What To Record") || targetText;
  const frozenSurfaces = extractSection(targetText, "Frozen Surfaces") || targetText;
  return {
    baselineState,
    baselineFile,
    metric: extractFieldValue(whatToRecord, "Metric", "Target Metric") || extractFieldValue(targetText, "Target Metric") || "",
    direction: extractFieldValue(whatToRecord, "Direction") || extractFieldValue(targetText, "Direction") || "",
    baselineCommand: extractFieldValue(whatToRecord, "Command or config", "Baseline Command") || extractFieldValue(targetText, "Baseline Command") || "",
    baselineArtifact: extractFieldValue(whatToRecord, "Baseline artifact", "Baseline artifact") || extractFieldValue(targetText, "Baseline artifact") || "",
    dataset: extractFieldValue(frozenSurfaces, "Dataset") || extractFieldValue(targetText, "Dataset") || "",
    modelSize: extractFieldValue(frozenSurfaces, "Model size") || extractFieldValue(targetText, "Model size") || "",
    seed: extractFieldValue(frozenSurfaces, "Seed") || extractFieldValue(targetText, "Seed") || "",
  };
}

function walkFiles(cwd, maxDepth = 3) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === ".researchloop" ||
        entry.name === "node_modules" ||
        entry.name === "__pycache__"
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      const rel = path.relative(cwd, full);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else {
        out.push(rel);
      }
    }
  }
  walk(cwd, 0);
  return out;
}

function mechanismFromText(text) {
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
    { re: /\brepresentation\b|\bbottleneck\b/, mechanism: "representation bottleneck", phrase: "representation bottleneck" },
    { re: /\bloss\b|\bobjective\b|\breward\b/, mechanism: "loss shaping", phrase: "loss shaping" },
    { re: /\barchitecture\b|\blayer\b|\bwidth\b|\bdepth\b/, mechanism: "architecture change", phrase: "architecture change" },
  ];
  for (const pattern of patterns) {
    if (pattern.re.test(source)) return pattern;
  }
  return { mechanism: "paper-port", phrase: "paper port" };
}

function stableId(payload) {
  return `prop_${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12)}`;
}

function normalizeForMatch(text) {
  return compressSpace(text).toLowerCase();
}

function focusMatches(text, focus) {
  if (!focus || focus === "all") return true;
  const needle = normalizeForMatch(focus);
  const haystack = normalizeForMatch(text);
  if (haystack.includes(needle)) return true;
  const synonymMap = {
    hyperparameters: ["lr", "learning rate", "batch", "optimizer", "warmup", "weight decay"],
    architecture: ["layer", "depth", "width", "attention", "embedding", "residual"],
    attention: ["attention", "heads", "sparsity", "routing"],
    data: ["data", "dataset", "curriculum", "augmentation", "retrieval"],
  };
  const synonyms = synonymMap[needle] || [];
  return synonyms.some((term) => haystack.includes(term));
}

function extractMechanismFromHypothesis(text) {
  const mechanism = extractSection(text, "Mechanism");
  if (mechanism) return mechanism.split("\n")[0].trim();
  return "";
}

function extractEvidenceRefs(text) {
  const refs = [];
  for (const match of String(text ?? "").matchAll(/\b(paper|run):([A-Za-z0-9._-]+)\b/g)) {
    refs.push({ type: match[1], id: match[2] });
  }
  return refs;
}

function chooseRepoFile(cwd, repoProfile, mechanism, focus) {
  const candidates = [];
  const push = (value) => {
    if (value && !candidates.includes(value) && fs.existsSync(path.join(cwd, value))) {
      candidates.push(value);
    }
  };

  const profileFiles = [
    ...(repoProfile?.candidate_train_files || []),
    ...(repoProfile?.candidate_eval_files || []),
    ...(repoProfile?.candidate_config_files || []),
  ];
  for (const file of profileFiles) push(file);

  const allFiles = walkFiles(cwd, 3);
  for (const file of allFiles) {
    if (/(\btrain\b|\bmain\b|\bmodel\b|\bconfig\b|\beval\b|\bdata\b)/i.test(file)) {
      push(file);
    }
  }

  const normalizedMechanism = normalizeForMatch(mechanism);
  const normalizedFocus = normalizeForMatch(focus);
  const ranking = [
    (file) => /train\.(py|sh|js|mjs|ts|tsx)$/i.test(file) ? 5 : 0,
    (file) => /config\.(ya?ml|json|toml|py|js|ts)$/i.test(file) ? 4 : 0,
    (file) => /model|layer|attention|optimizer|schedule|data/i.test(file) ? 3 : 0,
    (file) => normalizedMechanism && normalizeForMatch(file).includes(normalizedMechanism) ? 6 : 0,
    (file) => normalizedFocus && normalizeForMatch(file).includes(normalizedFocus) ? 4 : 0,
  ];

  if (!candidates.length) return "goal.md";
  return candidates
    .map((file) => ({ file, score: ranking.reduce((sum, fn) => sum + fn(file), 0) }))
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))[0].file;
}

function parseHypothesisNotes(cwd) {
  return readMarkdownNotes(cwd, "hypotheses").map((note) => {
    const mechanism = extractMechanismFromHypothesis(note.text) || mechanismFromText(note.text).phrase;
    const evidenceSource = parseKeyValueSection(extractSection(note.text, "Evidence Source"), "Evidence Source")
      || extractSection(note.text, "Evidence Source")
      || "";
    const smallestTest = extractSection(note.text, "Smallest Test");
    const implementationSurface = extractSection(note.text, "Implementation Surface (Files / Configs)");
    const killCriterion = extractSection(note.text, "Kill Criterion");
    const whyWins = extractSection(note.text, "Why This Beats Baseline");
    const whyFails = extractSection(note.text, "Why This Might Fail");
    return {
      id: note.id,
      title: (note.text.match(/^#\s+Hypothesis:\s+(.+)$/m) || [])[1] || note.id,
      mechanism,
      evidenceSource,
      smallestTest,
      implementationSurface,
      killCriterion,
      whyWins,
      whyFails,
      refs: extractEvidenceRefs(note.text),
    };
  });
}

function parseTopicNotes(cwd) {
  return readMarkdownNotes(cwd, "topics").map((note) => {
    const relevantRefs = extractEvidenceRefs(note.text);
    const nextSteps = extractSection(note.text, "Next Steps");
    return {
      id: note.id,
      title: (note.text.match(/^#\s+Topic:\s+(.+)$/m) || [])[1] || note.id,
      refs: relevantRefs,
      nextSteps,
    };
  });
}

function bestRunByMetric(runs, metric, direction) {
  const parsed = runs
    .filter((run) => run && !run.parse_error)
    .map((run, index) => {
      const metricValue = metric ? metricNumber(run.metrics && run.metrics[metric]) : Number.NaN;
      const fallbackValue = metricNumber(run.value);
      const chosenValue = Number.isFinite(metricValue)
        ? metricValue
        : Number.isFinite(fallbackValue)
          ? fallbackValue
          : null;
      return { run, index, metricValue: chosenValue };
    })
    .filter((item) => item.metricValue != null);
  if (!parsed.length) return null;
  parsed.sort((a, b) => {
    if (a.metricValue !== b.metricValue) {
      return direction === "higher"
        ? b.metricValue - a.metricValue
        : a.metricValue - b.metricValue;
    }
    return a.index - b.index;
  });
  return parsed[0].run;
}

function usedMechanismsFromEvidence(runs, papers, hypotheses) {
  const used = new Set();
  for (const run of runs) {
    if (run?.params && typeof run.params === "object") {
      if (run.params._mechanism) used.add(String(run.params._mechanism));
      if (run.params.mechanism) used.add(String(run.params.mechanism));
    }
    if (run?.hypothesis?.mechanism) used.add(String(run.hypothesis.mechanism));
  }
  for (const paper of papers) {
    if (paper?.mechanism) used.add(String(paper.mechanism));
  }
  for (const hyp of hypotheses) {
    if (hyp?.mechanism) used.add(String(hyp.mechanism));
  }
  return used;
}

function buildPaperProposal(paper, ctx) {
  const { metric, direction, focus, cwd, repoProfile, bestRun } = ctx;
  const mech = paper.mechanism || mechanismFromText(`${paper.title || ""} ${paper.claim || ""} ${paper.howToPort || ""}`).phrase;
  const fileRef = chooseRepoFile(cwd, repoProfile, mech, focus);
  const claim = paper.claim || paper.baselineRelevance || paper.abstract || paper.title || paper.id;
  const risk = /small|few|limited|narrow|specific|toy/i.test(`${paper.abstract || ""} ${paper.claim || ""}`) ? "low" : "med";
  const priors = paper.id ? [{ type: "paper", id: paper.id }] : [];
  if (bestRun?.id) priors.push({ type: "run", id: bestRun.id });
  const change = `Edit \`${fileRef}\` to test ${mech}; keep the baseline command frozen and change only one knob.`;
  const hypothesis = `If ${paper.title || paper.id} transfers, ${metric} should move ${direction || "in the baseline direction"} because ${claim}.`;
  return {
    title: `${paper.title || paper.id || "paper"} port`,
    hypothesis,
    change,
    metric,
    expected_direction: direction || "lower",
    estimated_minutes: risk === "low" ? 45 : 90,
    est_cost_usd_or_null: null,
    risk,
    priors,
    kill_criterion: `${metric} does not move meaningfully after one baseline-sized run, or the result falls inside the baseline noise band.`,
    mechanism: mech,
  };
}

function parseEvidenceSourceRefs(sourceText) {
  const refs = extractEvidenceRefs(sourceText);
  if (refs.length) return refs;
  return [];
}

function buildHypothesisProposal(note, ctx) {
  const { metric, direction, focus, cwd, repoProfile, bestRun } = ctx;
  const mech = note.mechanism || mechanismFromText(`${note.title || ""} ${note.smallestTest || ""} ${note.implementationSurface || ""}`).phrase;
  const fileRef = chooseRepoFile(cwd, repoProfile, mech, focus);
  const priors = parseEvidenceSourceRefs(note.evidenceSource);
  if (!priors.length && bestRun?.id) priors.push({ type: "run", id: bestRun.id });
  const change = note.implementationSurface
    ? note.implementationSurface
    : `Edit \`${fileRef}\` to exercise ${mech} with the smallest possible change.`;
  return {
    title: note.title || `${mech} hypothesis`,
    hypothesis: note.whyWins || `This mechanism should improve ${metric || "the target metric"}.`,
    change,
    metric,
    expected_direction: direction || "lower",
    estimated_minutes: note.smallestTest ? 60 : 90,
    est_cost_usd_or_null: null,
    risk: /novel|new|risky/i.test(`${note.title || ""} ${note.whyFails || ""}`) ? "med" : "low",
    priors,
    kill_criterion: note.killCriterion || `${metric || "the target metric"} does not improve after one small validation run.`,
    mechanism: mech,
  };
}

function buildRunProposal(run, ctx) {
  const { metric, direction, focus, cwd, repoProfile } = ctx;
  const params = run.params || {};
  const mech = String(
    params._mechanism ||
    params.mechanism ||
    params.optimizer ||
    params.lr ||
    params.learning_rate ||
    ""
  ).trim() || mechanismFromText(JSON.stringify(params)).phrase;
  const fileRef = chooseRepoFile(cwd, repoProfile, mech, focus);
  const priors = run.id ? [{ type: "run", id: run.id }] : [];
  return {
    title: run.note || run.command || `${mech} from run ${run.id || "unknown"}`,
    hypothesis: `The ledger suggests ${metric || "the target metric"} moved under run ${run.id || "unknown"}; isolate ${mech} instead of copying the whole recipe.`,
    change: `Change \`${fileRef}\` to isolate ${mech} from run ${run.id || "unknown"} and rerun a single baseline-sized check.`,
    metric,
    expected_direction: direction || "lower",
    estimated_minutes: 60,
    est_cost_usd_or_null: null,
    risk: "med",
    priors,
    kill_criterion: `${metric || "the target metric"} does not improve when ${mech} is isolated from run ${run.id || "unknown"}.`,
    mechanism: mech,
  };
}

function genericTemplates(ctx) {
  const { metric, direction, focus, cwd, repoProfile } = ctx;
  const fileRef = chooseRepoFile(cwd, repoProfile, focus, focus);
  return [
    {
      title: "Learning rate warmup",
      hypothesis: "Warmup prevents early gradient instability and is cheap to test.",
      change: `Edit \`${fileRef}\` to add a short warmup schedule and keep the rest frozen.`,
      mechanism: "learning-rate schedule",
      risk: "low",
      estimated_minutes: 30,
    },
    {
      title: "AdamW instead of Adam",
      hypothesis: "Decoupled weight decay may improve regularization with a very small change.",
      change: `Edit \`${fileRef}\` to swap Adam for AdamW and leave the baseline otherwise unchanged.`,
      mechanism: "optimizer change",
      risk: "low",
      estimated_minutes: 30,
    },
    {
      title: "Add gradient clipping",
      hypothesis: "Gradient clipping may stabilize training without changing the model itself.",
      change: `Edit \`${fileRef}\` to set a max gradient norm and rerun once.`,
      mechanism: "gradient clipping",
      risk: "low",
      estimated_minutes: 30,
    },
    {
      title: "Dropout regularization",
      hypothesis: "A small dropout change may reduce overfitting on the current baseline.",
      change: `Edit \`${fileRef}\` to add a small dropout value and compare the target metric.`,
      mechanism: "regularization",
      risk: "low",
      estimated_minutes: 30,
    },
    {
      title: "Batch size reduction",
      hypothesis: "A smaller batch may move the metric if the current run is too smooth.",
      change: `Edit \`${fileRef}\` to reduce batch size once and keep everything else fixed.`,
      mechanism: "batch dynamics",
      risk: "med",
      estimated_minutes: 45,
    },
    {
      title: "Attention sparsity",
      hypothesis: "If attention is the bottleneck, a sparse routing change may help.",
      change: `Edit \`${fileRef}\` to try a minimal attention routing change and rerun the baseline.`,
      mechanism: "attention design",
      risk: "med",
      estimated_minutes: 60,
    },
    {
      title: "Data curriculum",
      hypothesis: "Ordering the data differently may move the target metric without a model change.",
      change: `Edit \`${fileRef}\` to add a simple curriculum or ordering rule for the data.`,
      mechanism: "data curriculum",
      risk: "med",
      estimated_minutes: 60,
    },
    {
      title: "Retrieval augmentation",
      hypothesis: "If the baseline lacks context, a tiny retrieval layer may improve the metric.",
      change: `Edit \`${fileRef}\` to add a retrieval hook or memory path and rerun once.`,
      mechanism: "retrieval augmentation",
      risk: "high",
      estimated_minutes: 90,
    },
  ].map((template) => ({
    ...template,
    metric,
    expected_direction: direction || "lower",
    est_cost_usd_or_null: null,
    priors: [],
    kill_criterion: `${metric || "the target metric"} does not improve after one baseline-sized run.`,
  }));
}

function buildProposalObject(base, ctx, sourceType, sourceId, extras = {}) {
  const proposal = {
    title: base.title,
    hypothesis: base.hypothesis,
    change: base.change,
    metric: base.metric || ctx.metric,
    expected_direction: base.expected_direction || ctx.direction || "lower",
    estimated_minutes: base.estimated_minutes ?? 60,
    est_cost_usd_or_null: base.est_cost_usd_or_null ?? null,
    risk: base.risk || "med",
    priors: Array.isArray(base.priors) ? base.priors : [],
    kill_criterion: base.kill_criterion || `${ctx.metric || "the target metric"} does not improve.`,
    mechanism: base.mechanism || "",
    mode: ctx.mode,
    created_at: new Date().toISOString(),
    source_type: sourceType,
    source_id: sourceId,
    ...extras,
  };
  proposal.id = stableId({
    title: proposal.title,
    hypothesis: proposal.hypothesis,
    change: proposal.change,
    metric: proposal.metric,
    expected_direction: proposal.expected_direction,
    estimated_minutes: proposal.estimated_minutes,
    est_cost_usd_or_null: proposal.est_cost_usd_or_null,
    risk: proposal.risk,
    priors: proposal.priors,
    kill_criterion: proposal.kill_criterion,
    mechanism: proposal.mechanism,
    mode: proposal.mode,
    source_type: proposal.source_type,
    source_id: proposal.source_id,
  });
  return proposal;
}

function proposalPassesFocus(proposal, focus) {
  if (!focus || focus === "all") return true;
  return focusMatches([proposal.title, proposal.hypothesis, proposal.change, proposal.mechanism].join(" "), focus);
}

function isSweepLike(mechanism) {
  const lowered = String(mechanism || "").toLowerCase();
  return [
    "hyperparameter sweep",
    "lr search",
    "learning rate search",
    "grid search",
    "random search",
    "parameter sweep",
    "sweep",
  ].some((needle) => lowered.includes(needle));
}

function mergePriorRefs(existing, fresh) {
  const out = [];
  const seen = new Set();
  for (const prior of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(fresh) ? fresh : [])]) {
    if (!prior || typeof prior !== "object") continue;
    const id = String(prior.id || "").trim();
    if (!id) continue;
    const type = String(prior.type || "paper").trim() || "paper";
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...prior, type, id });
  }
  return out;
}

function writeJsonlRows(file, rows) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function attachPriorEvidence({ cwd, proposals, limit, offline, cacheDir }) {
  const enriched = [];
  const summary = { attached: 0, missed: 0, errors: 0, notesWritten: 0 };
  for (const proposal of proposals) {
    try {
      const result = await attachPriorsToProposal({
        cwd,
        proposal,
        limit,
        offline,
        cacheDir,
        packageName: "autoresearch-ai",
      });
      enriched.push(result.proposal);
      if (result.freshPriors.length) {
        summary.attached += 1;
        summary.notesWritten += result.notesWritten.length;
      } else {
        summary.missed += 1;
      }
    } catch (err) {
      summary.errors += 1;
      console.error(`propose priors: ${proposal.id}: ${err.message}`);
      enriched.push({ ...proposal, prior_error: err.message });
    }
  }
  return { proposals: enriched, summary };
}

export async function cmdPropose(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const n = Math.max(1, parseInt(option("--n", "5"), 10) || 5);
  const doWrite = hasFlag("--write");
  const withPriors = hasFlag("--with-priors");
  const priorLimitRaw = Number(option("--prior-limit", "3"));
  const priorLimit = Number.isFinite(priorLimitRaw) && priorLimitRaw > 0 ? Math.min(20, Math.floor(priorLimitRaw)) : 3;
  const offline = hasFlag("--offline");
  const cacheDirOpt = option("--cache-dir", null);
  const cacheDir = cacheDirOpt && typeof cacheDirOpt === "string"
    ? cacheDirOpt
    : path.join(process.env.HOME || ".", ".cache", "autoresearch-ai", "arxiv");
  const mode = String(option("--mode", "propose")).toLowerCase();
  const focus = String(option("--focus", "all")).toLowerCase();
  const metricOpt = option("--metric", null);
  const directionOpt = option("--direction", null);
  const goal = readGoalContext(cwd);
  const repoProfile = loadRepoProfile(cwd);
  const runs = readRuns(cwd);
  const papers = readPaperNotes(cwd);
  const hypotheses = parseHypothesisNotes(cwd);
  const targetMetric = String(metricOpt || goal.metric || "val_loss").trim() || "val_loss";
  const targetDirection = String(directionOpt || goal.direction || "lower").trim().toLowerCase() || "lower";
  const bestRun = bestRunByMetric(runs, targetMetric, targetDirection);
  const usedMechanisms = usedMechanismsFromEvidence(runs, papers, hypotheses);

  const context = {
    cwd,
    repoProfile,
    metric: targetMetric,
    direction: targetDirection,
    focus,
    mode,
    bestRun,
    goal,
  };

  let candidates = [];

  for (const paper of papers) {
    const mechanism = paper.mechanism || mechanismFromText(`${paper.title || ""} ${paper.claim || ""} ${paper.howToPort || ""}`).phrase;
    if (mode === "novel" && isSweepLike(mechanism)) continue;
    if (focus !== "all" && !focusMatches(`${paper.title || ""} ${paper.claim || ""} ${paper.mechanism || ""}`, focus)) continue;
    candidates.push(buildProposalObject(buildPaperProposal(paper, context), context, "paper", paper.id, { source_refs: [{ type: "paper", id: paper.id }] }));
  }

  for (const note of hypotheses) {
    const mechanism = note.mechanism || mechanismFromText(`${note.title || ""} ${note.smallestTest || ""}`).phrase;
    if (mode === "novel" && isSweepLike(mechanism)) continue;
    if (focus !== "all" && !proposalPassesFocus({ title: note.title, hypothesis: note.whyWins, change: note.smallestTest, mechanism }, focus)) continue;
    const proposal = buildProposalObject(buildHypothesisProposal(note, context), context, "hypothesis", note.id, { source_refs: note.refs });
    candidates.push(proposal);
  }

  const runCandidates = [...runs]
    .filter((run) => run && !run.parse_error && (run.status || "").match(/^(complete|completed|promoted|kept)$/i))
    .map((run, index) => {
      const metricValue = targetMetric ? metricNumber(run.metrics && run.metrics[targetMetric]) : Number.NaN;
      const fallbackValue = metricNumber(run.value);
      const chosenValue = Number.isFinite(metricValue)
        ? metricValue
        : Number.isFinite(fallbackValue)
          ? fallbackValue
          : null;
      return { run, index, metricValue: chosenValue };
    })
    .filter((item) => item.metricValue != null)
    .sort((a, b) => {
      if (a.metricValue !== b.metricValue) {
        return targetDirection === "higher"
          ? b.metricValue - a.metricValue
          : a.metricValue - b.metricValue;
      }
      return a.index - b.index;
    })
    .slice(0, 3)
    .map((item) => item.run);
  for (const run of runCandidates) {
    const mechanism = String(run?.params?._mechanism || run?.params?.mechanism || "").trim() || mechanismFromText(JSON.stringify(run.params || {})).phrase;
    if (mode === "novel" && isSweepLike(mechanism)) continue;
    if (focus !== "all" && !proposalPassesFocus({ title: run.note || run.id, hypothesis: run.note || "", change: JSON.stringify(run.params || {}), mechanism }, focus)) continue;
    candidates.push(buildProposalObject(buildRunProposal(run, context), context, "run", run.id, { source_refs: run.id ? [{ type: "run", id: run.id }] : [] }));
  }

  for (const template of genericTemplates(context)) {
    if (mode === "novel" && isSweepLike(template.mechanism)) continue;
    if (mode === "novel" && (!template.mechanism || !template.kill_criterion)) continue;
    if (mode === "novel" && usedMechanisms.has(template.mechanism)) continue;
    if (focus !== "all" && !proposalPassesFocus(template, focus)) continue;
    candidates.push(buildProposalObject(template, context, "generic", template.mechanism || template.title));
  }

  if (mode === "novel") {
    candidates = candidates.filter((proposal) => proposal.mechanism && proposal.kill_criterion && !isSweepLike(proposal.mechanism));
  }

  const deduped = [];
  const seen = new Set();
  for (const proposal of candidates) {
    const key = proposal.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(proposal);
  }

  const sorted = deduped.sort((a, b) => {
    const typeRank = { paper: 0, hypothesis: 1, run: 2, generic: 3 };
    const at = typeRank[a.source_type] ?? 9;
    const bt = typeRank[b.source_type] ?? 9;
    if (at !== bt) return at - bt;
    if (a.estimated_minutes !== b.estimated_minutes) return a.estimated_minutes - b.estimated_minutes;
    return a.id.localeCompare(b.id);
  });

  let proposals = sorted.slice(0, n).map((proposal) => {
    delete proposal.source_refs;
    return proposal;
  });

  // Auto mechanism dedup — in `--mode novel`, surface proposals whose
  // mechanism string overlaps with an already-tried mechanism (substring
  // match against runs / hypothesis notes via `usedMechanisms`). We flag,
  // we don't drop — the agent decides whether the overlap is real
  // duplication or just shared vocabulary.
  if (mode === "novel" && Array.isArray(usedMechanisms) && usedMechanisms.length > 0) {
    const normalize = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const used = usedMechanisms.map(normalize).filter(Boolean);
    for (const p of proposals) {
      const candidate = normalize(p.mechanism);
      if (!candidate) continue;
      const overlap = used.find((u) => u && (u.includes(candidate) || candidate.includes(u)));
      if (overlap) {
        p.mechanism_duplicate_of = overlap.slice(0, 120);
      }
    }
    const dupes = proposals.filter((p) => p.mechanism_duplicate_of);
    if (dupes.length > 0) {
      console.error(`mechanism dedup: ${dupes.length} of ${proposals.length} proposals overlap with an existing mechanism — see proposal.mechanism_duplicate_of`);
      for (const d of dupes.slice(0, 3)) {
        console.error(`  ${d.id}  "${String(d.mechanism).slice(0, 60)}" ~ "${d.mechanism_duplicate_of.slice(0, 60)}"`);
      }
    }
  }

  let priorSummary = null;

  if (withPriors) {
    const result = await attachPriorEvidence({ cwd, proposals, limit: priorLimit, offline, cacheDir });
    proposals = result.proposals;
    priorSummary = result.summary;
  }

  if (doWrite) {
    const proposalsPath = path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl");
    ensureDir(path.dirname(proposalsPath));
    if (withPriors) {
      const existingRows = [];
      const indexById = new Map();
      if (fs.existsSync(proposalsPath)) {
        for (const line of readTextIfExists(proposalsPath).split("\n")) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            if (row?.id && !indexById.has(row.id)) indexById.set(row.id, existingRows.length);
            existingRows.push(row);
          } catch {
            // ignore malformed rows
          }
        }
      }
      let added = 0;
      let updated = 0;
      for (const proposal of proposals) {
        const existingIndex = indexById.get(proposal.id);
        if (existingIndex == null) {
          indexById.set(proposal.id, existingRows.length);
          existingRows.push(proposal);
          added += 1;
          continue;
        }
        const existing = existingRows[existingIndex];
        existingRows[existingIndex] = {
          ...existing,
          ...proposal,
          created_at: existing.created_at || proposal.created_at,
          priors: mergePriorRefs(existing.priors, proposal.priors),
        };
        updated += 1;
      }
      writeJsonlRows(proposalsPath, existingRows);
      console.log(`Wrote ${added} new proposal(s) to ${proposalsPath}`);
      console.log(`Updated ${updated} proposal(s) with prior-art evidence`);
    } else {
      const existingIds = new Set();
      if (fs.existsSync(proposalsPath)) {
        for (const line of readTextIfExists(proposalsPath).split("\n")) {
          if (!line.trim()) continue;
          try {
            existingIds.add(JSON.parse(line).id);
          } catch {
            // ignore malformed rows
          }
        }
      }
      const newRows = proposals.filter((proposal) => !existingIds.has(proposal.id));
      if (newRows.length) {
        fs.appendFileSync(proposalsPath, `${newRows.map((proposal) => JSON.stringify(proposal)).join("\n")}\n`);
      }
      console.log(`Wrote ${newRows.length} new proposal(s) to ${proposalsPath}`);
    }
    if (priorSummary) {
      console.log(`Priors: attached=${priorSummary.attached} missed=${priorSummary.missed} errors=${priorSummary.errors} notes_written=${priorSummary.notesWritten}`);
    }
  } else {
    process.stdout.write(`${JSON.stringify(proposals, null, 2)}\n`);
  }
}
