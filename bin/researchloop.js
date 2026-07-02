#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildRunDiff, buildRunLineage, buildRunTraces, readCurvesForRun, summarizeTraces } from "./researchloop-dashboard.js";
import { cmdDeterminism } from "./researchloop-determinism.js";
import { cmdHypothesis, cmdPaperRead } from "./researchloop-research.js";
import { cmdPaperReread } from "./researchloop-paper-reread.js";
import { buildTopicNote } from "./researchloop-topic.js";
import { cmdPower } from "./researchloop-power.js";
import { cmdSimilar } from "./researchloop-similar.js";
import { cmdLearn } from "./researchloop-learn.js";
import { cmdArchive } from "./researchloop-archive.js";
import { cmdForecast } from "./researchloop-forecast.js";
import { cmdPareto } from "./researchloop-pareto.js";
import { cmdAblate } from "./researchloop-ablate.js";
import { cmdCompute } from "./researchloop-compute.js";
import { cmdMechanisms } from "./researchloop-mechanisms.js";
import { cmdDiskCheck } from "./researchloop-disk.js";
import { cmdLeaderboard } from "./researchloop-leaderboard.js";
import { cmdBibtex } from "./researchloop-bibtex.js";
import { cmdSeed } from "./researchloop-seed.js";
import { cmdPrBundle } from "./researchloop-pr-bundle.js";
import { cmdAgentMemory } from "./researchloop-agent-memory.js";
import { cmdStory } from "./researchloop-story.js";
import { cmdSmoke } from "./researchloop-smoke.js";
import { cmdShare } from "./researchloop-share.js";
import { cmdPropose as cmdProposeEngine } from "./researchloop-proposals.js";
import { cmdRank as cmdRankEngine } from "./researchloop-rank.js";
import { cmdPriors as cmdPriorsEngine } from "./researchloop-priors.js";
import { cmdNextExperiment } from "./researchloop-next-experiment.js";
import { cmdEval as cmdEvalEngine, loadEvalSpec, runDeclaredEval, mergeEvalResultIntoRow } from "./researchloop-eval.js";
import { metricNumber } from "./researchloop-core.js";
import { cmdBench } from "./researchloop-bench.js";
import { cmdSlurm } from "./researchloop-slurm.js";
import { cmdRetrospective } from "./researchloop-retrospective.js";
import { cmdLitDiff } from "./researchloop-lit-diff.js";
import { cmdBudget } from "./researchloop-budget.js";
import { cmdFork } from "./researchloop-fork.js";
import { cmdValidateConfig } from "./researchloop-validate-config.js";
import { cmdEta } from "./researchloop-eta.js";
import { cmdSummary } from "./researchloop-summary.js";
import { cmdHardware } from "./researchloop-hardware.js";
import { cmdHooks } from "./researchloop-hooks.js";
import { cmdDataSample } from "./researchloop-data-sample.js";
import { cmdCanary } from "./researchloop-canary.js";
import { cmdStaleLocks } from "./researchloop-stale-locks.js";
import { cmdReset } from "./researchloop-reset.js";
import { cmdQuestion } from "./researchloop-question.js";
import { cmdSearch } from "./researchloop-search.js";
import { cmdTail } from "./researchloop-tail.js";
import { cmdTasks } from "./researchloop-tasks.js";
import { cmdContainerSnapshot } from "./researchloop-container.js";
import { cmdWarmstart } from "./researchloop-warmstart.js";
import { cmdGpuReport } from "./researchloop-gpu-report.js";
import { cmdGpuFit, analyzeVram } from "./researchloop-gpu-fit.js";
import { cmdEvalDiff } from "./researchloop-eval-diff.js";
import { cmdScalingFit } from "./researchloop-scaling-fit.js";
import { cmdSampleEfficiency } from "./researchloop-sample-efficiency.js";
import { cmdRlStats } from "./researchloop-rl-stats.js";
import { cmdSweepProjection } from "./researchloop-sweep-projection.js";
import { cmdHeadroom } from "./researchloop-headroom.js";
import { cmdMfu, computeMfuForRow } from "./researchloop-mfu.js";
import { cmdKvCache } from "./researchloop-kv-cache.js";
import { cmdLrFinder } from "./researchloop-lr-finder.js";
import { cmdOverfitWatch, analyzeOverfit } from "./researchloop-overfit-watch.js";
import { cmdShardPlan } from "./researchloop-shard-plan.js";
import { cmdElo } from "./researchloop-elo.js";
import { cmdApiBudget } from "./researchloop-api-budget.js";
import { cmdJudge } from "./researchloop-judge.js";
import { cmdGradNoise } from "./researchloop-grad-noise.js";
import { cmdMemorization } from "./researchloop-memorization.js";

const __filename = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(__filename), "..");
const templatesRoot = path.join(packageRoot, "templates");
const packageName = "autoresearch-ai";

function packageVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("-")) || "help";
const systemMetricsCache = {
  macGpu: { ts: 0, data: null },
  diskByCwd: new Map(),
  envByCwd: new Map(),
};

const METRIC_TIER_LEVELS = [
  { key: "level1", label: "一级指标", weight: 5, maxSelect: 3 },
  { key: "level2", label: "二级指标", weight: 3, maxSelect: 3 },
  { key: "level3", label: "三级指标", weight: 2, maxSelect: 4 },
];

const METRIC_DIRECTION_DEFAULTS = {
  p95_latency: "lower",
  p50_latency: "lower",
  p99_latency: "lower",
  latency_ms: "lower",
  mean_ms: "lower",
  min_ms: "lower",
  max_ms: "lower",
  ttft: "lower",
  tpot: "lower",
  cost_per_request: "lower",
  cost_per_token: "lower",
  cost_per_step: "lower",
  gpu_memory: "lower",
  memory_footprint: "lower",
  cache_miss_rate: "lower",
  branch_divergence: "lower",
  kernel_time: "lower",
  launch_overhead: "lower",
  queue_wait_time: "lower",
  communication_overhead: "lower",
  data_loading_time: "lower",
  checkpoint_time: "lower",
  error_rate: "lower",
  timeout_rate: "lower",
  energy_per_run: "lower",
  throughput: "higher",
  tokens_per_sec: "higher",
  samples_per_sec: "higher",
  tflops: "higher",
  speedup: "higher",
  memory_bandwidth: "higher",
  io_bandwidth: "higher",
  network_bandwidth: "higher",
  gpu_util: "higher",
  cpu_util: "higher",
  mfu: "higher",
  scaling_efficiency: "higher",
  cache_hit_rate: "higher",
  occupancy: "higher",
  warp_efficiency: "higher",
  kv_cache_usage: "higher",
  loss_stability: "higher",
  gradient_norm: "higher",
};

const METRIC_TIER_PROFILES = {
  model_inference: {
    label: "模型推理服务",
    level1: ["ttft", "tpot", "tokens_per_sec"],
    level2: ["p95_latency", "p99_latency", "gpu_util", "gpu_memory", "cost_per_token"],
    level3: [
      "kv_cache_usage",
      "queue_wait_time",
      "batch_size_effective",
      "error_rate",
      "timeout_rate",
      "memory_footprint",
      "cpu_util",
      "network_bandwidth",
      "launch_overhead",
      "cost_per_request",
    ],
  },
  ai_infra_training: {
    label: "AI Infra 训练",
    level1: ["throughput", "mfu", "cost_per_step"],
    level2: ["gpu_util", "gpu_memory", "step_time", "scaling_efficiency", "error_rate"],
    level3: [
      "communication_overhead",
      "data_loading_time",
      "checkpoint_time",
      "memory_footprint",
      "network_bandwidth",
      "cpu_util",
      "io_bandwidth",
      "gradient_norm",
      "loss_stability",
      "timeout_rate",
    ],
  },
  hpc_operator: {
    label: "HPC / 算子优化",
    level1: ["tflops", "memory_bandwidth", "speedup"],
    level2: ["p95_latency", "kernel_time", "cpu_util", "gpu_util", "scaling_efficiency"],
    level3: [
      "cache_miss_rate",
      "cache_hit_rate",
      "occupancy",
      "warp_efficiency",
      "branch_divergence",
      "launch_overhead",
      "io_bandwidth",
      "communication_overhead",
      "memory_footprint",
      "energy_per_run",
    ],
  },
};

function option(name, fallback = undefined) {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) return true;
  return value;
}

function hasFlag(name) {
  return args.includes(name);
}

function optionsAll(name) {
  const values = [];
  for (let idx = 0; idx < args.length; idx += 1) {
    if (args[idx] === name) {
      const value = args[idx + 1];
      if (value && !value.startsWith("--")) {
        values.push(value);
      }
    }
  }
  return values;
}

function subcommandFor(name, allowed = []) {
  const idx = args.indexOf(name);
  if (idx === -1) return "";
  const allowedSet = new Set(allowed);
  for (let i = idx + 1; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (arg.startsWith("--")) {
      const value = args[i + 1];
      if (value && !value.startsWith("--")) i += 1;
      continue;
    }
    if (!allowed.length || allowedSet.has(arg)) return arg;
  }
  return "";
}

function positionalText(excludedFlags = []) {
  const idx = args.findIndex((arg) => !arg.startsWith("-"));
  if (idx === -1) {
    return "";
  }
  const skip = new Set(excludedFlags);
  const parts = [];
  let started = false;
  for (let i = idx + 1; i < args.length; i += 1) {
    const arg = args[i];
    if (skip.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      if (started) break;
      continue;
    }
    started = true;
    parts.push(arg);
  }
  return parts.join(" ").trim();
}

function targetDir() {
  return path.resolve(String(option("--dir", process.cwd())));
}

const COMMAND_REGISTRY = [
  { group: "Setup", canonical: "init", aliases: [], summary: "scaffold .researchloop/ + agent instructions" },
  { group: "Setup", canonical: "goal", aliases: [], summary: "save research objective + metric + baseline command" },
  { group: "Setup", canonical: "inspect", aliases: [], summary: "write repo-profile.json (frameworks, launchers, model block)" },
  { group: "Setup", canonical: "doctor", aliases: [], summary: "check local tooling; --repair-plan prints fixes" },
  { group: "Setup", canonical: "prompt", aliases: [], summary: "print agent-ready autonomous research prompt" },

  { group: "Backlog & ideation", canonical: "topic", aliases: [], summary: "baseline-aware intake for a research topic" },
  { group: "Backlog & ideation", canonical: "scan-papers", aliases: [], summary: "fetch arXiv abstracts into scratchpad/papers/" },
  { group: "Backlog & ideation", canonical: "paper-read", aliases: [], summary: "structured claim/mechanism/limits/port/baseline note" },
  { group: "Backlog & ideation", canonical: "paper-reread", aliases: [], summary: "compare paper note against a finished run" },
  { group: "Backlog & ideation", canonical: "hypothesis", aliases: [], summary: "mechanism-first hypotheses from papers or runs" },
  { group: "Backlog & ideation", canonical: "propose", aliases: [], summary: "write grounded experiment proposals to JSONL" },
  { group: "Backlog & ideation", canonical: "rank", aliases: [], summary: "score proposals (impact/cost/risk/novelty/evidence)" },
  { group: "Backlog & ideation", canonical: "priors", aliases: [], summary: "attach arXiv prior-art to one proposal" },
  { group: "Backlog & ideation", canonical: "next-experiment", aliases: ["next"], summary: "turn the top proposal into an executable runbook" },
  { group: "Backlog & ideation", canonical: "idea", aliases: [], summary: "chat-first research prompt for the agent" },
  { group: "Backlog & ideation", canonical: "mechanisms", aliases: [], summary: "collect mechanism strings; --check dedups for propose --novel" },
  { group: "Backlog & ideation", canonical: "ablate", aliases: [], summary: "turn a winning config into halve/double/remove/flip proposals" },
  { group: "Backlog & ideation", canonical: "fork", aliases: [], summary: "emit a run snippet from a known-good config" },
  { group: "Backlog & ideation", canonical: "warmstart", aliases: [], summary: "launch snippet using a prior run's checkpoint as init weights" },
  { group: "Backlog & ideation", canonical: "suggest", aliases: [], summary: "next-experiment suggestion off the ledger" },
  { group: "Backlog & ideation", canonical: "similar", aliases: [], summary: "find runs most similar by config + metric" },
  { group: "Backlog & ideation", canonical: "search", aliases: ["grep"], summary: "full-text grep across papers, hypotheses, proposals, ledger" },

  { group: "Run", canonical: "run", aliases: [], summary: "execute a training/eval command + record" },
  { group: "Run", canonical: "baseline", aliases: [], summary: "run baseline; --lock / --unlock freeze it" },
  { group: "Run", canonical: "baseline-status", aliases: [], summary: "report baseline presence + lock state" },
  { group: "Run", canonical: "eval", aliases: [], summary: "run eval.yaml structured eval for a recorded run" },
  { group: "Run", canonical: "record", aliases: [], summary: "manual ledger row (escape hatch; prefer run)" },
  { group: "Run", canonical: "sweep", aliases: [], summary: "generate|status|run queue-based sweeps" },
  { group: "Run", canonical: "loop", aliases: [], summary: "ratchet loop; keeps the best across iterations" },
  { group: "Run", canonical: "smoke", aliases: [], summary: "actually-run smoke test (60s budget) on a real command" },
  { group: "Run", canonical: "replay", aliases: [], summary: "re-execute a recorded run + report drift" },
  { group: "Run", canonical: "verify", aliases: [], summary: "re-run + report deterministic / drifted" },
  { group: "Run", canonical: "resume", aliases: [], summary: "re-launch a failed/timeout run from checkpoint" },
  { group: "Run", canonical: "determinism", aliases: ["det"], summary: "re-run same command N times; tolerance check" },
  { group: "Run", canonical: "anomalies", aliases: ["anomaly"], summary: "detect divergence, spikes, plateaus in metric history" },
  { group: "Run", canonical: "preflight", aliases: [], summary: "pre-run gates: command/safety/metric/disk/RAM/GPU/baseline" },
  { group: "Run", canonical: "eta", aliases: [], summary: "best-effort time-to-completion off streamed metrics" },
  { group: "Run", canonical: "tail", aliases: [], summary: "tail the run log (or streamed metrics with --metrics)" },

  { group: "Resource planning", canonical: "gpu-fit", aliases: ["vram-fit", "vram"], summary: "VRAM estimator per GPU SKU; ZeRO / TP / DP / activations" },
  { group: "Resource planning", canonical: "kv-cache", aliases: ["kv"], summary: "inference VRAM; GQA-aware; max batch/context" },
  { group: "Resource planning", canonical: "mfu", aliases: [], summary: "Model FLOPs Utilization per ledger row" },
  { group: "Resource planning", canonical: "compute-budget", aliases: ["compute"], summary: "Chinchilla tokens/FLOPs/gpu-days calculator" },
  { group: "Resource planning", canonical: "shard-plan", aliases: ["parallelism", "shard"], summary: "recommend (TP, PP, DP) split for a target model + cluster" },
  { group: "Resource planning", canonical: "sweep-projection", aliases: ["sweep-project", "project-sweep"], summary: "project sweep wall time + cost before launching" },
  { group: "Resource planning", canonical: "headroom", aliases: [], summary: "gap-to-perfect / gap-to-SoTA reality check" },
  { group: "Resource planning", canonical: "gpu-report", aliases: ["gpu"], summary: "aggregate per-run system.jsonl load + memory" },
  { group: "Resource planning", canonical: "hardware", aliases: ["hw"], summary: "GPU/CUDA/Python/Torch distributions across the ledger" },
  { group: "Resource planning", canonical: "disk-check", aliases: ["disk"], summary: "exit non-zero when free space is below threshold" },
  { group: "Resource planning", canonical: "container-snapshot", aliases: ["container"], summary: "Dockerfile + requirements.lock repro kit for a run" },

  { group: "Statistical rigor", canonical: "significance", aliases: ["sig"], summary: "permutation test + bootstrap CI on metric delta" },
  { group: "Statistical rigor", canonical: "power", aliases: [], summary: "required sample size for a given effect size" },
  { group: "Statistical rigor", canonical: "sample-efficiency", aliases: ["se"], summary: "step at which a run hit 50/75/90/95/99% improvement" },
  { group: "Statistical rigor", canonical: "rl-stats", aliases: ["rl"], summary: "Agarwal-2021 robust episode-return aggregator with IQM" },
  { group: "Statistical rigor", canonical: "scaling-fit", aliases: ["scaling"], summary: "Kaplan / Chinchilla power-law fit on the ledger" },
  { group: "Statistical rigor", canonical: "grad-noise", aliases: ["gns", "gradient-noise"], summary: "McCandlish 2018 critical-batch estimator" },
  { group: "Statistical rigor", canonical: "overfit-watch", aliases: ["overfit"], summary: "val-min step, divergence, wasted-compute fraction" },
  { group: "Statistical rigor", canonical: "memorization", aliases: ["memo", "verbatim-check"], summary: "verbatim training-data leakage in model outputs" },
  { group: "Statistical rigor", canonical: "canary", aliases: [], summary: "exact / substring eval-train leak detector" },

  { group: "API / LLM evals", canonical: "api-budget", aliases: ["api-cost", "tokens-cost"], summary: "project $ cost across baked-in pricing registry" },
  { group: "API / LLM evals", canonical: "judge", aliases: [], summary: "LLM-as-judge harness (pairwise / scalar / reference)" },
  { group: "API / LLM evals", canonical: "elo", aliases: ["arena"], summary: "pairwise model ratings: online Elo + Bradley-Terry MLE" },
  { group: "API / LLM evals", canonical: "eval-diff", aliases: ["predictions-diff"], summary: "flip analysis between two predictions files" },
  { group: "API / LLM evals", canonical: "lr-finder", aliases: ["lrfinder", "find-lr"], summary: "analyze a Smith-style LR range test; report elbow" },
  { group: "API / LLM evals", canonical: "bench", aliases: ["benchmark"], summary: "MMLU/HumanEval/GSM8K/... preset registry; add patches eval.yaml" },

  { group: "Compare & promote", canonical: "compare", aliases: [], summary: "rank runs by metric; auto-runs significance" },
  { group: "Compare & promote", canonical: "curves", aliases: ["curve"], summary: "sparkline + stats for streamed metric series" },
  { group: "Compare & promote", canonical: "diff-runs", aliases: [], summary: "two-run diff in text / json / markdown" },
  { group: "Compare & promote", canonical: "review", aliases: [], summary: "programmatic pre-promote checks on a recorded run" },
  { group: "Compare & promote", canonical: "promote", aliases: [], summary: "copy a winning run to winners/; gates on review" },
  { group: "Compare & promote", canonical: "audit", aliases: [], summary: "verify numeric claims in a markdown resolve to ledger" },

  { group: "Reporting", canonical: "report", aliases: [], summary: "lab-note markdown report; +MFU / Overfit / cost tables" },
  { group: "Reporting", canonical: "summary", aliases: ["status"], summary: "one-screen project state + next-action command" },
  { group: "Reporting", canonical: "leaderboard", aliases: ["top"], summary: "top-N runs with deltas, status, wall time, USD" },
  { group: "Reporting", canonical: "story", aliases: [], summary: "narrate a run's ancestry, diff, descendants, lesson" },
  { group: "Reporting", canonical: "retrospective", aliases: ["retro"], summary: "weekly synthesis: counts, top runs, lessons, spend" },
  { group: "Reporting", canonical: "digest", aliases: [], summary: "text/json/markdown digest --since window" },
  { group: "Reporting", canonical: "param-importance", aliases: [], summary: "rank which params moved the metric most" },
  { group: "Reporting", canonical: "failures", aliases: [], summary: "top failure patterns across runs" },
  { group: "Reporting", canonical: "query", aliases: [], summary: "ad-hoc filter/sort/limit over runs.jsonl" },
  { group: "Reporting", canonical: "model-card", aliases: [], summary: "per-run model card markdown" },
  { group: "Reporting", canonical: "pr-bundle", aliases: ["pr"], summary: "render PR-ready markdown body for a run" },
  { group: "Reporting", canonical: "agent-memory", aliases: ["memory"], summary: "distill project into a CLAUDE.md-sized fragment" },
  { group: "Reporting", canonical: "bibtex", aliases: ["bib"], summary: "extract BibTeX from paper notes; filter to cited entries" },
  { group: "Reporting", canonical: "lit-diff", aliases: ["litdiff"], summary: "section-by-section diff of two paper notes" },
  { group: "Reporting", canonical: "share", aliases: [], summary: "package a run as a portable .tar.gz" },
  { group: "Reporting", canonical: "forecast", aliases: [], summary: "project metric trajectory forward from the ledger" },
  { group: "Reporting", canonical: "pareto", aliases: [], summary: "Pareto front across two competing metrics" },
  { group: "Reporting", canonical: "dashboard", aliases: [], summary: "localhost dashboard: scatter, curves, /diff, /lineage" },

  { group: "Hygiene & ops", canonical: "prune", aliases: [], summary: "prune runs by age / status; --dry-run safe" },
  { group: "Hygiene & ops", canonical: "tag", aliases: [], summary: "add/remove/list tags on a run" },
  { group: "Hygiene & ops", canonical: "archive", aliases: [], summary: "mark a dead-end with a reason" },
  { group: "Hygiene & ops", canonical: "learn", aliases: [], summary: "capture a transferable lesson off a run" },
  { group: "Hygiene & ops", canonical: "reset", aliases: [], summary: "remove a row + side-archive the run dir" },
  { group: "Hygiene & ops", canonical: "question", aliases: ["q"], summary: "open-questions parking lot at questions.jsonl" },
  { group: "Hygiene & ops", canonical: "stale-locks", aliases: ["locks"], summary: "find/remove zombie sweep/task lock files" },
  { group: "Hygiene & ops", canonical: "validate-config", aliases: ["validate"], summary: "schema lint for .researchloop/*.yaml" },
  { group: "Hygiene & ops", canonical: "budget", aliases: [], summary: "cost guardrail; --check exits 2 over-budget" },
  { group: "Hygiene & ops", canonical: "seed", aliases: [], summary: "single source of truth for today's seed; --env emits ritual" },
  { group: "Hygiene & ops", canonical: "data-fingerprint", aliases: [], summary: "hash input data for reproducibility" },
  { group: "Hygiene & ops", canonical: "data-sample", aliases: ["sample-data"], summary: "JSONL/CSV/TSV sample + length percentiles + class balance" },
  { group: "Hygiene & ops", canonical: "hooks", aliases: ["hook"], summary: "manage pre/post-run / promote / failure shell hooks" },
  { group: "Hygiene & ops", canonical: "slurm", aliases: ["sbatch"], summary: "generate .sbatch wrapping autoresearch run" },

  { group: "Coordination", canonical: "team", aliases: [], summary: "generate multi-agent development board" },
  { group: "Coordination", canonical: "tasks", aliases: [], summary: "claimable multi-agent queue at tasks.jsonl" },
];

function cmdListCommands() {
  const fmt = option("--format", "text");
  if (fmt === "json") {
    console.log(JSON.stringify(COMMAND_REGISTRY, null, 2));
    return;
  }
  const groups = new Map();
  for (const entry of COMMAND_REGISTRY) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  for (const [group, entries] of groups) {
    console.log(`\n${group}`);
    console.log("-".repeat(group.length));
    for (const entry of entries) {
      const aliasPart = entry.aliases.length ? ` (${entry.aliases.join(", ")})` : "";
      console.log(`  ${entry.canonical}${aliasPart}  —  ${entry.summary}`);
    }
  }
  console.log("");
}

function defaultSafetyPolicy() {
  return {
    allowPrefixes: [
      "python",
      "python3",
      "bash",
      "sh",
      "node",
      "npm",
      "npx",
      "uv",
      "make",
      "pytest",
      "printf",
      "echo",
      "sleep",
      "false",
      "true",
    ],
    denySubstrings: [
      "rm -rf",
      "sudo",
      "curl",
      "wget",
      "mkfs",
      "shutdown",
      "reboot",
      "poweroff",
    ],
    maxMinutesPerRun: 60,
    maxCostUsdPerRun: 0,
  };
}

function parseSafetyScalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text);
  }
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function normalizeSafetyPolicy(policy) {
  const defaults = defaultSafetyPolicy();
  const allowPrefixes = Array.isArray(policy.allowPrefixes)
    ? policy.allowPrefixes.map((entry) => String(entry).trim()).filter(Boolean)
    : defaults.allowPrefixes;
  const denySubstrings = Array.isArray(policy.denySubstrings)
    ? policy.denySubstrings.map((entry) => String(entry).trim()).filter(Boolean)
    : defaults.denySubstrings;
  const maxMinutesPerRun = Number(policy.maxMinutesPerRun);
  const maxCostUsdPerRun = Number(policy.maxCostUsdPerRun);

  return {
    allowPrefixes: allowPrefixes.length ? allowPrefixes : defaults.allowPrefixes,
    denySubstrings: denySubstrings.length ? denySubstrings : defaults.denySubstrings,
    maxMinutesPerRun: Number.isFinite(maxMinutesPerRun) && maxMinutesPerRun > 0
      ? maxMinutesPerRun
      : defaults.maxMinutesPerRun,
    maxCostUsdPerRun: Number.isFinite(maxCostUsdPerRun) && maxCostUsdPerRun >= 0
      ? maxCostUsdPerRun
      : defaults.maxCostUsdPerRun,
  };
}

function parseSafetyPolicy(text) {
  const policy = {
    allowPrefixes: [],
    denySubstrings: [],
    maxMinutesPerRun: undefined,
    maxCostUsdPerRun: undefined,
  };
  let activeList = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const listMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
    if (listMatch) {
      activeList = listMatch[1];
      continue;
    }

    const scalarMatch = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
    if (scalarMatch) {
      const key = scalarMatch[1];
      const value = parseSafetyScalar(scalarMatch[2]);
      if (key === "allow_prefixes" || key === "allowPrefixes") {
        policy.allowPrefixes = Array.isArray(value) ? value : [value];
      } else if (key === "deny_substrings" || key === "denySubstrings") {
        policy.denySubstrings = Array.isArray(value) ? value : [value];
      } else if (key === "max_minutes_per_run" || key === "maxMinutesPerRun") {
        policy.maxMinutesPerRun = value;
      } else if (key === "max_cost_usd_per_run" || key === "maxCostUsdPerRun") {
        policy.maxCostUsdPerRun = value;
      }
      activeList = null;
      continue;
    }

    const itemMatch = line.match(/^-\s*(.+)$/);
    if (itemMatch && activeList) {
      const value = String(parseSafetyScalar(itemMatch[1]));
      if (activeList === "allow_prefixes" || activeList === "allowPrefixes") {
        policy.allowPrefixes.push(value);
      } else if (activeList === "deny_substrings" || activeList === "denySubstrings") {
        policy.denySubstrings.push(value);
      }
    }
  }

  return normalizeSafetyPolicy(policy);
}

function loadSafetyPolicy(cwd) {
  const candidates = [
    path.join(cwd, ".researchloop", "safety.yaml"),
    path.join(templatesRoot, "base", "safety.yaml"),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }
    try {
      return parseSafetyPolicy(fs.readFileSync(file, "utf8"));
    } catch {
      // Fall through to the built-in defaults.
    }
  }
  return defaultSafetyPolicy();
}

function evaluateCommandSafety(commandText, policy) {
  const normalizedCommand = String(commandText || "").trim();
  const lowerCommand = normalizedCommand.toLowerCase();
  const denyMatch = (policy.denySubstrings || []).find((needle) => {
    const trimmed = String(needle || "").trim();
    return trimmed && lowerCommand.includes(trimmed.toLowerCase());
  });
  if (denyMatch) {
    return {
      allowed: false,
      rule: "deny_substrings",
      message: `matches deny_substrings: ${denyMatch}`,
    };
  }

  const prefixMatch = (policy.allowPrefixes || []).find((prefix) => {
    const trimmed = String(prefix || "").trim();
    return trimmed && normalizedCommand.startsWith(trimmed);
  });
  if (!prefixMatch) {
    return {
      allowed: false,
      rule: "allow_prefixes",
      message: `does not start with an allowed prefix (${(policy.allowPrefixes || []).join(", ")})`,
    };
  }

  const maxMinutes = Number(policy.maxMinutesPerRun);
  const maxMs = Number.isFinite(maxMinutes) && maxMinutes > 0
    ? Math.max(1, Math.floor(maxMinutes * 60_000))
    : null;

  return {
    allowed: true,
    rule: null,
    message: "",
    maxMs,
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFileSafe(file, content, force = false) {
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && !force) {
    return false;
  }
  fs.writeFileSync(file, content);
  return true;
}

function copyDir(src, dest, force = false) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, force);
    } else {
      writeFileSafe(destPath, fs.readFileSync(srcPath), force);
    }
  }
}

function run(commandText, cwd) {
  try {
    return execSync(commandText, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function runCapture(commandText, cwd) {
  try {
    const output = execSync(commandText, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    return { ok: true, output };
  } catch (err) {
    const stdout = String(err?.stdout || "").trim();
    const stderr = String(err?.stderr || "").trim();
    return {
      ok: false,
      output: [stdout, stderr].filter(Boolean).join("\n").trim(),
    };
  }
}

function sha256Hex(text) {
  return createHash("sha256").update(text).digest("hex");
}

function existsAny(cwd, candidates) {
  return candidates.filter((candidate) => fs.existsSync(path.join(cwd, candidate)));
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

function readSafe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function captureEnv(cwd, pythonOverride = null) {
  const env = {
    git_sha: null,
    git_dirty: null,
    python_version: null,
    pip_freeze_sha256: null,
    torch_version: null,
    cuda_available: null,
    cuda_version: null,
    gpu_device_names: null,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    hostname: os.hostname(),
  };

  const gitShaResult = runCapture("git rev-parse HEAD 2>&1", cwd);
  if (gitShaResult.ok && gitShaResult.output) {
    env.git_sha = gitShaResult.output;
    const gitDirtyResult = runCapture("git status --porcelain 2>&1", cwd);
    env.git_dirty = gitDirtyResult.ok ? gitDirtyResult.output.length > 0 : null;
  }

  let python = null;
  const pythonCandidates = pythonOverride
    ? [pythonOverride, "python3", "python"]
    : ["python3", "python"];
  for (const candidate of pythonCandidates) {
    const versionResult = runCapture(`${candidate} --version 2>&1`, cwd);
    if (versionResult.ok && versionResult.output) {
      python = candidate;
      env.python_version = versionResult.output;
      break;
    }
  }

  if (python) {
    const freezeResult = runCapture(`${python} -m pip freeze 2>&1`, cwd);
    if (freezeResult.ok) {
      const freezeText = freezeResult.output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort()
        .join("\n");
      env.pip_freeze_sha256 = sha256Hex(freezeText);
    }

    const torchProbe = runCapture(
      `${python} - <<'PY'\nimport importlib.util\nimport json\nresult = {\n    "torch_version": None,\n    "cuda_available": None,\n    "cuda_version": None,\n    "gpu_device_names": None,\n}\nspec = importlib.util.find_spec("torch")\nif spec:\n    import torch\n    result["torch_version"] = torch.__version__\n    result["cuda_available"] = bool(torch.cuda.is_available())\n    result["cuda_version"] = torch.version.cuda or None\n    if result["cuda_available"]:\n        result["gpu_device_names"] = [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())]\n    else:\n        result["gpu_device_names"] = None\nprint(json.dumps(result))\nPY`,
      cwd
    );
    if (torchProbe.ok && torchProbe.output) {
      try {
        const torchEnv = JSON.parse(torchProbe.output);
        env.torch_version = torchEnv.torch_version ?? null;
        env.cuda_available = torchEnv.cuda_available ?? null;
        env.cuda_version = torchEnv.cuda_version ?? null;
        env.gpu_device_names = torchEnv.gpu_device_names ?? null;
      } catch {
        // keep explicit nulls when the probe fails
      }
    }
  }

  return env;
}

function formatEnvValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

function envMismatches(expectedEnv, currentEnv) {
  const fields = [
    "git_sha",
    "git_dirty",
    "python_version",
    "pip_freeze_sha256",
    "torch_version",
    "cuda_available",
    "cuda_version",
    "gpu_device_names",
    "os",
    "hostname",
  ];
  const mismatches = [];
  for (const field of fields) {
    const expected = expectedEnv?.[field] ?? null;
    const current = currentEnv?.[field] ?? null;
    if (JSON.stringify(expected) !== JSON.stringify(current)) {
      mismatches.push({ field, expected, current });
    }
  }
  return mismatches;
}

function readLatestRunRow(cwd) {
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const runs = parseRunsLedger(ledgerPath);
  return [...runs].reverse().find((row) => row && !row.parse_error) || null;
}

function readRunRowById(cwd, runId) {
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const runs = parseRunsLedger(ledgerPath);
  return [...runs].reverse().find((row) => row && !row.parse_error && String(row.id) === String(runId)) || null;
}

function readRunRows(cwd) {
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  return parseRunsLedger(ledgerPath).filter((row) => row && !row.parse_error);
}

function appendRunRow(cwd, row) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  ensureDir(path.dirname(ledger));
  fs.appendFileSync(ledger, `${JSON.stringify(row)}\n`);
}

function archiveAndClearDashboardRuns(cwd) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const scratchpad = path.dirname(ledger);
  ensureDir(scratchpad);

  const raw = fs.existsSync(ledger) ? readTextIfExists(ledger) : "";
  const rows = parseRunsLedger(ledger);
  let archive = null;

  if (raw.trim()) {
    const archiveDir = path.join(scratchpad, "archive");
    ensureDir(archiveDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveFile = path.join(archiveDir, `runs-${stamp}.jsonl`);
    fs.copyFileSync(ledger, archiveFile);
    archive = path.relative(cwd, archiveFile);
  }

  fs.writeFileSync(ledger, "");

  const thread = path.join(scratchpad, "THREAD.md");
  fs.appendFileSync(thread, `- ${new Date().toISOString()} dashboard cleared run ledger${archive ? ` archive=${archive}` : ""}\n`);

  return {
    ledger: path.relative(cwd, ledger),
    archive,
    clearedRuns: rows.filter((row) => row && !row.parse_error).length,
    parseErrors: rows.filter((row) => row && row.parse_error).length,
  };
}

function depsMention(cwd, needle) {
  const candidates = ["requirements.txt", "pyproject.toml", "setup.py", "uv.lock", "Pipfile"];
  const needleLower = needle.toLowerCase();
  for (const name of candidates) {
    const text = readSafe(path.join(cwd, name)).toLowerCase();
    if (text.includes(needleLower)) {
      return true;
    }
  }
  return false;
}

function detectMultiGpuStack(cwd, files) {
  const stack = {
    detected: [],
    suggestions: [],
  };
  const has = (dep) => depsMention(cwd, dep);

  const torchrunFiles = [];
  const accelerateFiles = [];
  const deepspeedFiles = [];
  const lightningFiles = [];
  const fsdpFiles = [];

  for (const file of files) {
    if (!/\.(py|sh|yaml|yml)$/i.test(file)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }
    if (/\btorchrun\b|torch\.distributed\.(launch|run)/.test(content)) {
      torchrunFiles.push(file);
    }
    if (/\baccelerate\b|accelerate\.Accelerator\(|from accelerate /.test(content)) {
      accelerateFiles.push(file);
    }
    if (/\bdeepspeed\b|deepspeed\.initialize|--deepspeed_config/.test(content)) {
      deepspeedFiles.push(file);
    }
    if (/pytorch_lightning|lightning\.pytorch|import lightning/.test(content)) {
      lightningFiles.push(file);
    }
    if (/FullyShardedDataParallel|torch\.distributed\.fsdp/.test(content)) {
      fsdpFiles.push(file);
    }
  }

  if (torchrunFiles.length || has("torch")) {
    if (torchrunFiles.length) {
      stack.detected.push({ tool: "torchrun", files: torchrunFiles.slice(0, 5) });
      stack.suggestions.push("torchrun --nproc-per-node=<N_GPUS> <train.py> [args]");
    }
  }
  if (accelerateFiles.length || has("accelerate")) {
    stack.detected.push({ tool: "accelerate", files: accelerateFiles.slice(0, 5) });
    stack.suggestions.push("accelerate launch --num_processes=<N_GPUS> <train.py> [args]");
  }
  if (deepspeedFiles.length || has("deepspeed")) {
    stack.detected.push({ tool: "deepspeed", files: deepspeedFiles.slice(0, 5) });
    stack.suggestions.push("deepspeed --num_gpus=<N_GPUS> <train.py> --deepspeed_config <config.json>");
  }
  if (lightningFiles.length || has("pytorch_lightning") || has("lightning")) {
    stack.detected.push({ tool: "pytorch-lightning", files: lightningFiles.slice(0, 5) });
    stack.suggestions.push("python <train.py> --trainer.devices=<N_GPUS> --trainer.strategy=ddp");
  }
  if (fsdpFiles.length) {
    stack.detected.push({ tool: "fsdp", files: fsdpFiles.slice(0, 5) });
  }

  const gpuProbe = probeGpuStats();
  if (gpuProbe) {
    stack.gpus_local = gpuProbe.length;
    stack.gpu_memory_total_mb_local = Math.max(...gpuProbe.map((g) => g.mem_total_mb || 0)) || null;
  } else {
    stack.gpus_local = 0;
  }
  return stack;
}

function detectRepo(cwd) {
  const files = walkFiles(cwd, 3);
  const basenames = files.map((file) => path.basename(file));
  const trainScriptPattern = /^(train|finetune|pretrain)[\w-]*\.py$/i;
  const hasTrainScript = basenames.some((name) => trainScriptPattern.test(name));

  const adapters = ["generic"];
  if (hasTrainScript || depsMention(cwd, "torch")) {
    adapters.push("pytorch");
  }
  if (depsMention(cwd, "transformers") || depsMention(cwd, "huggingface_hub")) {
    adapters.push("huggingface");
  }
  if (files.includes("train_llm.py") && files.includes("configs/llm_config.py")) {
    adapters.push("llm-research-kit");
  }

  const multiGpu = detectMultiGpuStack(cwd, files);

  return {
    cwd,
    generated_at: new Date().toISOString(),
    git_branch: run("git branch --show-current", cwd) || null,
    git_status_short: run("git status --short", cwd) || null,
    package_files: existsAny(cwd, ["package.json", "pyproject.toml", "requirements.txt", "uv.lock"]),
    candidate_train_files: files.filter((file) => /(^|\/)(train|finetune|pretrain)[\w-]*\.py$/i.test(file)).slice(0, 30),
    candidate_eval_files: files.filter((file) => /(^|\/)(eval|evaluate|benchmark)[\w-]*\.py$/i.test(file)).slice(0, 30),
    candidate_config_files: files.filter((file) => /(^|\/|_)(config|cfg)[\w-]*\.(py|js|ts|json|yaml|yml|toml)$/i.test(file)).slice(0, 40),
    candidate_log_dirs: existsAny(cwd, ["logs", "runs", "wandb", "mlruns", "checkpoints", "plots"]),
    adapters: [...new Set(adapters)],
    multi_gpu: multiGpu,
  };
}

function installAgentFile(cwd, agent, force) {
  const content = [
    "# AutoResearch-AI",
    "",
    "Before doing autonomous research, read:",
    "",
    "- `.researchloop/AGENTS.md`",
    "- `.researchloop/goal.md`",
    "- `.researchloop/plan.md`",
    "- `.researchloop/scratchpad/THREAD.md`",
    "- `.researchloop/scratchpad/runs.jsonl`",
    "- `.researchloop/scratchpad/memory.md` when present",
    "- recent idea notes in `.researchloop/scratchpad/ideas/`",
    "",
    "Use `.researchloop/` as durable working memory.",
    "If `.researchloop/tasks.jsonl` exists, claim a task before editing shared files.",
    "Record commands, metrics, decisions, history, and next experiments there.",
    "Keep stable user preferences and working style in `.researchloop/scratchpad/memory.md`.",
    "Base new ideas on the repo's own experiment history first.",
    "Do not default to learning-rate sweeps unless the history or repo shape makes them the right follow-up.",
    "Recommend the most relevant skills to the user from the current repo state, especially right after setup.",
    "",
  ].join("\n");

  if (agent === "claude-code") {
    return writeFileSafe(path.join(cwd, "CLAUDE.md"), content, force);
  }
  if (agent === "hermes") {
    return writeFileSafe(path.join(cwd, "HERMES.md"), content, force);
  }
  if (agent === "cursor") {
    return writeFileSafe(path.join(cwd, ".cursor", "rules", "researchloop.mdc"), content, force);
  }
  return writeFileSafe(path.join(cwd, "AGENTS.md"), content, force);
}

function renderTemplate(text, values) {
  let output = text;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return output;
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-") || "task";
}

function buildDevelopmentLanes(cwd) {
  const lanes = [
    {
      title: "CLI and runtime",
      slug: "cli-runtime",
      scope: "bin/researchloop.js, package.json, and command plumbing",
      files: ["bin/researchloop.js", "package.json"],
      done: "Core commands still pass, the new work does not break the CLI, and the help text stays accurate.",
    },
    {
      title: "Dashboard and state API",
      slug: "dashboard",
      scope: "templates/dashboard/index.html and the local state endpoints",
      files: ["bin/researchloop.js", "templates/dashboard/index.html"],
      done: "The localhost dashboard still renders and reflects the repo state correctly.",
    },
    {
      title: "Prompt packs and skills",
      slug: "prompts-skills",
      scope: "templates/prompts/*, templates/team/*, and skills/*",
      files: ["templates/prompts", "skills"],
      done: "Prompt templates stay aligned with the README and the downloadable skill pack.",
    },
    {
      title: "Docs and onboarding",
      slug: "docs-onboarding",
      scope: "README.md, docs/getting-started.md, and startup docs",
      files: ["README.md", "docs/getting-started.md", "docs/startup"],
      done: "A new user can copy the prompt, install the package, and reach the first run without guessing.",
    },
    {
      title: "Tests and CI",
      slug: "tests-ci",
      scope: "scripts/test-*.sh and .github/workflows/ci.yml",
      files: ["scripts", ".github/workflows/ci.yml"],
      done: "Every meaningful change has a local test and CI still covers the important paths.",
    },
    {
      title: "Release and publishing",
      slug: "release-publishing",
      scope: "CHANGELOG.md, ROADMAP.md, release notes, npm publish steps, and GitHub releases",
      files: ["CHANGELOG.md", "ROADMAP.md", "docs/startup/release-plan.md"],
      done: "The next version can be published cleanly with a short release note and no repo confusion.",
    },
    {
      title: "Competitor and user research",
      slug: "competitor-research",
      scope: "docs/competitors/* and docs/startup/users/*",
      files: ["docs/competitors", "docs/startup/users"],
      done: "We keep learning from the ecosystem and from real users without turning research into vapor.",
    },
    {
      title: "Public site and launch copy",
      slug: "site-launch",
      scope: "docs/site/* and the launch-facing copy",
      files: ["docs/site"],
      done: "The public site stays short, clear, and matched to the current product surface.",
    },
    {
      title: "Repo detection and adapters",
      slug: "adapters-detection",
      scope: "repo profiling, adapter detection, and adapter templates",
      files: ["bin/researchloop.js", "templates/adapters"],
      done: "The repo profiler keeps working and adapter detection stays honest.",
    },
    {
      title: "Integration and merge safety",
      slug: "integration-review",
      scope: "cross-cutting review, branch cleanup, and merge safety",
      files: ["README.md", "docs/startup/README.md", "docs/startup/release-plan.md"],
      done: "Conflicting diffs are caught before merge and the board stays current.",
    },
    {
      title: "Examples and fixtures",
      slug: "examples-fixtures",
      scope: "examples/* and examples/fixtures/*",
      files: ["examples"],
      done: "The copyable examples keep the onboarding and tests grounded in real files.",
    },
    {
      title: "Research logs and evidence",
      slug: "research-evidence",
      scope: "docs/research/* and experiment evidence",
      files: ["docs/research"],
      done: "The repo keeps a record of what was actually tried and what changed.",
    },
  ];

  return lanes;
}

function buildTeamPlan(cwd, goalText, requestedWorkers) {
  const lanes = buildDevelopmentLanes(cwd);
  const targetCount = Math.max(1, Math.min(requestedWorkers, 20));
  const selected = lanes.slice(0, targetCount);
  while (selected.length < targetCount) {
    const index = selected.length + 1;
    selected.push({
      title: `Follow-up lane ${index}`,
      slug: `follow-up-${String(index).padStart(2, "0")}`,
      scope: "Use this lane for the next bottleneck the orchestrator finds.",
      files: ["README.md"],
      done: "The lane produced one clear patch, one note, and one merge-ready diff.",
    });
  }

  return {
    goalText,
    workers: selected.map((lane, index) => ({
      index: index + 1,
      title: lane.title,
      slug: slugify(lane.slug),
      scope: lane.scope,
      files: lane.files,
      done: lane.done,
      branch: `codex/autoresearch-${slugify(lane.slug)}`,
      worktree: `../autoresearch-${slugify(lane.slug)}`,
    })),
  };
}

function cmdInit() {
  const cwd = targetDir();
  const force = hasFlag("--force");
  const agent = String(option("--agent", "codex"));
  const researchDir = path.join(cwd, ".researchloop");

  copyDir(path.join(templatesRoot, "base"), researchDir, force);
  copyDir(path.join(templatesRoot, "adapters"), path.join(researchDir, "adapters"), force);
  const wroteAgent = installAgentFile(cwd, agent, force);

  const profile = detectRepo(cwd);
  writeFileSafe(
    path.join(researchDir, "repo-profile.json"),
    `${JSON.stringify(profile, null, 2)}\n`,
    true
  );

  console.log(`AutoResearch-AI initialized in ${cwd}`);
  console.log(`Harness: ${path.relative(cwd, researchDir)}`);
  console.log(`Agent file: ${wroteAgent ? "written" : "already existed"}`);
  console.log(`Detected adapters: ${profile.adapters.join(", ")}`);
}

function cmdInspect() {
  const cwd = targetDir();
  const researchDir = path.join(cwd, ".researchloop");
  ensureDir(researchDir);
  const profile = detectRepo(cwd);
  fs.writeFileSync(path.join(researchDir, "repo-profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  console.log(JSON.stringify(profile, null, 2));
}

function cmdPrompt() {
  const cwd = targetDir();
  const explicitGoal = option("--goal", null);
  const savedGoal = readGoalSummary(path.join(cwd, ".researchloop", "goal.md"));
  const focus = String(option("--focus", option("--playbook", ""))).trim();
  const goal =
    explicitGoal ||
    savedGoal ||
    "Improve the target metric through small, documented experiments.";
  const promptFile = path.join(templatesRoot, "prompts", "researchloop.md");
  const firstContactFile = path.join(templatesRoot, "prompts", "first-contact.md");
  const topicIntakeFile = path.join(templatesRoot, "prompts", "topic-intake.md");
  const template = fs.readFileSync(promptFile, "utf8");
  const firstContact = fs.existsSync(firstContactFile)
    ? `${fs.readFileSync(firstContactFile, "utf8").trim()}\n\n`
    : "";
  const topicIntake = fs.existsSync(topicIntakeFile)
    ? `${fs.readFileSync(topicIntakeFile, "utf8").trim()}\n\n`
    : "";
  let output = `${firstContact}${topicIntake}${template.replaceAll("{{GOAL}}", goal)}`;

  if (focus) {
    const focusFile = path.join(templatesRoot, "prompts", "focus", `${focus}.md`);
    if (fs.existsSync(focusFile)) {
      output += "\n\n";
      output += fs.readFileSync(focusFile, "utf8").replaceAll("{{GOAL}}", goal);
    }
  }

  process.stdout.write(output);
}

function cmdGoal() {
  const cwd = targetDir();
  const researchDir = path.join(cwd, ".researchloop");
  ensureDir(researchDir);
  const goalText = positionalText(["--dir", "--metric", "--direction", "--baseline", "--evaluation", "--allowed", "--forbidden"]);
  const goalFile = path.join(researchDir, "goal.md");

  if (!goalText) {
    if (fs.existsSync(goalFile)) {
      process.stdout.write(fs.readFileSync(goalFile, "utf8"));
      return;
    }
    console.log("No research goal set yet. Use `autoresearch goal \"lower validation loss\"`.");
    return;
  }

  const metric = String(option("--metric", "validation loss"));
  const direction = String(option("--direction", "lower"));
  const baseline = String(option("--baseline", "unknown"));
  const evaluation = String(option("--evaluation", "unknown"));
  const allowed = String(option("--allowed", "optimizer, schedules, initialization, hyperparameters"));
  const forbidden = String(option("--forbidden", "data, architecture, batch size, benchmark definition"));

  const content = [
    "# Research Goal",
    "",
    "## Goal",
    goalText,
    "",
    "## Target Metric",
    metric,
    "",
    "## Direction",
    direction,
    "",
    "## Baseline Command",
    baseline,
    "",
    "## Evaluation Command",
    evaluation,
    "",
    "## Allowed Changes",
    allowed,
    "",
    "## Forbidden Changes",
    forbidden,
    "",
    "## Current Best",
    "Unknown.",
    "",
    "## Notes",
    "Use `autoresearch inspect` to generate a repo profile, then ask an agent to fill in the missing benchmark details.",
    "",
  ].join("\n");

  fs.writeFileSync(goalFile, content);
  console.log(`Research goal saved to ${path.relative(cwd, goalFile)}`);
  console.log(`Goal: ${goalText}`);
}

function readGoalSummary(goalFile) {
  if (!fs.existsSync(goalFile)) {
    return "";
  }
  const text = fs.readFileSync(goalFile, "utf8");
  const match = text.match(/## Goal\s+([\s\S]*?)(?:\n## |\n# |$)/i);
  if (match) {
    return match[1].trim();
  }
  return text.trim();
}

function cmdDoctor() {
  const cwd = targetDir();
  const repairPlan = hasFlag("--repair-plan");
  const python = String(option("--python", "python3"));
  const nodeVersion = process.version;
  const npmVersion = run("npm --version", cwd) || "not found";
  const gitVersion = run("git --version", cwd) || "not found";
  const currentEnv = captureEnv(cwd, python);
  const latestRun = readLatestRunRow(cwd);

  if (repairPlan) {
    const checks = [];
    const rlDir = path.join(cwd, ".researchloop");
    const goalFile = path.join(rlDir, "goal.md");
    const evalFile = path.join(rlDir, "eval.yaml");
    const safetyFile = path.join(rlDir, "safety.yaml");

    if (!currentEnv.python_version) {
      checks.push({ priority: 1, check: "Python not found", fix: "Install Python 3.8+: https://python.org/downloads" });
    }
    if (!currentEnv.git_sha) {
      checks.push({ priority: 2, check: "Git not found or not a git repo", fix: "Run: git init && git remote add origin <url>" });
    }
    if (!fs.existsSync(goalFile)) {
      checks.push({ priority: 3, check: "goal.md missing", fix: "Run: autoresearch goal 'Your research goal'" });
    } else {
      const goalRaw = fs.readFileSync(goalFile, "utf8");
      if (!goalRaw.includes("Target Metric:")) {
        checks.push({ priority: 3, check: "goal.md missing Target Metric", fix: "Add 'Target Metric: metric_name' to goal.md" });
      }
      if (!goalRaw.includes("Direction:")) {
        checks.push({ priority: 3, check: "goal.md missing Direction", fix: "Add 'Direction: higher' or 'Direction: lower' to goal.md" });
      }
      if (!goalRaw.includes("## Baseline Command") && !goalRaw.includes("Baseline Command")) {
        checks.push({ priority: 3, check: "goal.md missing Baseline Command", fix: "Add '## Baseline Command' with your baseline command to goal.md" });
      }
    }
    if (fs.existsSync(evalFile)) {
      const evalRaw = fs.readFileSync(evalFile, "utf8");
      if (!evalRaw.includes("metrics:")) {
        checks.push({ priority: 4, check: "eval.yaml missing metrics section", fix: "Add 'metrics:' with name/regex_or_jsonpath entries to eval.yaml" });
      }
      if (!/regex_or_jsonpath:/.test(evalRaw)) {
        checks.push({ priority: 4, check: "eval.yaml missing regex_or_jsonpath", fix: "Add regex_or_jsonpath entries under each metric in eval.yaml" });
      }
    } else {
      checks.push({ priority: 4, check: "eval.yaml missing", fix: "Create .researchloop/eval.yaml with your metrics and regex patterns" });
    }
    const ledgerPath = path.join(rlDir, "scratchpad", "runs.jsonl");
    if (fs.existsSync(ledgerPath)) {
      const rows = fs.readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
      const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
      if (lastRow && Object.keys(lastRow.metrics || {}).length === 0 && lastRow.value == null) {
        checks.push({ priority: 5, check: "No metric parsed from last run", fix: "Check that your training script outputs metric in expected format (e.g., val_loss=0.42)" });
      }
    }
    if (!fs.existsSync(safetyFile)) {
      checks.push({ priority: 6, check: "safety.yaml missing (repo is open-loop)", fix: "Run: autoresearch init --safety to create a safety policy" });
    }
    if (!fs.existsSync(rlDir)) {
      checks.push({ priority: 2, check: ".researchloop/ directory missing", fix: "Run: autoresearch init" });
    } else if (!fs.existsSync(path.join(rlDir, "scratchpad"))) {
      checks.push({ priority: 2, check: ".researchloop/scratchpad/ missing", fix: "Run: mkdir -p .researchloop/scratchpad" });
    }

    if (checks.length === 0) {
      console.log("No issues found. Your setup looks healthy.");
      return;
    }
    checks.sort((a, b) => a.priority - b.priority);
    console.log("=== Repair Plan ===");
    console.log("");
    for (let i = 0; i < checks.length; i++) {
      const c = checks[i];
      console.log((i + 1) + ". [P" + c.priority + "] " + c.check);
      console.log("   Fix: " + c.fix);
      console.log("");
    }
    return;
  }

  console.log(`cwd: ${cwd}`);
  console.log(`node: ${nodeVersion}`);
  console.log(`npm: ${npmVersion}`);
  console.log(`git: ${gitVersion}`);
  console.log(`python: ${currentEnv.python_version || "not found"} (${python})`);
  console.log(`git_sha: ${currentEnv.git_sha || "not found"}`);
  console.log(`git_dirty: ${currentEnv.git_dirty === null ? "unknown" : String(currentEnv.git_dirty)}`);
  console.log(`pip_freeze_sha256: ${currentEnv.pip_freeze_sha256 || "not found"}`);
  console.log(`torch_version: ${currentEnv.torch_version || "not found"}`);
  console.log(`cuda_available: ${currentEnv.cuda_available === null ? "unknown" : String(currentEnv.cuda_available)}`);
  console.log(`cuda_version: ${currentEnv.cuda_version || "not found"}`);
  console.log(`gpu_device_names: ${Array.isArray(currentEnv.gpu_device_names) ? currentEnv.gpu_device_names.join(", ") : "not found"}`);
  console.log(`os: ${currentEnv.os}`);
  console.log(`hostname: ${currentEnv.hostname}`);

  if (latestRun && !latestRun.env) {
    console.error("WARNING: doctor latest run has no env capture.");
  } else if (latestRun?.env) {
    const mismatches = envMismatches(latestRun.env, currentEnv);
    for (const mismatch of mismatches) {
      console.error(
        `WARNING: doctor env mismatch ${mismatch.field}: stored=${formatEnvValue(mismatch.expected)} current=${formatEnvValue(mismatch.current)}`
      );
    }
  }
}

function formatReportNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  return num.toFixed(digits).replace(/\.?0+$/, "");
}

function formatReportSeconds(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

function formatReportCost(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `$${num.toFixed(4).replace(/\.?0+$/, "")}` : "—";
}

function markdownCell(value) {
  return String(value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(markdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runMetricValue(row, metricName) {
  if (metricName && row?.metrics && Object.prototype.hasOwnProperty.call(row.metrics, metricName)) {
    const raw = row.metrics[metricName];
    const value = metricNumber(raw);
    if (Number.isFinite(value)) return value;
  }
  if (row?.metrics) {
    for (const raw of Object.values(row.metrics)) {
      const num = metricNumber(raw);
      if (Number.isFinite(num)) return num;
    }
  }
  const fallback = metricNumber(row?.value);
  return Number.isFinite(fallback) ? fallback : Number.NaN;
}

function reportRunTimestamp(row) {
  return row?.timestamp || row?.ended_at || row?.started_at || "";
}

function compareMetricEntries(a, b, preferHigher) {
  return preferHigher ? b.value - a.value : a.value - b.value;
}

function buildReportMetricEntries(runs, metricName, preferHigher) {
  return runs
    .filter((row) => row && !row.parse_error)
    .map((row, index) => ({ row, index, value: runMetricValue(row, metricName) }))
    .filter((entry) => Number.isFinite(entry.value))
    .sort((a, b) => compareMetricEntries(a, b, preferHigher));
}

function renderMetricTrendSvg(entries, metricName, preferHigher) {
  if (!entries.length) return "";
  const chronological = entries.slice().sort((a, b) => a.index - b.index);
  const width = 760;
  const height = 320;
  const margin = { left: 58, right: 26, top: 34, bottom: 54 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = chronological.map((entry) => entry.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (index) => margin.left + (chronological.length === 1 ? plotW / 2 : (index / (chronological.length - 1)) * plotW);
  const y = (value) => margin.top + ((max - value) / (max - min)) * plotH;
  const points = chronological.map((entry, index) => `${x(index).toFixed(1)},${y(entry.value).toFixed(1)}`).join(" ");
  const best = entries[0];
  const statusColor = (status) => {
    const normalized = String(status || "").toLowerCase();
    if (normalized.includes("fail") || normalized.includes("timeout")) return "#ff8b8b";
    if (normalized.includes("running")) return "#71a7ff";
    if (normalized.includes("complete") || normalized.includes("promoted")) return "#62d6a6";
    return "#f6c177";
  };
  const circles = chronological.map((entry, index) => {
    const isBest = entry.row.id === best.row.id;
    return `<circle cx="${x(index).toFixed(1)}" cy="${y(entry.value).toFixed(1)}" r="${isBest ? 5 : 4}" fill="${statusColor(entry.row.status)}"><title>${xmlEscape(entry.row.id)} ${xmlEscape(metricName)}=${xmlEscape(formatReportNumber(entry.value))}</title></circle>`;
  }).join("\n    ");
  const title = `${metricName || "metric"} over runs (${preferHigher ? "higher is better" : "lower is better"})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(title)}">
  <rect width="100%" height="100%" fill="#071016"/>
  <text x="${margin.left}" y="22" fill="#edf3f8" font-family="Arial, sans-serif" font-size="16" font-weight="700">${xmlEscape(title)}</text>
  <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#40505c"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#40505c"/>
  <text x="10" y="${margin.top + 4}" fill="#9ba7b2" font-family="Arial, sans-serif" font-size="11">${xmlEscape(formatReportNumber(max))}</text>
  <text x="10" y="${margin.top + plotH}" fill="#9ba7b2" font-family="Arial, sans-serif" font-size="11">${xmlEscape(formatReportNumber(min))}</text>
  <polyline points="${points}" fill="none" stroke="#71a7ff" stroke-width="2.4"/>
  ${circles}
  <text x="${margin.left}" y="${height - 18}" fill="#9ba7b2" font-family="Arial, sans-serif" font-size="12">best: ${xmlEscape(best.row.id)} = ${xmlEscape(formatReportNumber(best.value))}</text>
</svg>
`;
}

function renderCurveOverlaySvg(traces, metricName) {
  const usable = traces.filter((trace) => Array.isArray(trace.values) && trace.values.length).slice(0, 5);
  if (!usable.length) return "";
  const width = 760;
  const height = 360;
  const margin = { left: 58, right: 150, top: 34, bottom: 50 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const allPoints = usable.flatMap((trace) => trace.values.map((point) => ({ step: Number(point.step), value: Number(point.value) })));
  let minX = Math.min(...allPoints.map((point) => point.step));
  let maxX = Math.max(...allPoints.map((point) => point.step));
  let minY = Math.min(...allPoints.map((point) => point.value));
  let maxY = Math.max(...allPoints.map((point) => point.value));
  if (minX === maxX) {
    minX = 0;
    maxX += 1;
  }
  if (minY === maxY) {
    minY -= 1;
    maxY += 1;
  }
  const x = (step) => margin.left + ((step - minX) / (maxX - minX)) * plotW;
  const y = (value) => margin.top + ((maxY - value) / (maxY - minY)) * plotH;
  const polylines = usable.map((trace) => {
    const points = trace.values
      .map((point) => `${x(Number(point.step)).toFixed(1)},${y(Number(point.value)).toFixed(1)}`)
      .join(" ");
    return `<polyline points="${points}" fill="none" stroke="${xmlEscape(trace.color || "#71a7ff")}" stroke-width="2.2"><title>${xmlEscape(trace.id)}</title></polyline>`;
  }).join("\n  ");
  const labels = usable.map((trace, index) => {
    const yPos = margin.top + 22 + index * 22;
    return `<circle cx="${width - 130}" cy="${yPos - 4}" r="4" fill="${xmlEscape(trace.color || "#71a7ff")}"/><text x="${width - 120}" y="${yPos}" fill="#cad4dc" font-family="Arial, sans-serif" font-size="12">${xmlEscape(trace.id)}</text>`;
  }).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xmlEscape(metricName)} curves">
  <rect width="100%" height="100%" fill="#071016"/>
  <text x="${margin.left}" y="22" fill="#edf3f8" font-family="Arial, sans-serif" font-size="16" font-weight="700">${xmlEscape(metricName || "metric")} curves</text>
  <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#40505c"/>
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#40505c"/>
  <text x="10" y="${margin.top + 4}" fill="#9ba7b2" font-family="Arial, sans-serif" font-size="11">${xmlEscape(formatReportNumber(maxY))}</text>
  <text x="10" y="${margin.top + plotH}" fill="#9ba7b2" font-family="Arial, sans-serif" font-size="11">${xmlEscape(formatReportNumber(minY))}</text>
  ${polylines}
  ${labels}
</svg>
`;
}

function writeReportPlots(cwd, outPath, entries, traces, metricName, preferHigher) {
  const reportDir = outPath ? path.dirname(outPath) : cwd;
  const assetsDir = path.join(reportDir, "report-assets");
  ensureDir(assetsDir);
  const written = [];
  const trendSvg = renderMetricTrendSvg(entries, metricName, preferHigher);
  if (trendSvg) {
    const file = path.join(assetsDir, "metric-trend.svg");
    fs.writeFileSync(file, trendSvg);
    written.push({ label: "Metric trend", path: path.relative(reportDir, file) });
  }
  const curvesSvg = renderCurveOverlaySvg(traces, metricName);
  if (curvesSvg) {
    const file = path.join(assetsDir, "loss-curves.svg");
    fs.writeFileSync(file, curvesSvg);
    written.push({ label: "Loss curves", path: path.relative(reportDir, file) });
  }
  return written;
}

function formatReportPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const sign = num > 0 ? "+" : "";
  return `${sign}${(num * 100).toFixed(2)}%`;
}

function renderMetricTierMarkdown(analysis) {
  const lines = [];
  lines.push("## Multi-Level Metric Score");
  lines.push("");
  lines.push(`- Profile: \`${analysis.profile}\` (${analysis.profile_label || "custom"})`);
  lines.push(`- Scoring target: ${analysis.selection_label || "single/latest run"}`);
  if (analysis.batch_queue_id) {
    lines.push(`- Batch queue: \`${analysis.batch_queue_id}\` (${analysis.batch_queue_status || "unknown"})`);
    if (analysis.batch_best_run_id) {
      lines.push(`- Batch best: \`${analysis.batch_best_run_id}\`${analysis.batch_queue_metric ? ` ${analysis.batch_queue_metric}=${formatReportNumber(analysis.batch_best_value)}` : ""}`);
    }
  }
  lines.push(`- Baseline: ${analysis.baseline_id ? `\`${analysis.baseline_id}\`` : "not available"}`);
  lines.push(`- Candidate: ${analysis.candidate_id ? `\`${analysis.candidate_id}\`` : "not available"}`);
  lines.push(`- Recommendation: **${analysis.recommendation.label}** — ${analysis.recommendation.reason}`);
  lines.push(`- Overall 5/3/2 score: ${formatReportNumber(analysis.overall_score)}`);
  lines.push("");
  lines.push(markdownTable(
    ["Tier", "Weight", "Available", "Avg improvement", "Weighted score"],
    analysis.levels.map((level) => [
      level.label,
      level.weight,
      `${level.available}/${level.metrics.length}`,
      formatReportPercent(level.avg_improvement),
      formatReportNumber(level.weighted_score),
    ])
  ));
  const metricRows = analysis.levels.flatMap((level) => level.metrics.map((metric) => [
    level.label,
    metric.name,
    metric.direction,
    metric.baseline === null ? "—" : formatReportNumber(metric.baseline),
    metric.current === null ? "—" : formatReportNumber(metric.current),
    metric.improvement === null ? "—" : formatReportPercent(metric.improvement),
  ]));
  if (metricRows.length) {
    lines.push("");
    lines.push(markdownTable(["Tier", "Metric", "Direction", "Baseline", "Candidate", "Improvement"], metricRows));
  }
  lines.push("");
  return lines.join("\n");
}

function optimizerSchedulerRowsFromConfig(config = {}) {
  const optimizer = config.resolvedOptimizer
    ? `${config.optimizer || "auto"} -> ${config.resolvedOptimizer}`
    : (config.optimizer || "auto");
  const scheduler = config.resolvedScheduler
    ? `${config.scheduler || "auto"} -> ${config.resolvedScheduler}`
    : (config.scheduler || "auto");
  const rows = [
    ["Task type", config.trainingTaskType || "auto"],
    ["Optimizer", optimizer],
    ["Advanced optimizer", config.advancedOptimizer || "none"],
    ["Learning rate", config.optimizerLearningRate || config.learningRate || "—"],
    ["Weight decay", config.optimizerWeightDecay || config.weightDecay || "—"],
    ["Betas", config.optimizerBetas || "—"],
    ["Eps", config.optimizerEps || "—"],
    ["Momentum", config.optimizerMomentum || "—"],
    ["LR scheduler", scheduler],
    ["Advanced scheduler", config.advancedScheduler || "none"],
    ["Warmup steps", config.schedulerWarmupSteps || "—"],
    ["Total steps", config.schedulerTotalSteps || "—"],
    ["Min LR", config.schedulerMinLr || "—"],
    ["Step size", config.schedulerStepSize || "—"],
    ["Gamma", config.schedulerGamma || "—"],
    ["Recommendation", config.optimizerRecommendation || "—"],
  ];
  return rows.filter(([, value]) => value !== "—" && value !== "" && value !== null && value !== undefined);
}

function renderOptimizerSchedulerMarkdown(config = {}) {
  const rows = optimizerSchedulerRowsFromConfig(config);
  if (!rows.length) return "";
  return [
    "## Optimizer / Scheduler Config",
    "",
    markdownTable(["Field", "Value"], rows),
    "",
  ].join("\n");
}

function renderMarkdownReport(cwd, runs, goal, plan, opts = {}) {
  const cleanRuns = runs.filter((row) => row && !row.parse_error);
  const dashboardConfig = readDashboardConfig(cwd);
  const primaryMetric = choosePrimaryMetric(goal, cleanRuns);
  const preferHigher = String(goal.direction || "").toLowerCase().includes("high");
  const entries = buildReportMetricEntries(cleanRuns, primaryMetric, preferHigher);
  const best = entries[0] || null;
  const worst = entries[entries.length - 1] || null;
  const traces = buildRunTraces({
    cwd,
    runs: cleanRuns,
    primaryMetric,
    preferHigher,
    readRunMetricSeries,
  });
  const plotRefs = opts.includePlots ? writeReportPlots(cwd, opts.outPath, entries, traces, primaryMetric, preferHigher) : [];
  const completeRuns = cleanRuns.filter((row) => ["complete", "completed", "promoted"].includes(String(row.status || "").toLowerCase()));
  const failedRuns = cleanRuns.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status.includes("fail") || status.includes("timeout") || status.includes("killed") || status.includes("no_metric");
  });
  const totalWallSeconds = cleanRuns.reduce((sum, row) => sum + (Number(row.wall_seconds) || 0), 0);
  const totalCost = cleanRuns.reduce((sum, row) => sum + (Number(row.est_cost_usd) || 0), 0);
  const totalGpuHours = cleanRuns.reduce((sum, row) => sum + (Number(row.gpu_hours) || 0), 0);
  const baselineRuns = cleanRuns.filter((row) => String(row.id || "").toLowerCase().includes("baseline") || String(row.agent || "").toLowerCase().includes("baseline"));
  const metricTierAnalysis = evaluateMetricTiers(cleanRuns, readMetricTierConfig(cwd), {
    batchQueue: readSelectedMetricTierBatchQueue(cwd, dashboardConfig),
  });
  const topRows = entries.slice(0, 5).map((entry, rank) => [
    rank + 1,
    `\`${entry.row.id}\``,
    entry.row.status || "unknown",
    formatReportNumber(entry.value),
    reportRunTimestamp(entry.row) || "—",
    formatReportSeconds(entry.row.wall_seconds),
    formatReportCost(entry.row.est_cost_usd),
  ]);
  const curveRows = traces.slice(0, 8).map((trace) => {
    const first = Number(trace.values?.[0]?.value);
    const final = Number(trace.final);
    const delta = Number.isFinite(first) && Number.isFinite(final)
      ? (preferHigher ? final - first : first - final)
      : Number.NaN;
    return [
      `\`${trace.id}\``,
      trace.values.length,
      formatReportNumber(first),
      formatReportNumber(final),
      formatReportNumber(delta),
      trace.status || "unknown",
    ];
  });
  const discardedRows = failedRuns.slice(-8).reverse().map((row) => [
    `\`${row.id}\``,
    row.status || "unknown",
    reportRunTimestamp(row) || "—",
    row.command || "—",
  ]);
  const appendixRows = cleanRuns.map((row) => [
    `\`${row.id}\``,
    row.status || "unknown",
    primaryMetric ? formatReportNumber(runMetricValue(row, primaryMetric)) : "—",
    reportRunTimestamp(row) || "—",
    row.parent_id ? `\`${row.parent_id}\`` : "—",
  ]);

  const lines = [];
  lines.push("# AutoResearch-AI Experiment Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Repository: \`${cwd}\``);
  lines.push(`Ledger: \`.researchloop/scratchpad/runs.jsonl\``);
  lines.push("");
  lines.push("## Goal");
  lines.push("");
  lines.push(goal.goal || "No goal text recorded.");
  lines.push("");
  lines.push(`- Target metric: ${primaryMetric ? `\`${primaryMetric}\`` : "not detected"}`);
  lines.push(`- Direction: ${preferHigher ? "higher is better" : "lower is better"}`);
  lines.push(`- Current best note: ${goal.currentBest || "not recorded"}`);
  lines.push(`- Time budget: ${normalizeTimeBudget(plan.timeBudget) || "not recorded"}`);
  lines.push("");
  lines.push("## Baseline");
  lines.push("");
  lines.push(`- Baseline command: ${goal.baseline ? `\`${goal.baseline}\`` : "not recorded"}`);
  lines.push(`- Evaluation command: ${goal.evaluation ? `\`${goal.evaluation}\`` : "not recorded"}`);
  if (baselineRuns.length) {
    lines.push("");
    lines.push(markdownTable(["Run", "Status", primaryMetric || "Metric", "Timestamp"], baselineRuns.map((row) => [
      `\`${row.id}\``,
      row.status || "unknown",
      primaryMetric ? formatReportNumber(runMetricValue(row, primaryMetric)) : "—",
      reportRunTimestamp(row) || "—",
    ])));
  } else {
    lines.push("");
    lines.push("No baseline run id was detected in the ledger. Record one with `autoresearch baseline` before treating wins as publishable.");
  }
  lines.push("");
  lines.push("## Best Run");
  lines.push("");
  if (best) {
    lines.push(`Best recorded run for \`${primaryMetric}\` is \`${best.row.id}\` with value ${formatReportNumber(best.value)}.`);
    if (worst && worst.row.id !== best.row.id) {
      const delta = preferHigher ? best.value - worst.value : worst.value - best.value;
      lines.push(`Between best run \`${best.row.id}\` and worst recorded run \`${worst.row.id}\`, the spread is ${formatReportNumber(delta)} ${primaryMetric}.`);
    }
    lines.push("");
    lines.push(markdownTable(["Rank", "Run", "Status", primaryMetric, "Timestamp", "Wall time", "Est. cost"], topRows));
  } else {
    lines.push("No numeric run metric was found yet.");
  }
  lines.push("");
  lines.push(renderMetricTierMarkdown(metricTierAnalysis));
  const optimizerMarkdown = renderOptimizerSchedulerMarkdown(dashboardConfig);
  if (optimizerMarkdown) lines.push(optimizerMarkdown);
  lines.push("## Sweep Summary");
  lines.push("");
  lines.push(markdownTable(["Metric", "Value"], [
    ["Runs total", cleanRuns.length],
    ["Completed", completeRuns.length],
    ["Discarded / failed", failedRuns.length],
    ["Parse errors", runs.filter((row) => row?.parse_error).length],
    ["Total wall time", formatReportSeconds(totalWallSeconds)],
    ["Estimated cost", totalCost > 0 ? formatReportCost(totalCost) : "—"],
    ["GPU-hours", totalGpuHours > 0 ? formatReportNumber(totalGpuHours) : "—"],
  ]));
  lines.push("");

  // Compute utilization — MFU per run when we have the inputs.
  const mfuRows = cleanRuns
    .map((r) => ({ row: r, mfu: computeMfuForRow(r, {}) }))
    .filter((e) => e.mfu && e.mfu.mfu !== null);
  if (mfuRows.length > 0) {
    lines.push("## Compute Utilization (MFU)");
    lines.push("");
    const tbl = mfuRows
      .sort((a, b) => b.mfu.mfu - a.mfu.mfu)
      .slice(0, 10)
      .map((e) => [
        `\`${e.row.id}\``,
        e.mfu.gpuName || "?",
        String(e.mfu.worldSize),
        ((e.mfu.achievedFlopsPerSec || 0) / 1e12).toFixed(1),
        e.mfu.peakTflopsSingle ? (e.mfu.peakTflopsSingle * e.mfu.worldSize).toFixed(0) : "?",
        `${(e.mfu.mfu * 100).toFixed(1)}%`,
      ]);
    lines.push(markdownTable(["Run", "GPU", "World", "TFLOP/s", "Peak TF/s", "MFU"], tbl));
    lines.push("");
    const sorted = mfuRows.map((e) => e.mfu.mfu).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    lines.push(`Median MFU across runs: **${(med * 100).toFixed(1)}%**${med < 0.20 ? " — likely dataloader-bound; profile with `nvidia-smi dmon`" : med < 0.35 ? " — try FlashAttention-2, torch.compile, fused optimizer" : med >= 0.45 ? " — well-tuned" : ""}.`);
    lines.push("");
  }

  // Overfit summaries — show only runs that have row.overfit attached (those
  // whose post-completion analyzeOverfit succeeded).
  const overfitRows = cleanRuns.filter((r) => r.overfit && (r.overfit.diverge_step !== null || r.overfit.wasted_fraction > 0.1));
  if (overfitRows.length > 0) {
    lines.push("## Overfit Watch");
    lines.push("");
    const tbl = overfitRows.slice(0, 10).map((r) => [
      `\`${r.id}\``,
      r.overfit.val_best_step,
      formatReportNumber(r.overfit.val_best_value),
      r.overfit.diverge_step ?? "—",
      `${(r.overfit.wasted_fraction * 100).toFixed(1)}%`,
    ]);
    lines.push(markdownTable(["Run", "Val best step", "Val best value", "Diverged at", "Wasted compute"], tbl));
    lines.push("");
    lines.push("Run `autoresearch overfit-watch <run-id>` for the full breakdown.");
    lines.push("");
  }

  lines.push("## Loss Curves");
  lines.push("");
  if (plotRefs.length) {
    for (const ref of plotRefs) {
      lines.push(`![${ref.label}](${ref.path})`);
      lines.push("");
    }
  } else if (opts.includePlots) {
    lines.push("No plottable metric series was available for SVG output.");
    lines.push("");
  }
  if (curveRows.length) {
    lines.push(markdownTable(["Run", "Points", "First", "Final", preferHigher ? "Gain" : "Drop", "Status"], curveRows));
  } else {
    lines.push("No metric curves were found. Runs with stdout metrics still appear in the best-run table.");
  }
  lines.push("");
  lines.push("## Discarded Results");
  lines.push("");
  if (discardedRows.length) {
    lines.push(markdownTable(["Run", "Status", "Timestamp", "Command"], discardedRows));
  } else {
    lines.push("No failed, timed-out, killed, or no-metric runs are recorded.");
  }
  lines.push("");
  lines.push("## Open Questions");
  lines.push("");
  if (best) {
    lines.push(`- Reproduce best run \`${best.row.id}\` with \`autoresearch verify --id ${best.row.id}\` before claiming it as real.`);
  } else {
    lines.push("- Record at least one numeric run before making a research claim.");
  }
  lines.push("- If the result depends on random seeds, run `autoresearch run --seeds N` and compare the aggregate row.");
  lines.push("- If cost matters, keep `.researchloop/cost.yaml` current so future reports include a real estimate.");
  lines.push("- Promote or discard the next candidate explicitly so the loop has a clean next state.");
  lines.push("");
  lines.push("## Appendix: Run Ledger Index");
  lines.push("");
  if (appendixRows.length) {
    lines.push(markdownTable(["Run", "Status", primaryMetric || "Metric", "Timestamp", "Parent"], appendixRows));
  } else {
    lines.push("No runs recorded.");
  }
  lines.push("");
  return lines.join("\n");
}

function latestSweepReportRows(cwd, limit = 5) {
  const sweepDir = path.join(cwd, ".researchloop", "scratchpad", "sweeps");
  if (!fs.existsSync(sweepDir)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(sweepDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const report = path.join(sweepDir, entry.name, "sweep-report.md");
    if (!fs.existsSync(report)) continue;
    try {
      const stat = fs.statSync(report);
      rows.push({
        label: `Sweep report: ${entry.name}`,
        path: path.relative(cwd, report),
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // Ignore incomplete sweep directories.
    }
  }
  return rows
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map(({ mtimeMs, ...row }) => row);
}

function existingArtifactRows(cwd, envFiles = null) {
  const candidates = [
    ["Run ledger", ".researchloop/scratchpad/runs.jsonl"],
    ["Dashboard experiment report", ".researchloop/scratchpad/dashboard-report.md"],
    ["Performance analysis", ".researchloop/scratchpad/performance-analysis.md"],
    ["Environment report", envFiles?.markdown || ".researchloop/env/environment.md"],
    ["Environment JSON", envFiles?.json || ".researchloop/env/environment.json"],
  ];
  const rows = [];
  for (const [label, rel] of candidates) {
    const file = path.join(cwd, rel);
    if (!fs.existsSync(file)) continue;
    try {
      const stat = fs.statSync(file);
      rows.push([label, rel, formatBytesCompact(stat.size)]);
    } catch {
      rows.push([label, rel, "—"]);
    }
  }
  for (const row of latestSweepReportRows(cwd, 5)) {
    rows.push([row.label, row.path, row.mtime]);
  }
  return rows;
}

function renderPortfolioReport(cwd, runs, goal, plan, dashboardConfig, aiInfraReport, envFiles = null) {
  const cleanRuns = runs.filter((row) => row && !row.parse_error);
  const primaryMetric = choosePrimaryMetric(goal, cleanRuns);
  const direction = String(goal.direction || dashboardConfig.direction || "").toLowerCase();
  const preferHigher = direction.includes("high") || direction.includes("max");
  const entries = buildReportMetricEntries(cleanRuns, primaryMetric, preferHigher);
  const best = entries[0] || null;
  const worst = entries[entries.length - 1] || null;
  const completeRuns = cleanRuns.filter((row) => ["complete", "completed", "promoted"].includes(String(row.status || "").toLowerCase()));
  const failedRuns = cleanRuns.filter((row) => {
    const status = String(row.status || "").toLowerCase();
    return status.includes("fail") || status.includes("timeout") || status.includes("killed") || status.includes("no_metric");
  });
  const metricTierConfig = readMetricTierConfig(cwd, dashboardConfig.metricProfile || "hpc_operator");
  const metricTierAnalysis = evaluateMetricTiers(cleanRuns, metricTierConfig, {
    batchQueue: readSelectedMetricTierBatchQueue(cwd, dashboardConfig),
  });
  const optimizerRows = optimizerSchedulerRowsFromConfig(dashboardConfig);
  const artifactRows = existingArtifactRows(cwd, envFiles);
  const topRows = entries.slice(0, 8).map((entry, index) => [
    index + 1,
    `\`${entry.row.id}\``,
    entry.row.status || "unknown",
    primaryMetric || "metric",
    formatReportNumber(entry.value),
    reportRunTimestamp(entry.row) || "—",
  ]);
  const recentRows = cleanRuns.slice(-8).reverse().map((row) => [
    `\`${row.id || "unknown"}\``,
    row.status || "unknown",
    row.command || "—",
    reportRunTimestamp(row) || "—",
  ]);
  const readinessRows = Object.entries(aiInfraReport.readiness || {}).map(([key, item]) => [
    key,
    item.status,
    item.evidence,
  ]);
  const recommendationRows = [];
  if (!best) recommendationRows.push("Record at least one numeric run before using this as external project evidence.");
  if (best) recommendationRows.push(`Verify the current best run \`${best.row.id}\` before making a performance claim.`);
  if (!cleanRuns.some(isBaselineRow)) recommendationRows.push("Record a clear baseline run so future reports can separate baseline and optimized candidates.");
  if (failedRuns.length) recommendationRows.push(`Review ${failedRuns.length} failed or no-metric run(s) before exporting a final README.`);
  if (!aiInfraReport.aiInfra?.cudaLocalReady && !aiInfraReport.aiInfra?.remoteCudaConfigured) {
    recommendationRows.push("Keep Apple Silicon tests local; configure a remote NVIDIA Linux host for real CUDA/Nsight evidence.");
  }
  if (!artifactRows.some((row) => row[0] === "Dashboard experiment report")) {
    recommendationRows.push("Generate the dashboard experiment report once so this portfolio links to a full run comparison.");
  }

  const lines = [];
  lines.push("# AutoResearch-AI Portfolio Evidence");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Project: \`${cwd}\``);
  lines.push(`Recommended execution mode: \`${aiInfraReport.aiInfra?.recommendedExecutionMode || "unknown"}\``);
  lines.push("");
  lines.push("## Project Story");
  lines.push("");
  lines.push(goal.goal || "No project goal has been recorded yet.");
  lines.push("");
  lines.push(markdownTable(["Field", "Value"], [
    ["Primary metric", primaryMetric || "not detected"],
    ["Direction", preferHigher ? "higher is better" : "lower is better"],
    ["Runs recorded", cleanRuns.length],
    ["Completed runs", completeRuns.length],
    ["Failed / no-metric runs", failedRuns.length],
    ["Time budget", normalizeTimeBudget(plan.timeBudget) || "not recorded"],
  ]));
  lines.push("");
  lines.push("## Best Evidence");
  lines.push("");
  if (best) {
    lines.push(`Best recorded run is \`${best.row.id}\` with \`${primaryMetric}\` = ${formatReportNumber(best.value)}.`);
    if (worst && worst.row.id !== best.row.id) {
      const spread = preferHigher ? best.value - worst.value : worst.value - best.value;
      lines.push(`The spread between best and worst recorded runs is ${formatReportNumber(spread)}.`);
    }
    lines.push("");
    lines.push(markdownTable(["Rank", "Run", "Status", "Metric", "Value", "Timestamp"], topRows));
  } else {
    lines.push("No numeric metric is available yet.");
  }
  lines.push("");
  lines.push("## Multi-Level Metric Decision");
  lines.push("");
  lines.push(`- Profile: \`${metricTierAnalysis.profile}\` (${metricTierAnalysis.profile_label || "custom"})`);
  lines.push(`- Recommendation: **${metricTierAnalysis.recommendation.label}** — ${metricTierAnalysis.recommendation.reason}`);
  lines.push(`- Overall score: ${formatReportNumber(metricTierAnalysis.overall_score)}`);
  lines.push("");
  lines.push(markdownTable(
    ["Tier", "Weight", "Available", "Avg improvement"],
    metricTierAnalysis.levels.map((level) => [
      level.label,
      level.weight,
      `${level.available}/${level.metrics.length}`,
      formatReportPercent(level.avg_improvement),
    ])
  ));
  if (optimizerRows.length) {
    lines.push("");
    lines.push("## Optimizer / Scheduler");
    lines.push("");
    lines.push(markdownTable(["Field", "Value"], optimizerRows));
  }
  lines.push("");
  lines.push("## Environment Readiness");
  lines.push("");
  lines.push(markdownTable(["Area", "Status", "Evidence"], readinessRows));
  lines.push("");
  lines.push("## Evidence Artifacts");
  lines.push("");
  if (artifactRows.length) {
    lines.push(markdownTable(["Artifact", "Path", "Size / Time"], artifactRows));
  } else {
    lines.push("No export artifacts were found yet.");
  }
  lines.push("");
  lines.push("## Recent Runs");
  lines.push("");
  if (recentRows.length) {
    lines.push(markdownTable(["Run", "Status", "Command", "Timestamp"], recentRows));
  } else {
    lines.push("No runs recorded.");
  }
  lines.push("");
  lines.push("## Next Actions");
  lines.push("");
  for (const item of recommendationRows.length ? recommendationRows : ["Keep this report with the project README after reproducing the best run."]) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

function writePortfolioReport(cwd, opts = {}) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const runs = parseRunsLedger(ledger);
  const goal = parseGoalFile(path.join(cwd, ".researchloop", "goal.md"));
  const plan = parsePlanFile(path.join(cwd, ".researchloop", "plan.md"));
  const dashboardConfig = readDashboardConfig(cwd);
  const aiInfraReport = buildAiInfraReport(cwd, { python: opts.python || "python3" });
  const envFiles = opts.writeEnv === false ? null : writeAiInfraReport(cwd, aiInfraReport);
  const outPath = opts.out
    ? path.resolve(cwd, String(opts.out))
    : path.join(cwd, ".researchloop", "scratchpad", "portfolio-report.md");
  ensureDir(path.dirname(outPath));
  const markdown = `${renderPortfolioReport(cwd, runs, goal, plan, dashboardConfig, aiInfraReport, envFiles)}\n`;
  fs.writeFileSync(outPath, markdown);
  return {
    out: path.relative(cwd, outPath),
    env: envFiles,
    runs: runs.filter((row) => row && !row.parse_error).length,
  };
}

function cmdPortfolio() {
  const cwd = targetDir();
  const outFile = option("--out", null);
  const written = writePortfolioReport(cwd, {
    out: outFile,
    python: String(option("--python", "python3")),
    writeEnv: !hasFlag("--no-env"),
  });
  console.log(`portfolio: ${written.out}`);
  if (written.env?.markdown) console.log(`environment: ${written.env.markdown}`);
}

function cmdReport() {
  const cwd = targetDir();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) {
    console.log("No run ledger found. Run `autoresearch init` first.");
    return;
  }
  const format = String(option("--format", "text")).toLowerCase();
  const outFile = option("--out", null);
  const includePlots = hasFlag("--include-plots");
  const rows = fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean);
  const parsed = rows.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      return { parse_error: true, raw: row };
    }
  });
  if (format === "markdown" || outFile || includePlots) {
    const outPath = outFile
      ? path.resolve(cwd, String(outFile))
      : null;
    const goal = parseGoalFile(path.join(cwd, ".researchloop", "goal.md"));
    const plan = parsePlanFile(path.join(cwd, ".researchloop", "plan.md"));
    const markdown = `${renderMarkdownReport(cwd, parsed, goal, plan, { includePlots, outPath })}\n`;
    if (outPath) {
      ensureDir(path.dirname(outPath));
      fs.writeFileSync(outPath, markdown);
      console.log(`report: ${path.relative(cwd, outPath)}`);
    } else {
      process.stdout.write(markdown);
    }
    return;
  }
  if (format !== "text") {
    console.error("Usage: autoresearch report [--format text|markdown] [--out report.md] [--include-plots] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  const errors = parsed.filter((row) => row.parse_error).length;
  const complete = parsed.filter((row) => row.status === "complete" || row.status === "completed").length;
  console.log(`runs: ${rows.length}`);
  console.log(`complete: ${complete}`);
  console.log(`parse_errors: ${errors}`);
  const totalWallSeconds = parsed.filter((r) => r && !r.parse_error && r.wall_seconds).reduce((s, r) => s + (r.wall_seconds || 0), 0);
  if (totalWallSeconds > 0) {
    console.log(`wall_time: ${Math.round(totalWallSeconds)}s total`);
  }
  const costRows = parsed
    .filter((r) => r && !r.parse_error)
    .map((r) => Number(r.est_cost_usd))
    .filter((v) => Number.isFinite(v));
  if (costRows.length > 0) {
    const totalEstimatedCost = costRows.reduce((sum, value) => sum + value, 0);
    console.log(`estimated_cost_usd: ${totalEstimatedCost.toFixed(4)} total`);
  }
  if (parsed.length) {
    const last = parsed[parsed.length - 1];
    console.log(`last: ${JSON.stringify(last, null, 2)}`);
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectLedgerMetricValues(runs) {
  const values = [];
  for (const row of runs) {
    if (!row || row.parse_error) continue;
    const metrics = row.metrics || {};
    for (const [metric, raw] of Object.entries(metrics)) {
      if (!isNumericMetric(raw)) continue;
      values.push({ runId: row.id, metric, value: metricNumber(raw) });
    }
    if (isNumericMetric(row.value)) {
      values.push({ runId: row.id, metric: "value", value: metricNumber(row.value) });
    }
  }
  return values;
}

function findClaimMatch({ claimValue, isPercent, lineIds, metricValues, tolerance }) {
  const candidateValues = isPercent ? [claimValue, claimValue / 100] : [claimValue];
  const directPool = lineIds.length
    ? metricValues.filter((entry) => lineIds.includes(String(entry.runId)))
    : metricValues;
  for (const wanted of candidateValues) {
    for (const entry of directPool) {
      if (Math.abs(entry.value - wanted) <= tolerance) {
        return `${entry.runId}:${entry.metric}`;
      }
    }
  }

  if (lineIds.length >= 2) {
    const byId = new Map();
    for (const entry of metricValues) {
      if (!byId.has(String(entry.runId))) byId.set(String(entry.runId), []);
      byId.get(String(entry.runId)).push(entry);
    }
    for (let i = 0; i < lineIds.length; i += 1) {
      for (let j = i + 1; j < lineIds.length; j += 1) {
        const left = byId.get(String(lineIds[i])) || [];
        const right = byId.get(String(lineIds[j])) || [];
        for (const a of left) {
          for (const b of right) {
            if (a.metric !== b.metric) continue;
            const delta = Math.abs(a.value - b.value);
            for (const wanted of candidateValues) {
              if (Math.abs(delta - wanted) <= tolerance) {
                return `${a.runId},${b.runId}:${a.metric}_delta`;
              }
            }
          }
        }
      }
    }
  }

  return null;
}

function auditMarkdownClaims(markdown, runs, tolerance) {
  const metricValues = collectLedgerMetricValues(runs);
  const knownRunIds = [...new Set(runs.filter((row) => row && !row.parse_error && row.id).map((row) => String(row.id)))];
  const metricKeywords = new Set(["loss", "accuracy", "acc", "perplexity", "ppl", "f1", "precision", "recall", "auc", "bleu", "rouge", "metric"]);
  for (const entry of metricValues) {
    metricKeywords.add(String(entry.metric).toLowerCase());
  }
  const claims = [];
  const lines = String(markdown || "").split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const originalLine = lines[idx];
    const lower = originalLine.toLowerCase();
    if (![...metricKeywords].some((keyword) => lower.includes(keyword))) continue;

    const lineIds = knownRunIds
      .filter((id) => originalLine.includes(id))
      .sort((a, b) => originalLine.indexOf(a) - originalLine.indexOf(b));
    let scanLine = originalLine.replace(/`[^`]*`/g, " ");
    for (const id of knownRunIds) {
      scanLine = scanLine.replace(new RegExp(escapeRegExp(id), "g"), " ");
    }
    const numberRegex = /(?<![A-Za-z_])-?\d+(?:\.\d+)?%?/g;
    const matches = scanLine.match(numberRegex) || [];
    for (const raw of matches) {
      const isPercent = raw.endsWith("%");
      const claimValue = Number(raw.replace(/%$/, ""));
      if (!Number.isFinite(claimValue)) continue;
      const matched = findClaimMatch({ claimValue, isPercent, lineIds, metricValues, tolerance });
      claims.push({
        line: idx + 1,
        value: raw,
        matched,
        text: originalLine.trim(),
      });
    }
  }
  return claims;
}

function cmdAudit() {
  const cwd = targetDir();
  const fileArg = positionalText(["--dir", "--tolerance"]);
  const tolerance = Number(option("--tolerance", "0.001"));
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  if (!fileArg) {
    console.error("Usage: autoresearch audit <file.md> [--tolerance N] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    console.error("audit: --tolerance must be a non-negative number");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found.");
    process.exitCode = 1;
    return;
  }
  const filePath = path.resolve(cwd, String(fileArg));
  if (!fs.existsSync(filePath)) {
    console.error(`audit: file not found: ${fileArg}`);
    process.exitCode = 1;
    return;
  }

  const runs = parseRunsLedger(ledger);
  const claims = auditMarkdownClaims(readTextIfExists(filePath), runs, tolerance);
  if (!claims.length) {
    console.log("No numeric metric claims found.");
    return;
  }

  console.log(markdownTable(
    ["claim_line", "claim_value", "matched_run_id_or_null", "text"],
    claims.map((claim) => [
      claim.line,
      claim.value,
      claim.matched || "null",
      claim.text,
    ])
  ));
  const unmatched = claims.filter((claim) => !claim.matched);
  if (unmatched.length) {
    console.error(`audit: ${unmatched.length} unmatched numeric metric claim(s)`);
    process.exitCode = 1;
  }
}

function cmdDiffRuns() {
  const cwd = targetDir();
  const diffRunsIdx = args.findIndex((a) => a === "diff-runs");
  const runIdA = String(option("--id-a", diffRunsIdx !== -1 && args[diffRunsIdx + 1] ? args[diffRunsIdx + 1] : ""));
  const runIdB = String(option("--id-b", diffRunsIdx !== -1 && args[diffRunsIdx + 2] ? args[diffRunsIdx + 2] : ""));
  const format = String(option("--format", "text")).toLowerCase();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  if (!runIdA || !runIdB) {
    console.error("Usage: autoresearch diff-runs --id-a <id> --id-b <id> [--format text|json|markdown] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found.");
    process.exitCode = 1;
    return;
  }

  const rows = parseRunsLedger(ledger);
  const rowA = rows.find((r) => r && !r.parse_error && String(r.id) === String(runIdA)) || null;
  const rowB = rows.find((r) => r && !r.parse_error && String(r.id) === String(runIdB)) || null;

  if (!rowA) { console.error("Run not found: " + runIdA); process.exitCode = 1; return; }
  if (!rowB) { console.error("Run not found: " + runIdB); process.exitCode = 1; return; }

  const identical = JSON.stringify(rowA) === JSON.stringify(rowB);

  const allParamKeys = new Set([...Object.keys(rowA.params || {}), ...Object.keys(rowB.params || {})]);
  const paramDiffs = [];
  for (const key of allParamKeys) {
    const valA = rowA.params?.[key];
    const valB = rowB.params?.[key];
    if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      paramDiffs.push({ key, a: valA, b: valB });
    }
  }

  const allMetricKeys = new Set([...Object.keys(rowA.metrics || {}), ...Object.keys(rowB.metrics || {})]);
  const metricDiffs = [];
  for (const key of allMetricKeys) {
    const valA = metricNumber(rowA.metrics?.[key]);
    const valB = metricNumber(rowB.metrics?.[key]);
    if (Number.isFinite(valA) && Number.isFinite(valB)) {
      const delta = valB - valA;
      const arrow = delta > 0 ? "\u2191" : delta < 0 ? "\u2193" : " ";
      metricDiffs.push({ key, a: valA, b: valB, delta, arrow });
    } else {
      metricDiffs.push({ key, a: valA, b: valB, delta: null, arrow: "?" });
    }
  }

  const envFields = ["git_sha", "python_version", "pip_freeze_sha256", "torch_version", "cuda_available", "os", "hostname"];
  const envDiffs = [];
  for (const field of envFields) {
    const valA = rowA.env?.[field];
    const valB = rowB.env?.[field];
    if (JSON.stringify(valA) !== JSON.stringify(valB)) {
      envDiffs.push({ field, a: valA, b: valB });
    }
  }

  let codeDiffA = null;
  let codeDiffB = null;
  const runDirA = path.join(cwd, ".researchloop", "scratchpad", "runs", String(rowA.id));
  const runDirB = path.join(cwd, ".researchloop", "scratchpad", "runs", String(rowB.id));
  if (fs.existsSync(path.join(runDirA, "code.diff"))) {
    codeDiffA = fs.readFileSync(path.join(runDirA, "code.diff"), "utf8");
  }
  if (fs.existsSync(path.join(runDirB, "code.diff"))) {
    codeDiffB = fs.readFileSync(path.join(runDirB, "code.diff"), "utf8");
  }
  const codeChanged = codeDiffA !== codeDiffB;

  const dataFpA = rowA.data_fingerprint || null;
  const dataFpB = rowB.data_fingerprint || null;
  const dataFingerprintChanged = dataFpA !== null && dataFpB !== null && dataFpA !== dataFpB;

  if (format === "json") {
    const out = {
      id_a: runIdA,
      id_b: runIdB,
      identical,
      params: { diffs: paramDiffs, changed: paramDiffs.length > 0 },
      metrics: { diffs: metricDiffs, changed: metricDiffs.some((m) => m.delta !== 0) },
      env: { diffs: envDiffs, changed: envDiffs.length > 0 },
      code_diff: { changed: codeChanged, a: codeDiffA, b: codeDiffB },
      data_fingerprint: { changed: dataFingerprintChanged, a: dataFpA, b: dataFpB },
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (format === "markdown") {
    const lines = [
      "## Run Diff: " + runIdA + " vs " + runIdB,
      "",
      "| Section | Status |",
      "| --- | --- |",
      "| Params | " + (identical ? "identical" : paramDiffs.length === 0 ? "identical" : paramDiffs.length + " change(s)") + " |",
      "| Metrics | " + (identical ? "identical" : metricDiffs.filter((m) => m.delta !== 0).length === 0 ? "identical" : metricDiffs.filter((m) => m.delta !== 0).length + " change(s)") + " |",
      "| Env | " + (identical ? "identical" : envDiffs.length === 0 ? "identical" : envDiffs.length + " difference(s)") + " |",
      "| Code | " + (identical ? "identical" : codeChanged ? "changed" : "unchanged") + " |",
      "| Data fingerprint | " + (dataFpA === dataFpB ? "identical" : dataFingerprintChanged ? "changed" : "N/A") + " |",
      "",
    ];
    if (!identical && paramDiffs.length > 0) {
      lines.push("### Params Diff", "");
      lines.push("| Param | Run A | Run B |", "| --- | --- | --- |");
      for (const d of paramDiffs) {
        lines.push("| " + d.key + " | " + JSON.stringify(d.a) + " | " + JSON.stringify(d.b) + " |");
      }
      lines.push("");
    }
    if (!identical && metricDiffs.length > 0) {
      lines.push("### Metrics Diff", "");
      lines.push("| Metric | Run A | Run B | Delta | Direction |", "| --- | --- | --- | --- | --- |");
      for (const m of metricDiffs) {
        const deltaStr = m.delta !== null && Number.isFinite(m.delta) ? m.delta.toFixed(4) : "N/A";
        lines.push("| " + m.key + " | " + m.a + " | " + m.b + " | " + deltaStr + " | " + m.arrow + " |");
      }
      lines.push("");
    }
    if (!identical && envDiffs.length > 0) {
      lines.push("### Env Diff", "");
      lines.push("| Field | Run A | Run B |", "| --- | --- | --- |");
      for (const d of envDiffs) {
        lines.push("| " + d.field + " | " + JSON.stringify(d.a) + " | " + JSON.stringify(d.b) + " |");
      }
      lines.push("");
    }
    if (!identical && codeChanged && codeDiffA !== null && codeDiffB !== null) {
      lines.push("### Code Diff", "");
      lines.push("```diff");
      lines.push("--- run " + runIdA);
      lines.push("+++ run " + runIdB);
      lines.push("```");
      lines.push("");
    }
    if (!identical && dataFingerprintChanged) {
      lines.push("### Data Fingerprint Diff", "");
      lines.push("- Run A: " + dataFpA);
      lines.push("- Run B: " + dataFpB);
      lines.push("");
    }
    if (identical) {
      lines.push("*All sections are identical.*");
    }
    process.stdout.write(lines.join("\n") + "\n");
    return;
  }

  console.log("=== Run Diff: " + runIdA + " vs " + runIdB + " ===");
  if (identical) {
    console.log("Status: IDENTICAL (all sections match)");
    return;
  }
  if (paramDiffs.length > 0) {
    console.log("\n--- Params Diff ---");
    for (const d of paramDiffs) {
      console.log("  " + d.key + ": " + JSON.stringify(d.a) + " -> " + JSON.stringify(d.b));
    }
  }
  if (metricDiffs.length > 0) {
    console.log("\n--- Metrics Diff ---");
    for (const m of metricDiffs) {
      const deltaStr = m.delta !== null && Number.isFinite(m.delta)
        ? (m.delta > 0 ? "+" : "") + m.delta.toFixed(4)
        : "N/A";
      console.log("  " + m.key + ": " + m.a + " -> " + m.b + " (" + deltaStr + ") " + m.arrow);
    }
  }
  if (envDiffs.length > 0) {
    console.log("\n--- Env Diff ---");
    for (const d of envDiffs) {
      console.log("  " + d.field + ": " + JSON.stringify(d.a) + " -> " + JSON.stringify(d.b));
    }
  }
  if (codeChanged) {
    console.log("\n--- Code Diff ---");
    if (codeDiffA !== null && codeDiffB !== null) {
      console.log("  code.diff: run " + runIdA + " and run " + runIdB + " differ");
    } else if (codeDiffA !== null) {
      console.log("  code.diff: present in run " + runIdA + ", absent in run " + runIdB);
    } else if (codeDiffB !== null) {
      console.log("  code.diff: absent in run " + runIdA + ", present in run " + runIdB);
    }
  }
  if (dataFingerprintChanged) {
    console.log("\n--- Data Fingerprint Diff ---");
    console.log("  data_fingerprint: " + dataFpA + " -> " + dataFpB);
  }
}

function cmdModelCard() {
  const cwd = targetDir();
  const runId = String(option("--id", ""));
  const outFile = option("--out", null);
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  if (!runId) {
    console.error("Usage: autoresearch model-card --id <run-id> [--out FILE.md] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found.");
    process.exitCode = 1;
    return;
  }

  const rows = parseRunsLedger(ledger);
  const row = rows.find((r) => r && !r.parse_error && String(r.id) === String(runId)) || null;
  if (!row) {
    console.error("Run not found: " + runId);
    process.exitCode = 1;
    return;
  }

  const metrics = row.metrics || {};
  const env = row.env || {};
  const params = row.params || {};

  const lines = [
    "# Model Card",
    "",
    "## Model Details",
    "",
    "**Run ID:** " + row.id,
    "**Status:** " + (row.status || "unknown"),
    "**Timestamp:** " + (row.timestamp || "unknown"),
    "",
    params && Object.keys(params).length
      ? "**Parameters:**\n" + Object.entries(params).map(([k, v]) => "- " + k + ": " + JSON.stringify(v)).join("\n")
      : "**Parameters:** [TODO: fill in]",
    "",
    "## Intended Use",
    "",
    "[TODO: fill in]",
    "",
    "## Training Data",
    "",
    "**Data Fingerprint:** " + (row.data_fingerprint || "[TODO: compute with data-fingerprint command]"),
    "",
    "[TODO: document training data sources, size, and preprocessing]",
    "",
    "## Evaluation Results",
    "",
  ];

  const metricLines = Object.entries(metrics)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => "- **" + k + ":** " + v);
  if (metricLines.length) {
    lines.push("| Metric | Value |", "| --- | --- |");
    for (const [k, v] of Object.entries(metrics)) {
      if (v !== null && v !== undefined) {
        lines.push("| " + k + " | " + v + " |");
      }
    }
  } else {
    lines.push("[TODO: fill in evaluation metrics]");
  }

  lines.push("");
  lines.push("## Limitations");
  lines.push("");
  lines.push("[TODO: fill in known limitations]");
  lines.push("");
  lines.push("## Ethical Considerations");
  lines.push("");
  lines.push("[TODO: fill in ethical considerations]");
  lines.push("");
  lines.push("## Hardware & Software Stack");
  lines.push("");
  lines.push("| Component | Value |", "| --- | --- |");
  if (env.os) lines.push("| OS | " + env.os + " |");
  if (env.python_version) lines.push("| Python | " + env.python_version + " |");
  if (env.torch_version) lines.push("| PyTorch | " + env.torch_version + " |");
  if (env.cuda_available) lines.push("| CUDA | " + (env.cuda_version || "available") + " |");
  if (env.hostname) lines.push("| Hostname | " + env.hostname + " |");
  if (env.git_sha) lines.push("| Git SHA | " + env.git_sha + " |");
  if (env.git_dirty !== undefined) lines.push("| Working Tree | " + (env.git_dirty ? "dirty" : "clean") + " |");
  if (!env.os && !env.python_version) {
    lines.push("| Hardware | [TODO: fill in] |");
    lines.push("| Software | [TODO: fill in] |");
  }

  const output = lines.join("\n") + "\n";

  if (outFile) {
    fs.writeFileSync(outFile, output);
    console.log("Model card written to " + outFile);
  } else {
    process.stdout.write(output);
  }
}

function cmdPrune() {
  const cwd = targetDir();
  const olderThan = option("--older-than", "30d");
  const statusFilter = option("--status", "discarded");
  const dryRun = hasFlag("--dry-run");
  const keepPromoted = !hasFlag("--no-keep-promoted");
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const runsDir = path.join(cwd, ".researchloop", "scratchpad", "runs");

  if (!fs.existsSync(ledger)) {
    console.log("No runs recorded.");
    return;
  }

  const match = olderThan.match(/^(\d+)(d|h)$/);
  if (!match) {
    console.error("Invalid --older-than format. Use Nd or Nh (e.g. 30d, 24h).");
    process.exitCode = 1;
    return;
  }
  const value = parseInt(match[1]);
  const unit = match[2];
  const nowMs = Date.now();
  const cutoffMs = nowMs - (unit === "d" ? value * 86400000 : value * 3600000);

  const rows = parseRunsLedger(ledger);
  const toPrune = [];

  for (const row of rows) {
    if (!row || row.parse_error) continue;
    if (row.pruned) continue;
    if (statusFilter && row.status !== statusFilter) continue;
    if (keepPromoted && (row.status === "promoted" || row.status === "kept")) continue;
    const ts = row.timestamp ? new Date(row.timestamp).getTime() : 0;
    if (ts < cutoffMs) {
      toPrune.push(row);
    }
  }

  if (toPrune.length === 0) {
    console.log("No runs match the criteria.");
    return;
  }

  let totalSize = 0;
  const dirsToDelete = [];

  for (const row of toPrune) {
    const runPath = path.join(runsDir, String(row.id));
    if (fs.existsSync(runPath)) {
      let size = 0;
      try {
        const stat = fs.statSync(runPath);
        if (stat.isDirectory()) {
          size = getDirSize(runPath);
        }
      } catch { /* skip */ }
      totalSize += size;
      dirsToDelete.push({ row, runPath, size });
    }
  }

  const sizeStr = totalSize >= 1073741824
    ? (totalSize / 1073741824).toFixed(2) + " GB"
    : (totalSize / 1048576).toFixed(1) + " MB";

  if (dryRun) {
    console.log("Dry run — would prune " + toPrune.length + " run(s), reclaim " + sizeStr + ":");
    for (const { row, runPath, size } of dirsToDelete) {
      const s = size >= 1048576 ? (size / 1048576).toFixed(1) + " MB" : (size / 1024).toFixed(0) + " KB";
      console.log("  " + row.id + " (" + s + ") — " + row.status);
    }
    return;
  }

  let deleted = 0;
  for (const { row, runPath } of dirsToDelete) {
    try {
      fs.rmSync(runPath, { recursive: true, force: true });
      deleted++;
    } catch { /* skip */ }
  }

  const updatedRows = rows.map((row) => {
    if (!row || row.parse_error) return row;
    if (toPrune.some((p) => p.id === row.id)) {
      return { ...row, pruned: true, pruned_at: new Date().toISOString() };
    }
    return row;
  });

  const tmpLedger = ledger + ".prune_tmp";
  fs.writeFileSync(tmpLedger, updatedRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.renameSync(tmpLedger, ledger);

  console.log("Pruned " + deleted + " run(s), reclaimed " + sizeStr + ".");
}

function getDirSize(dir) {
  let size = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        size += getDirSize(full);
      } else if (entry.isFile()) {
        try { size += fs.statSync(full).size; } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }
  return size;
}

function parseDataGlobs(raw) {
  const match = raw.match(/^data_globs:\s*([\s\S]*?)(?=^\w|\n#|$)/mi);
  if (!match) return null;
  const items = [];
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const bulletMatch = trimmed.match(/^-\s*["']?([^"'\n]+)["']?\s*$/);
    if (bulletMatch) items.push(bulletMatch[1].trim());
  }
  return items.length ? items : null;
}

function computeDataFingerprint(cwd, dataGlobs) {
  if (!dataGlobs || !dataGlobs.length) return null;
  const files = [];
  for (const glob of dataGlobs) {
    const pattern = glob.startsWith("/") ? glob : path.join(cwd, glob);
    const dir = path.dirname(pattern);
    const base = path.basename(pattern);
    if (base.includes("*")) {
      try {
        const findOutput = execSync("find \"" + dir + "\" -maxdepth 1 -name \"" + base + "\" -type f 2>/dev/null || true", { cwd, encoding: "utf8", timeout: 5000 });
        for (const f of findOutput.split("\n").filter(Boolean)) {
          files.push(f);
        }
      } catch { /* no match */ }
    } else {
      if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
        files.push(pattern);
      }
    }
  }
  if (!files.length) return null;
  files.sort((a, b) => a.localeCompare(b));
  const hash = createHash("sha256");
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      hash.update(file);
      hash.update(String(stat.size));
      hash.update(String(stat.mtimeMs));
    } catch { /* skip */ }
  }
  return hash.digest("hex");
}

function cmdDataFingerprint() {
  const cwd = targetDir();
  const goalFile = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(goalFile)) {
    console.error("No goal.md found. Run `autoresearch goal` first.");
    process.exitCode = 1;
    return;
  }
  const raw = fs.readFileSync(goalFile, "utf8");
  const globs = parseDataGlobs(raw);
  const fp = computeDataFingerprint(cwd, globs);
  if (fp) console.log(fp);
  else console.log("No data_globs configured or no files matched.");
}

function readTextIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function parseMarkdownSection(text, heading) {
  if (!text) return "";
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^## ${escaped}\\s+([\\s\\S]*?)(?=\\n## |\\n# |$)`, "mi"));
  return match ? match[1].trim() : "";
}

function parseGoalFile(goalFile) {
  const raw = readTextIfExists(goalFile);
  return {
    raw,
    goal: parseMarkdownSection(raw, "Goal") || "",
    metric: parseMarkdownSection(raw, "Target Metric") || "",
    direction: parseMarkdownSection(raw, "Direction") || "",
    baseline: parseMarkdownSection(raw, "Baseline Command") || "",
    evaluation: parseMarkdownSection(raw, "Evaluation Command") || "",
    currentBest: parseMarkdownSection(raw, "Current Best") || "",
    notes: parseMarkdownSection(raw, "Notes") || "",
  };
}

function parsePlanFile(planFile) {
  const raw = readTextIfExists(planFile);
  return {
    raw,
    currentState: parseMarkdownSection(raw, "Current State") || "",
    timeBudget: parseMarkdownSection(raw, "Time Budget") || "",
    picklist: parseMarkdownSection(raw, "Picklist") || "",
    ruledOut: parseMarkdownSection(raw, "Ruled Out") || "",
  };
}

function normalizeTimeBudget(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (lowered.includes("usual experiment length: unknown")) return "";
  if (lowered === "unknown") return "";
  if (lowered.includes("ask the user once")) return "";
  return trimmed;
}

function parseRunsLedger(ledgerFile) {
  if (!fs.existsSync(ledgerFile)) {
    return [];
  }
  return readTextIfExists(ledgerFile)
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      try {
        return JSON.parse(row);
      } catch {
        return { parse_error: true, raw: row };
      }
    });
}

function metricTiersPath(cwd) {
  return path.join(cwd, ".researchloop", "metric-tiers.yaml");
}

function normalizeMetricDirection(direction, metricName) {
  const normalized = String(direction || "").trim().toLowerCase();
  if (["higher", "high", "max", "maximize", "up"].includes(normalized)) return "higher";
  if (["lower", "low", "min", "minimize", "down"].includes(normalized)) return "lower";
  return METRIC_DIRECTION_DEFAULTS[String(metricName || "").trim()] || "lower";
}

function metricNamesFromInput(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) return metricNamesFromInput(entry.name || "");
      return metricNamesFromInput(entry);
    });
  }
  return String(value || "")
    .split(/[,\n]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function normalizeMetricList(metrics, maxSelect) {
  const rawList = Array.isArray(metrics) ? metrics : metricNamesFromInput(metrics);
  const seen = new Set();
  const normalized = [];
  for (const entry of rawList) {
    const item = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry
      : { name: entry };
    const name = String(item.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const threshold = Number(item.threshold ?? item.max_degradation ?? item.degradation_threshold ?? 0.05);
    normalized.push({
      name,
      direction: normalizeMetricDirection(item.direction, name),
      threshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : 0.05,
    });
    if (Number.isFinite(maxSelect) && maxSelect > 0 && normalized.length >= maxSelect) break;
  }
  return normalized;
}

function buildDefaultMetricTierConfig(profileKey = "hpc_operator") {
  const profile = METRIC_TIER_PROFILES[profileKey] ? profileKey : "hpc_operator";
  const defaults = METRIC_TIER_PROFILES[profile];
  const tiers = {};
  for (const level of METRIC_TIER_LEVELS) {
    tiers[level.key] = {
      label: level.label,
      weight: level.weight,
      max_select: level.maxSelect,
      metrics: normalizeMetricList(defaults[level.key] || [], level.maxSelect),
    };
  }
  return {
    version: 1,
    profile,
    profile_label: defaults.label,
    tiers,
  };
}

function normalizeMetricTierConfig(input = {}, fallbackProfile = "hpc_operator") {
  const requestedProfile = String(input.profile || fallbackProfile || "hpc_operator").trim();
  const base = buildDefaultMetricTierConfig(requestedProfile);
  const sourceTiers = input.tiers && typeof input.tiers === "object" ? input.tiers : {};
  const tiers = {};
  for (const level of METRIC_TIER_LEVELS) {
    const source = sourceTiers[level.key] && typeof sourceTiers[level.key] === "object"
      ? sourceTiers[level.key]
      : {};
    const configuredMaxSelect = Number(source.max_select ?? source.maxSelect ?? level.maxSelect);
    const maxSelect = Number.isFinite(configuredMaxSelect) && configuredMaxSelect > 0
      ? Math.min(configuredMaxSelect, level.maxSelect)
      : level.maxSelect;
    const weight = Number(source.weight ?? level.weight);
    tiers[level.key] = {
      label: String(source.label || level.label),
      weight: Number.isFinite(weight) && weight > 0 ? weight : level.weight,
      max_select: maxSelect,
      metrics: normalizeMetricList(source.metrics || base.tiers[level.key].metrics, maxSelect),
    };
  }
  return {
    version: Number(input.version || 1),
    profile: base.profile,
    profile_label: base.profile_label,
    tiers,
  };
}

function metricTierConfigFromDashboardBody(body = {}) {
  const profile = String(body.profile || "hpc_operator").trim() || "hpc_operator";
  const base = buildDefaultMetricTierConfig(profile);
  const tiers = {};
  for (const level of METRIC_TIER_LEVELS) {
    const raw = body[level.key] ?? body[level.key.replace("level", "level_")] ?? null;
    const metrics = raw !== null && raw !== undefined
      ? metricNamesFromInput(raw)
      : base.tiers[level.key].metrics;
    tiers[level.key] = {
      ...base.tiers[level.key],
      metrics,
    };
  }
  return normalizeMetricTierConfig({ version: 1, profile, tiers }, profile);
}

function metricTierConfigToYaml(config) {
  const normalized = normalizeMetricTierConfig(config);
  const lines = [
    "version: 1",
    `profile: ${normalized.profile}`,
    "tiers:",
  ];
  for (const level of METRIC_TIER_LEVELS) {
    const tier = normalized.tiers[level.key];
    lines.push(`  ${level.key}:`);
    lines.push(`    weight: ${tier.weight}`);
    lines.push(`    max_select: ${tier.max_select}`);
    lines.push("    metrics:");
    for (const metric of tier.metrics) {
      lines.push(`      - name: ${metric.name}`);
      lines.push(`        direction: ${metric.direction}`);
      lines.push(`        threshold: ${metric.threshold}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function readMetricTierConfig(cwd, profileOverride = null) {
  const file = metricTiersPath(cwd);
  if (!fs.existsSync(file)) {
    return buildDefaultMetricTierConfig(profileOverride || "hpc_operator");
  }
  try {
    const parsed = parseSimpleYaml(readTextIfExists(file));
    return normalizeMetricTierConfig(parsed, profileOverride || parsed.profile || "hpc_operator");
  } catch {
    return buildDefaultMetricTierConfig(profileOverride || "hpc_operator");
  }
}

function writeMetricTierConfig(cwd, config) {
  const normalized = normalizeMetricTierConfig(config);
  const file = metricTiersPath(cwd);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, metricTierConfigToYaml(normalized));
  return { ...normalized, file: path.relative(cwd, file) };
}

function configuredMetricNames(config) {
  const names = [];
  for (const level of METRIC_TIER_LEVELS) {
    for (const metric of config?.tiers?.[level.key]?.metrics || []) {
      if (metric?.name) names.push(metric.name);
    }
  }
  return [...new Set(names)];
}

function rowHasAnyMetric(row, metricNames) {
  return metricNames.some((metric) => Number.isFinite(runMetricValue(row, metric)));
}

function isBaselineRow(row) {
  const text = `${row?.id || ""} ${row?.agent || ""} ${row?.tags || ""}`.toLowerCase();
  return text.includes("baseline");
}

function readSelectedMetricTierBatchQueue(cwd, dashboardConfig = {}) {
  const queueId = String(dashboardConfig.batchQueueId || "").trim();
  if (!queueId) return null;
  try {
    return readQueueState(cwd, queueId);
  } catch {
    return {
      queue_id: queueId,
      status: "missing",
      counts: {},
      best: null,
    };
  }
}

function isBatchQueueComplete(queue) {
  return String(queue?.status || "").toLowerCase() === "complete";
}

function isBatchQueuePendingScore(queue) {
  if (!queue) return false;
  const status = String(queue.status || "").toLowerCase();
  return ["pending", "running", "retrying", "pausing", "paused"].includes(status);
}

function queueBestForMetricTier(queue) {
  if (!queue) return null;
  if (queue.best?.run_id) return queue.best;
  return queueBest(queue.trials || [], queue.metric, queue.direction);
}

function queueTrialAsRunRow(queue, runId) {
  const trial = (queue?.trials || []).find((row) => String(row.run_id) === String(runId));
  if (!trial) return null;
  const stable = queue?.stability?.stable_best;
  const metrics = { ...(trial.metrics || {}) };
  if (stable?.run_id && String(stable.run_id) === String(runId) && stable.metric && isNumericMetric(stable.value)) {
    metrics[stable.metric] = Number(stable.value);
    metrics[`${stable.metric}_original_once`] = stable.original_value ?? metrics[stable.metric];
    metrics[`${stable.metric}_stability_repeats`] = stable.repeats ?? null;
  }
  return {
    id: trial.run_id,
    status: trial.status,
    command: trial.command,
    metrics,
    timestamp: trial.finished_at || trial.started_at || queue.updated_at || queue.created_at,
    started_at: trial.started_at,
    ended_at: trial.finished_at,
    wall_seconds: trial.wall_seconds,
    agent: "autoresearch sweep",
    tags: ["sweep", `sweep:${queue.name || queue.queue_id}`],
    parent_id: queue.queue_id,
  };
}

function metricTierBatchContext(queue, mode, best = null) {
  if (!queue) return null;
  return {
    mode,
    queue_id: queue.queue_id || null,
    queue_name: queue.name || null,
    queue_status: queue.status || null,
    queue_metric: queue.metric || null,
    queue_direction: queue.direction || null,
    queue_counts: queue.counts || {},
    best_run_id: best?.run_id || null,
    best_value: Number.isFinite(Number(best?.value)) ? Number(best.value) : null,
  };
}

function pickTierComparisonRows(runs, config, opts = {}) {
  const cleanRuns = (runs || []).filter((row) => row && !row.parse_error && row.metrics && typeof row.metrics === "object");
  const metricNames = configuredMetricNames(config);
  const comparable = metricNames.length ? cleanRuns.filter((row) => rowHasAnyMetric(row, metricNames)) : cleanRuns;
  const baseline = comparable.find(isBaselineRow) || comparable[0] || null;
  const batchQueue = opts.batchQueue || null;
  if (batchQueue) {
    if (isBatchQueuePendingScore(batchQueue)) {
      return {
        baseline,
        candidate: null,
        comparable,
        batch: metricTierBatchContext(batchQueue, "waiting"),
      };
    }
    if (isBatchQueueComplete(batchQueue)) {
      const best = queueBestForMetricTier(batchQueue);
      const candidate = best?.run_id
        ? comparable.find((row) => String(row.id) === String(best.run_id))
          || cleanRuns.find((row) => String(row.id) === String(best.run_id))
          || queueTrialAsRunRow(batchQueue, best.run_id)
        : null;
      if (candidate) {
        return {
          baseline,
          candidate,
          comparable: comparable.some((row) => String(row.id) === String(candidate.id)) ? comparable : [...comparable, candidate],
          batch: metricTierBatchContext(batchQueue, "best", best),
        };
      }
      return {
        baseline,
        candidate: null,
        comparable,
        batch: metricTierBatchContext(batchQueue, "complete_no_best", best),
      };
    }
    return {
      baseline,
      candidate: null,
      comparable,
      batch: metricTierBatchContext(batchQueue, "unavailable"),
    };
  }
  const candidate = [...comparable].reverse().find((row) => !baseline || String(row.id) !== String(baseline.id)) || comparable[comparable.length - 1] || null;
  return { baseline, candidate, comparable, batch: null };
}

function metricImprovement(baselineValue, currentValue, direction) {
  const baseline = Number(baselineValue);
  const current = Number(currentValue);
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return Number.NaN;
  const numerator = direction === "higher" ? current - baseline : baseline - current;
  const denom = Math.max(Math.abs(baseline), 1e-9);
  return numerator / denom;
}

function recommendationForTierAnalysis(levels, baseline, candidate) {
  if (!baseline || !candidate || String(baseline.id) === String(candidate.id)) {
    return { code: "needs_retest", label: "需要复测", reason: "缺少 baseline 或候选实验，无法形成对照。" };
  }
  const level1 = levels.find((level) => level.key === "level1");
  const level2 = levels.find((level) => level.key === "level2");
  const available = levels.flatMap((level) => level.metrics).filter((metric) => metric.available);
  if (!available.length) {
    return { code: "needs_retest", label: "需要复测", reason: "没有可用于多级评分的数值指标。" };
  }
  const badPrimary = (level1?.metrics || []).find((metric) => metric.available && metric.improvement < -metric.threshold);
  if (badPrimary) {
    return {
      code: "not_recommended",
      label: "不推荐",
      reason: `${badPrimary.name} 退化超过 ${(badPrimary.threshold * 100).toFixed(1)}%。`,
    };
  }
  const degradedSecondary = (level2?.metrics || []).find((metric) => metric.available && metric.improvement < -metric.threshold);
  if ((level1?.avg_improvement || 0) > 0 && (degradedSecondary || (level2 && level2.available > 0 && level2.avg_improvement < 0))) {
    return {
      code: "conditional",
      label: "有条件推荐",
      reason: degradedSecondary
        ? `${degradedSecondary.name} 有明显退化，需要确认资源或稳定性代价。`
        : "一级指标改善，但二级指标整体偏弱。",
    };
  }
  if ((level1?.available || 0) > 0 && (level1?.avg_improvement || 0) >= 0 && (!level2 || level2.available === 0 || level2.avg_improvement >= 0)) {
    return { code: "recommended", label: "推荐", reason: "一级指标未退化，二级指标没有明显反向信号。" };
  }
  return { code: "needs_retest", label: "需要复测", reason: "指标数量不足或改善不稳定。" };
}

function recommendationForBatchSelection(batch) {
  if (!batch) return null;
  if (batch.mode === "waiting") {
    const counts = batch.queue_counts || {};
    return {
      code: "waiting_batch",
      label: "等待批量完成",
      reason: `批量队列 ${batch.queue_id || ""} 尚未完成：完成 ${counts.complete || 0}/${counts.total || 0}，评分会在队列完成后只使用最佳实验。`,
    };
  }
  if (batch.mode === "complete_no_best") {
    return {
      code: "needs_retest",
      label: "需要复测",
      reason: "批量队列已完成，但没有找到带数值指标的最佳实验。",
    };
  }
  if (batch.mode === "unavailable") {
    return {
      code: "needs_retest",
      label: "需要复测",
      reason: "当前批量队列不可用，无法选择最佳实验评分。",
    };
  }
  return null;
}

function evaluateMetricTiers(runs, configInput, opts = {}) {
  const config = normalizeMetricTierConfig(configInput || {});
  const { baseline, candidate, comparable, batch } = pickTierComparisonRows(runs, config, opts);
  const levels = METRIC_TIER_LEVELS.map((level) => {
    const tier = config.tiers[level.key];
    const metrics = (tier.metrics || []).map((metric) => {
      const direction = normalizeMetricDirection(metric.direction, metric.name);
      const baselineValue = runMetricValue(baseline, metric.name);
      const currentValue = runMetricValue(candidate, metric.name);
      const improvement = metricImprovement(baselineValue, currentValue, direction);
      return {
        name: metric.name,
        direction,
        threshold: metric.threshold ?? 0.05,
        baseline: Number.isFinite(baselineValue) ? baselineValue : null,
        current: Number.isFinite(currentValue) ? currentValue : null,
        improvement: Number.isFinite(improvement) ? improvement : null,
        available: Number.isFinite(improvement),
      };
    });
    const usable = metrics.filter((metric) => metric.available);
    const avg = usable.length
      ? usable.reduce((sum, metric) => sum + metric.improvement, 0) / usable.length
      : null;
    return {
      key: level.key,
      label: tier.label || level.label,
      weight: tier.weight,
      max_select: tier.max_select,
      available: usable.length,
      missing: metrics.length - usable.length,
      avg_improvement: avg,
      weighted_score: avg === null ? null : avg * tier.weight,
      metrics,
    };
  });
  const overall = levels
    .map((level) => level.weighted_score)
    .filter((value) => Number.isFinite(value))
    .reduce((sum, value) => sum + value, 0);
  const recommendation = recommendationForBatchSelection(batch) || recommendationForTierAnalysis(levels, baseline, candidate);
  return {
    profile: config.profile,
    profile_label: config.profile_label,
    baseline_id: baseline?.id || null,
    candidate_id: candidate?.id || null,
    comparable_runs: comparable.length,
    overall_score: Number.isFinite(overall) ? overall : null,
    recommendation,
    selection_mode: batch ? (batch.mode === "best" ? "batch_best" : "batch_waiting") : "latest_run",
    selection_label: batch
      ? (batch.mode === "best" ? "批量队列最佳实验" : "等待批量队列完成")
      : "单次/最新实验",
    batch_queue_id: batch?.queue_id || null,
    batch_queue_status: batch?.queue_status || null,
    batch_queue_metric: batch?.queue_metric || null,
    batch_queue_direction: batch?.queue_direction || null,
    batch_best_run_id: batch?.best_run_id || null,
    batch_best_value: batch?.best_value ?? null,
    levels,
  };
}

function extractMetricSeriesFromText(text, metricName, customRegexSource) {
  const regex = customRegexSource
    ? new RegExp(customRegexSource, "gi")
    : defaultMetricRegex(metricName);
  const values = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1] !== undefined ? match[1] : match[0];
    const value = Number(raw);
    if (Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function readRunMetricSeries(cwd, run, metricName, customRegexSource) {
  const stored = run?.metric_history?.[metricName];
  if (Array.isArray(stored) && stored.length) {
    return stored.map((value, index) => ({
      step: index + 1,
      value: Number(value),
    })).filter((point) => Number.isFinite(point.value));
  }

  const logPath = run?.log ? path.join(cwd, run.log) : null;
  if (!logPath || !fs.existsSync(logPath)) {
    return [];
  }
  const values = extractMetricSeriesFromText(readTextIfExists(logPath), metricName, customRegexSource);
  return values.map((value, index) => ({
    step: index + 1,
    value,
  }));
}

function readExperimentHistory(cwd) {
  const researchDir = path.join(cwd, ".researchloop");
  const goalPath = path.join(researchDir, "goal.md");
  const planPath = path.join(researchDir, "plan.md");
  const threadPath = path.join(researchDir, "scratchpad", "THREAD.md");
  const ledgerPath = path.join(researchDir, "scratchpad", "runs.jsonl");
  const goal = parseGoalFile(goalPath);
  const plan = parsePlanFile(planPath);
  const runs = parseRunsLedger(ledgerPath).filter((run) => !run.parse_error);
  const primaryMetric = choosePrimaryMetric(goal, runs);
  const preferHigher = String(goal.direction || "").toLowerCase().includes("high");
  const summary = summarizeDashboardRuns(runs, primaryMetric, preferHigher);
  const threadText = readTextIfExists(threadPath);
  const threadTail = threadText
    .split("\n")
    .filter(Boolean)
    .slice(-12)
    .join("\n")
    .trim();

  return {
    goal,
    plan,
    runs,
    primaryMetric,
    preferHigher,
    summary,
    recentRuns: runs.slice(-3),
    threadTail,
    timeBudget: normalizeTimeBudget(plan.timeBudget || ""),
    hasHistory: runs.length > 0 || Boolean(threadTail),
  };
}

function readSystemSummary() {
  const cores = os.cpus().length;
  const memoryGiB = Math.max(1, Math.round(os.totalmem() / (1024 * 1024 * 1024)));
  const scale = memoryGiB <= 16 ? "laptop-scale" : memoryGiB <= 32 ? "desktop-scale" : "workstation-scale";
  return { cores, memoryGiB, scale };
}

function isNumericMetric(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function choosePrimaryMetric(goal, runs) {
  const metricHint = String(goal?.metric || "").trim();
  const metricKeys = new Set();
  for (const run of runs) {
    for (const key of Object.keys(run.metrics || {})) {
      if (isNumericMetric(run.metrics[key])) {
        metricKeys.add(key);
      }
    }
  }

  if (metricHint && metricKeys.has(metricHint)) {
    return metricHint;
  }
  if (metricKeys.has("val_loss")) {
    return "val_loss";
  }
  if (metricKeys.has("loss")) {
    return "loss";
  }
  return metricKeys.values().next().value || "";
}

function summarizeDashboardRuns(runs, primaryMetric, preferHigher = false) {
  const completeRuns = runs.filter((run) => run.status === "complete" || run.status === "completed");
  const parseErrors = runs.filter((run) => run.parse_error).length;
  const latestRun = [...runs].reverse().find((run) => !run.parse_error) || null;

  const metricEntries = runs
    .map((run, index) => ({
      run,
      index,
      value: primaryMetric && isNumericMetric(run.metrics?.[primaryMetric]) ? Number(run.metrics[primaryMetric]) : Number.NaN,
    }))
    .filter((entry) => Number.isFinite(entry.value));

  metricEntries.sort((a, b) => (preferHigher ? b.value - a.value : a.value - b.value));
  const bestRun = metricEntries[0] || null;
  const worstRun = metricEntries[metricEntries.length - 1] || null;
  const series = metricEntries
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      id: entry.run.id,
      value: entry.value,
      timestamp: entry.run.timestamp,
    }));

  const costEntries = runs
    .map((run) => run.est_cost_usd)
    .filter((v) => v != null && typeof v === "number" && Number.isFinite(v));
  const totalCost = costEntries.reduce((s, v) => s + v, 0);
  const avgCost = costEntries.length > 0 ? totalCost / costEntries.length : null;

  return {
    totalRuns: runs.length,
    completeRuns: completeRuns.length,
    parseErrors,
    latestRun,
    bestRun,
    worstRun,
    series,
    totalCost: costEntries.length > 0 ? totalCost : null,
    avgCost,
    latestRunCost: latestRun?.est_cost_usd ?? null,
  };
}

function parseDisplayMemoryBytes(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/([0-9.]+)\s*(TB|GB|GIB|MB|MIB|KB|KIB)?/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = String(match[2] || "MB").toUpperCase();
  const scale = unit.startsWith("T") ? 1024 ** 4
    : unit.startsWith("G") ? 1024 ** 3
      : unit.startsWith("K") ? 1024
        : 1024 ** 2;
  return Math.round(n * scale);
}

function parseTopMemoryBytes(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^([0-9.]+)\s*([KMGTPE]?)(?:I?B)?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const unit = String(match[2] || "").toUpperCase();
  const scale = unit === "P" ? 1024 ** 5
    : unit === "T" ? 1024 ** 4
      : unit === "G" ? 1024 ** 3
        : unit === "M" ? 1024 ** 2
          : unit === "K" ? 1024
            : 1;
  return Math.round(n * scale);
}

function clampPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function readMacActivityMetrics(totalMem) {
  if (process.platform !== "darwin") return null;
  try {
    const out = execSync("top -l 1 -s 0 -n 0", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1500,
    });
    const cpuLine = out.match(/^CPU usage:.*$/m)?.[0] || "";
    const cpuMatch = cpuLine.match(/CPU usage:\s*([0-9.]+)%\s*user,\s*([0-9.]+)%\s*sys,\s*([0-9.]+)%\s*idle/i);
    const memoryLine = out.match(/^PhysMem:.*$/m)?.[0] || "";
    const usedMatch = memoryLine.match(/PhysMem:\s*([0-9.]+\s*[KMGTPE]?(?:I?B)?)\s+used/i);
    const unusedMatch = memoryLine.match(/,\s*([0-9.]+\s*[KMGTPE]?(?:I?B)?)\s+unused/i);
    const wiredMatch = memoryLine.match(/\(([0-9.]+\s*[KMGTPE]?(?:I?B)?)\s+wired/i);
    const compressedMatch = memoryLine.match(/,\s*([0-9.]+\s*[KMGTPE]?(?:I?B)?)\s+compressor/i);

    const usedBytes = parseTopMemoryBytes(usedMatch?.[1]);
    const unusedBytes = parseTopMemoryBytes(unusedMatch?.[1]);
    const freeBytes = usedBytes != null ? Math.max(0, totalMem - usedBytes) : unusedBytes;
    const usagePct = usedBytes != null && totalMem > 0 ? clampPct((usedBytes / totalMem) * 100) : null;
    const cpu = cpuMatch
      ? {
        source: "top",
        userPct: Number(Number(cpuMatch[1]).toFixed(1)),
        systemPct: Number(Number(cpuMatch[2]).toFixed(1)),
        idlePct: Number(Number(cpuMatch[3]).toFixed(1)),
        usagePct: Number(clampPct(100 - Number(cpuMatch[3])).toFixed(1)),
      }
      : null;
    const memory = usedBytes != null
      ? {
        source: "top",
        usedBytes,
        freeBytes,
        unusedBytes,
        wiredBytes: parseTopMemoryBytes(wiredMatch?.[1]),
        compressedBytes: parseTopMemoryBytes(compressedMatch?.[1]),
        usagePct: Number(usagePct.toFixed(1)),
      }
      : null;
    return cpu || memory ? { cpu, memory } : null;
  } catch {
    return null;
  }
}

function readMacGpuInfo(totalMem, usedMem, memPct) {
  if (process.platform !== "darwin") return null;
  const now = Date.now();
  if (systemMetricsCache.macGpu.data && now - systemMetricsCache.macGpu.ts < 60_000) {
    const cached = systemMetricsCache.macGpu.data;
    if (!cached.present || cached.memory?.kind !== "unified") return cached;
    return {
      ...cached,
      memory: {
        ...cached.memory,
        totalBytes: totalMem,
        usedBytes: usedMem,
        usagePct: Number(memPct.toFixed(1)),
      },
    };
  }
  try {
    const out = execSync("system_profiler SPDisplaysDataType -json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2500,
    });
    const parsed = JSON.parse(out);
    const devices = (parsed.SPDisplaysDataType || [])
      .map((item) => {
        const name = item.sppci_model || item._name || "GPU";
        const vendor = item.spdisplays_vendor || item.sppci_vendor || "";
        const cores = Number(item.sppci_cores);
        const vramBytes = parseDisplayMemoryBytes(item.spdisplays_vram || item.sppci_vram);
        const isUnified = /apple/i.test(`${name} ${vendor}`) || !vramBytes;
        return {
          name,
          vendor,
          cores: Number.isFinite(cores) ? cores : null,
          bus: item.sppci_bus || null,
          metal: item.spdisplays_mtlgpufamilysupport || null,
          memoryKind: isUnified ? "unified" : "dedicated",
          memoryTotalBytes: isUnified ? totalMem : vramBytes,
        };
      })
      .filter((gpu) => gpu.name);
    if (!devices.length) {
      const empty = { present: false, source: "system_profiler", devices: [] };
      systemMetricsCache.macGpu = { ts: now, data: empty };
      return empty;
    }
    const primary = devices[0];
    const isUnified = primary.memoryKind === "unified";
    const memoryTotalBytes = isUnified ? totalMem : primary.memoryTotalBytes;
    const memoryUsedBytes = isUnified ? usedMem : null;
    const memoryPct = memoryTotalBytes && memoryUsedBytes != null
      ? (memoryUsedBytes / memoryTotalBytes) * 100
      : null;
    const data = {
      present: true,
      source: "system_profiler",
      kind: isUnified ? "integrated-unified" : "mac-dedicated",
      count: devices.length,
      name: primary.name,
      utilizationPct: 0,
      utilizationNote: "macOS 暂未提供轻量全局 GPU 利用率采样",
      devices,
      memory: {
        kind: isUnified ? "unified" : "dedicated",
        totalBytes: memoryTotalBytes || null,
        usedBytes: memoryUsedBytes ?? 0,
        usagePct: Number.isFinite(memoryPct) ? Number(memoryPct.toFixed(1)) : 0,
      },
    };
    systemMetricsCache.macGpu = { ts: now, data };
    return data;
  } catch {
    const empty = { present: false, source: "system_profiler", devices: [] };
    systemMetricsCache.macGpu = { ts: now, data: empty };
    return empty;
  }
}

function readGpuMetrics(totalMem, usedMem, memPct) {
  const nvidia = probeGpuStats();
  if (nvidia && nvidia.length) {
    let utilSum = 0;
    let utilCount = 0;
    let memUsedMb = 0;
    let memTotalMb = 0;
    for (const gpu of nvidia) {
      if (Number.isFinite(gpu.util_pct)) {
        utilSum += gpu.util_pct;
        utilCount += 1;
      }
      if (Number.isFinite(gpu.mem_used_mb)) memUsedMb += gpu.mem_used_mb;
      if (Number.isFinite(gpu.mem_total_mb)) memTotalMb += gpu.mem_total_mb;
    }
    const usagePct = memTotalMb > 0 ? (memUsedMb / memTotalMb) * 100 : null;
    return {
      present: true,
      source: "nvidia-smi",
      kind: "dedicated",
      count: nvidia.length,
      name: nvidia.length === 1 ? "NVIDIA GPU" : `${nvidia.length} NVIDIA GPUs`,
      utilizationPct: utilCount ? Number((utilSum / utilCount).toFixed(1)) : 0,
      devices: nvidia,
      memory: {
        kind: "dedicated",
        totalBytes: Number.isFinite(memTotalMb) ? memTotalMb * 1024 * 1024 : null,
        usedBytes: Number.isFinite(memUsedMb) ? memUsedMb * 1024 * 1024 : 0,
        usagePct: Number.isFinite(usagePct) ? Number(usagePct.toFixed(1)) : null,
      },
    };
  }
  return readMacGpuInfo(totalMem, usedMem, memPct) || {
    present: false,
    source: "none",
    count: 0,
    devices: [],
    utilizationPct: 0,
    memory: { kind: "unknown", totalBytes: null, usedBytes: 0, usagePct: 0 },
  };
}

function computeDeviceEnv(effective, options = {}) {
  const device = String(effective || "cpu");
  const env = {
    RESEARCHLOOP_DEVICE: device,
    RESEARCHLOOP_ACCELERATOR: device,
  };
  const cudaVisibleDevices = String(options.cudaVisibleDevices || "").trim();
  if (device === "cuda" && cudaVisibleDevices) {
    env.CUDA_VISIBLE_DEVICES = cudaVisibleDevices;
  }
  if (device === "mps") {
    env.PYTORCH_ENABLE_MPS_FALLBACK = "1";
  }
  if (device === "directml") {
    env.RESEARCHLOOP_WINDOWS_GPU_BACKEND = "directml";
  }
  if (device === "cpu") {
    env.CUDA_VISIBLE_DEVICES = "";
  }
  return env;
}

function inferComputeDevice(requested = "auto", gpu = null, options = {}) {
  const allowed = new Set(["auto", "cpu", "cuda", "mps", "directml", "integrated"]);
  const req = allowed.has(String(requested || "").toLowerCase())
    ? String(requested || "").toLowerCase()
    : "auto";
  const gpuInfo = gpu || readGpuMetrics(os.totalmem(), os.totalmem() - os.freemem(), os.totalmem() ? ((os.totalmem() - os.freemem()) / os.totalmem()) * 100 : 0);
  let effective = req;
  let reason = "user_selected";
  if (req === "auto") {
    if (gpuInfo?.source === "nvidia-smi" && gpuInfo.present) {
      effective = "cuda";
      reason = "nvidia_cuda_detected";
    } else if (process.platform === "darwin" && gpuInfo?.present) {
      effective = "mps";
      reason = "macos_integrated_gpu_detected";
    } else if (process.platform === "win32") {
      effective = "directml";
      reason = "windows_no_cuda_prefer_integrated_gpu";
    } else {
      effective = "cpu";
      reason = "no_supported_gpu_backend_detected";
    }
  } else if (req === "integrated") {
    if (process.platform === "darwin" && gpuInfo?.present) {
      effective = "mps";
      reason = "macos_integrated_gpu_requested";
    } else if (process.platform === "win32") {
      effective = "directml";
      reason = "windows_integrated_gpu_requested";
    } else {
      effective = "cpu";
      reason = "integrated_gpu_backend_unavailable";
    }
  }
  const labels = {
    auto: "自动",
    cpu: "CPU",
    cuda: "CUDA",
    mps: "Apple GPU / MPS",
    directml: "Windows DirectML / 核显",
    integrated: "集成显卡",
  };
  return {
    requested: req,
    effective,
    label: labels[effective] || effective,
    reason,
    env: computeDeviceEnv(effective, options),
    cudaVisibleDevices: String(options.cudaVisibleDevices || "").trim() || null,
    frameworkHint: effective === "mps"
      ? "PyTorch code should choose torch.device('mps') or read RESEARCHLOOP_DEVICE=mps"
      : effective === "directml"
        ? "Windows integrated GPU compute usually needs DirectML-capable code, for example torch-directml or ONNX Runtime DirectML"
        : effective === "cuda"
          ? "CUDA detected through nvidia-smi"
          : "CPU fallback",
  };
}

function directorySizeBytes(dir) {
  try {
    if (!fs.existsSync(dir)) return 0;
    const out = execSync(`du -sk ${shellQuote(dir)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 4000,
    });
    const kb = Number(String(out).trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

function archiveBytesInDir(dir, maxEntries = 20_000) {
  let total = 0;
  let seen = 0;
  const archivePattern = /\.(zip|tar|tgz|tar\.gz|gz|bz2|xz|7z|rar)$/i;
  const walk = (current) => {
    if (seen > maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen > maxEntries) return;
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const full = path.join(current, entry.name);
      seen += 1;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && archivePattern.test(entry.name)) {
        try {
          total += fs.statSync(full).size;
        } catch {
          // ignore deleted files during scan
        }
      }
    }
  };
  walk(dir);
  return total;
}

function readDiskMetrics(cwd) {
  const key = path.resolve(cwd || process.cwd());
  const now = Date.now();
  const cached = systemMetricsCache.diskByCwd.get(key);
  if (cached && now - cached.ts < 15_000) return cached.data;

  let totalBytes = null;
  let freeBytes = null;
  let availableBytes = null;
  try {
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(key);
      totalBytes = Number(stats.blocks) * Number(stats.bsize);
      freeBytes = Number(stats.bfree) * Number(stats.bsize);
      availableBytes = Number(stats.bavail) * Number(stats.bsize);
    }
  } catch {
    totalBytes = null;
    freeBytes = null;
    availableBytes = null;
  }
  const usedBytes = totalBytes != null && freeBytes != null ? totalBytes - freeBytes : null;
  const usagePct = totalBytes && usedBytes != null ? (usedBytes / totalBytes) * 100 : null;
  const checkpointsBytes = ["checkpoints", "checkpoint", "ckpts", "outputs"]
    .map((name) => directorySizeBytes(path.join(key, name)))
    .reduce((sum, size) => sum + size, 0);
  const researchBytes = directorySizeBytes(path.join(key, ".researchloop"));
  const projectBytes = directorySizeBytes(key);
  const archiveBytes = archiveBytesInDir(key);
  const data = {
    path: key,
    source: "statfs+du",
    totalBytes,
    usedBytes,
    freeBytes,
    availableBytes,
    usagePct: Number.isFinite(usagePct) ? Number(usagePct.toFixed(1)) : null,
    projectBytes,
    researchBytes,
    checkpointsBytes,
    archiveBytes,
  };
  systemMetricsCache.diskByCwd.set(key, { ts: now, data });
  return data;
}

function readSystemMetrics(cwd = process.cwd()) {
  const cpus = os.cpus() || [];
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];
  const totalMem = os.totalmem();
  const osFreeMem = os.freemem();
  const macActivity = readMacActivityMetrics(totalMem);
  const freeMem = macActivity?.memory?.freeBytes ?? osFreeMem;
  const usedMem = macActivity?.memory?.usedBytes ?? (totalMem - osFreeMem);
  const memPct = macActivity?.memory?.usagePct ?? (totalMem > 0 ? (usedMem / totalMem) * 100 : 0);
  const cpuCount = cpus.length || 1;
  const loadPct = Math.min(100, (loadAvg[0] / cpuCount) * 100);
  const cpuUsagePct = macActivity?.cpu?.usagePct ?? loadPct;
  const platform = `${os.platform()} ${os.arch()}`;
  const hostname = os.hostname();
  const nodeVersion = process.version;

  const gpu = readGpuMetrics(totalMem, usedMem, memPct);
  return {
    hostname,
    platform,
    nodeVersion,
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      count: cpuCount,
      model: cpus[0]?.model || "unknown",
      source: macActivity?.cpu?.source || "loadavg",
      loadAvg: { "1m": loadAvg[0], "5m": loadAvg[1], "15m": loadAvg[2] },
      usagePct: Number.isFinite(cpuUsagePct) ? Number(cpuUsagePct.toFixed(1)) : 0,
      userPct: macActivity?.cpu?.userPct ?? null,
      systemPct: macActivity?.cpu?.systemPct ?? null,
      idlePct: macActivity?.cpu?.idlePct ?? null,
    },
    memory: {
      source: macActivity?.memory?.source || "os",
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usagePct: Number(memPct.toFixed(1)),
      unusedBytes: macActivity?.memory?.unusedBytes ?? null,
      wiredBytes: macActivity?.memory?.wiredBytes ?? null,
      compressedBytes: macActivity?.memory?.compressedBytes ?? null,
    },
    gpu,
    disk: readDiskMetrics(cwd),
    compute: inferComputeDevice("auto", gpu),
  };
}

function startDashboardSystemSampler(getCwd, intervalMs = 1000) {
  let seq = 0;
  let latest = null;
  let missedSamples = 0;
  let errorCount = 0;
  let lastStartMs = 0;

  const sample = () => {
    const startedMs = Date.now();
    if (lastStartMs > 0) {
      const driftMs = startedMs - lastStartMs - intervalMs;
      if (driftMs > intervalMs * 0.8) {
        missedSamples += Math.max(1, Math.floor(driftMs / intervalMs));
      }
    }
    lastStartMs = startedMs;
    const sampledAt = new Date(startedMs).toISOString();
    try {
      const cwd = getCwd();
      const metrics = readSystemMetrics(cwd);
      const finishedMs = Date.now();
      seq += 1;
      latest = {
        ...metrics,
        sample: {
          seq,
          cwd,
          intervalMs,
          sampledAt,
          collectedAt: new Date(finishedMs).toISOString(),
          collectMs: finishedMs - startedMs,
          ageMs: 0,
          missedSamples,
          errorCount,
          lastError: null,
        },
      };
    } catch (err) {
      const finishedMs = Date.now();
      seq += 1;
      errorCount += 1;
      latest = {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.arch()}`,
        nodeVersion: process.version,
        uptimeSeconds: Math.round(os.uptime()),
        cpu: { count: os.cpus()?.length || 1, model: "unknown", source: "error", loadAvg: { "1m": 0, "5m": 0, "15m": 0 }, usagePct: 0 },
        memory: { source: "error", totalBytes: os.totalmem(), freeBytes: os.freemem(), usedBytes: 0, usagePct: 0 },
        gpu: { present: false, source: "error", count: 0, devices: [], utilizationPct: 0, memory: { kind: "unknown", totalBytes: null, usedBytes: 0, usagePct: 0 } },
        disk: { source: "error", totalBytes: null, usedBytes: null, freeBytes: null, availableBytes: null, usagePct: 0, projectBytes: 0, researchBytes: 0, checkpointsBytes: 0, archiveBytes: 0 },
        compute: inferComputeDevice("cpu"),
        sample: {
          seq,
          cwd: getCwd(),
          intervalMs,
          sampledAt,
          collectedAt: new Date(finishedMs).toISOString(),
          collectMs: finishedMs - startedMs,
          ageMs: 0,
          missedSamples,
          errorCount,
          lastError: err.message,
        },
      };
    }
  };

  sample();
  const timer = setInterval(sample, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    sampleNow: sample,
    getSnapshot() {
      if (!latest) sample();
      const sampleAtMs = Date.parse(latest?.sample?.sampledAt || "");
      const ageMs = Number.isFinite(sampleAtMs) ? Math.max(0, Date.now() - sampleAtMs) : null;
      return {
        ...latest,
        sample: {
          ...latest.sample,
          ageMs,
        },
      };
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function readThreadTail(cwd, lineCount = 24) {
  const threadPath = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  const text = readTextIfExists(threadPath);
  if (!text) return { path: threadPath, lines: [], hasContent: false };
  const lines = text.split("\n").filter(Boolean).slice(-lineCount);
  return { path: threadPath, lines, hasContent: lines.length > 0 };
}

function markdownTitle(text, fallback = "Untitled") {
  const heading = String(text || "").match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const first = String(text || "").split("\n").map((line) => line.trim()).find(Boolean);
  return first ? first.replace(/^[-*]\s+/, "").replace(/^#+\s*/, "").trim() : fallback;
}

function markdownFirstParagraph(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim());
  const useful = lines.filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));
  return useful.slice(0, 3).join(" ").slice(0, 320);
}

function listMarkdownSummaries(dir, limit = 12) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("."))
    .map((entry) => {
      const file = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(file);
        const text = readTextIfExists(file);
        return {
          file,
          name: entry.name,
          title: markdownTitle(text, entry.name.replace(/\.md$/, "")),
          status: parseMarkdownSection(text, "Status") || parseMarkdownSection(text, "状态") || "",
          hypothesis: parseMarkdownSection(text, "Hypothesis") || parseMarkdownSection(text, "假设") || "",
          evidence: parseMarkdownSection(text, "Evidence") || parseMarkdownSection(text, "证据") || "",
          decision: parseMarkdownSection(text, "Decision") || parseMarkdownSection(text, "结论") || "",
          next: parseMarkdownSection(text, "Next") || parseMarkdownSection(text, "下一步") || "",
          summary: markdownFirstParagraph(text),
          mtime: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map(({ mtimeMs, ...row }) => row);
}

function readJsonlRows(file, limit = 20) {
  if (!fs.existsSync(file)) return [];
  return readTextIfExists(file)
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { text: line };
      }
    });
}

function listSampleArtifacts(cwd, limit = 12) {
  const samplesDir = path.join(cwd, ".researchloop", "scratchpad", "samples");
  if (!fs.existsSync(samplesDir)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(samplesDir, { withFileTypes: true })) {
    const file = path.join(samplesDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      for (const row of readJsonlRows(file, limit)) {
        rows.push({ source: entry.name, ...row });
      }
    } else if (entry.isDirectory()) {
      const images = fs.readdirSync(file, { withFileTypes: true })
        .filter((child) => child.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(child.name))
        .map((child) => path.join(file, child.name))
        .slice(0, limit);
      if (images.length) rows.push({ source: entry.name, images });
    }
  }
  return rows.slice(-limit);
}

function listCheckpointArtifacts(cwd, limit = 8) {
  const dirs = [
    path.join(cwd, ".researchloop", "scratchpad", "checkpoints"),
    path.join(cwd, "checkpoints"),
  ];
  const rows = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(file);
        if (entry.isFile() && entry.name.endsWith(".json")) {
          rows.push({ file, name: entry.name, sizeBytes: stat.size, mtime: stat.mtime.toISOString(), ...JSON.parse(readTextIfExists(file)) });
        } else if (entry.isFile() && !entry.name.startsWith(".")) {
          rows.push({ file, name: entry.name, sizeBytes: stat.size, mtime: stat.mtime.toISOString() });
        }
      } catch {
        // Ignore malformed sidecar files.
      }
    }
  }
  return rows.sort((a, b) => String(b.mtime || "").localeCompare(String(a.mtime || ""))).slice(0, limit);
}

function readResearchArtifacts(cwd) {
  const scratch = path.join(cwd, ".researchloop", "scratchpad");
  const readScratch = (name) => {
    const file = path.join(scratch, name);
    const text = readTextPrefix(file, 16_000)
      .replace(/[^\S\r\n\t]+/g, " ")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
    let sizeBytes = 0;
    let mtime = null;
    try {
      const stat = fs.statSync(file);
      sizeBytes = stat.size;
      mtime = stat.mtime.toISOString();
    } catch {
      // Missing scratch files are expected before the first report is generated.
    }
    return {
      file,
      text,
      hasContent: sizeBytes > 0 || Boolean(text.trim()),
      sizeBytes,
      mtime,
      truncated: sizeBytes > Buffer.byteLength(text, "utf8"),
    };
  };
  return {
    picklist: readScratch("picklist.md"),
    memory: readScratch("memory.md"),
    audits: readScratch("audits.md"),
    performanceAnalysis: readScratch("performance-analysis.md"),
    dashboardReport: readScratch("dashboard-report.md"),
    portfolioReport: readScratch("portfolio-report.md"),
    ideas: listMarkdownSummaries(path.join(scratch, "ideas"), 16),
    papers: listMarkdownSummaries(path.join(scratch, "papers"), 12),
    notebook: listMarkdownSummaries(path.join(scratch, "notebook"), 6),
    samples: listSampleArtifacts(cwd, 12),
    checkpoints: listCheckpointArtifacts(cwd, 8),
  };
}

function readLatestLogTail(cwd, runs, lineCount = 30) {
  const latest = [...(runs || [])].reverse().find((run) => run && run.log && !run.parse_error);
  if (!latest) return null;
  const logPath = path.join(cwd, latest.log);
  if (!fs.existsSync(logPath)) return { runId: latest.id, path: logPath, lines: [], modifiedAt: null };
  let modifiedAt = null;
  try {
    modifiedAt = fs.statSync(logPath).mtime.toISOString();
  } catch {
    modifiedAt = null;
  }
  const lines = readTextIfExists(logPath).split("\n").slice(-lineCount);
  return { runId: latest.id, path: logPath, lines, modifiedAt };
}

function detectActiveRun(cwd, runs, logTail) {
  if (!runs || !runs.length) return { active: false };
  const latest = [...runs].reverse().find((run) => run && !run.parse_error);
  if (!latest) return { active: false };
  const inFlightStatuses = new Set(["running", "in_progress", "queued"]);
  const statusActive = inFlightStatuses.has(String(latest.status || "").toLowerCase());
  const logBelongsToLatest = logTail?.runId === latest.id;
  if (!statusActive) return { active: false, latestId: latest.id };
  return {
    active: true,
    latestId: latest.id,
    runId: latest.id,
    command: latest.command || "",
    agent: latest.agent || "",
    startedAt: latest.started_at || latest.timestamp || null,
    logPath: latest.log || "",
    logModifiedAt: logBelongsToLatest ? logTail?.modifiedAt || null : null,
    reason: "status",
    est_cost_usd: latest.est_cost_usd ?? null,
  };
}

function dashboardConfigPath(cwd) {
  return path.join(cwd, ".researchloop", "dashboard-config.json");
}

function readDashboardConfig(cwd) {
  const file = dashboardConfigPath(cwd);
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeDashboardConfig(cwd, config) {
  const file = dashboardConfigPath(cwd);
  ensureDir(path.dirname(file));
  const current = readDashboardConfig(cwd);
  const next = {
    ...current,
    ...config,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizeDashboardConfig(body, includeDefaults = false) {
  const out = {};
  if (includeDefaults || hasOwn(body, "runner")) {
    out.runner = String(body.runner || "python3").trim() || "python3";
  }
  if (includeDefaults || hasOwn(body, "entry")) {
    out.entry = String(body.entry || "").trim();
  }
  if (includeDefaults || hasOwn(body, "baselineArgs")) {
    out.baselineArgs = String(body.baselineArgs || "").trim();
  }
  if (includeDefaults || hasOwn(body, "experimentArgs")) {
    out.experimentArgs = String(body.experimentArgs || "").trim();
  }
  if (includeDefaults || hasOwn(body, "metric")) {
    out.metric = String(body.metric || "").trim();
  }
  if (includeDefaults || hasOwn(body, "regex")) {
    out.regex = String(body.regex || "").trim();
  }
  if (includeDefaults || hasOwn(body, "timeout")) {
    out.timeout = String(body.timeout || "").trim();
  }
  if (includeDefaults || hasOwn(body, "device")) {
    out.device = String(body.device || "auto").trim() || "auto";
  }
  if (out.runner === "cuda" && (!out.device || out.device === "auto")) {
    out.device = "cuda";
  }
  for (const key of [
    "model",
    "dataset",
    "configFile",
    "epochs",
    "batchSize",
    "learningRate",
    "weightDecay",
    "seed",
    "trainingTaskType",
    "optimizer",
    "resolvedOptimizer",
    "advancedOptimizer",
    "optimizerLearningRate",
    "optimizerWeightDecay",
    "optimizerBetas",
    "optimizerEps",
    "optimizerMomentum",
    "scheduler",
    "resolvedScheduler",
    "advancedScheduler",
    "schedulerWarmupSteps",
    "schedulerTotalSteps",
    "schedulerMinLr",
    "schedulerStepSize",
    "schedulerGamma",
    "optimizerRecommendation",
    "templateArgs",
    "systemScheduler",
    "metricProfile",
    "precision",
    "perfMetrics",
    "tags",
    "notes",
    "cudaVisibleDevices",
    "appendTemplateArgs",
    "buildCommand",
    "benchmarkMode",
    "benchmarkCommand",
    "benchmarkRepeat",
    "benchmarkMinTime",
    "profileTool",
    "profileCommand",
    "profileArgs",
    "compilerCommand",
    "compilerFlags",
    "sweepName",
    "sweepTemplate",
    "sweepGrid",
	    "batchSweepSpec",
	    "batchCommandTemplate",
	    "batchParamPreset",
	    "batchSelectedParams",
	    "batchParamGrid",
	    "batchMaxRuns",
	    "batchMaxParallel",
	    "batchMaxParallelSource",
	    "batchMaxParallelReason",
	    "batchDevicePool",
	    "batchMaxRetries",
	    "batchStabilityEnabled",
	    "batchStabilityTopK",
	    "batchStabilityRepeats",
	    "batchQueueId",
    "allowLocalPerf",
    "direction",
  ]) {
    if (includeDefaults || hasOwn(body, key)) {
      out[key] = String(body[key] || "").trim();
    }
  }
  return out;
}

function expandUserPath(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function shellQuote(value) {
  const text = String(value || "");
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function commandPath(name) {
  const executable = String(name || "").trim();
  if (!executable || /[^\w.+/-]/.test(executable)) return "";
  try {
    const out = execSync(`command -v ${shellQuote(executable)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();
    return out.split(/\r?\n/)[0] || "";
  } catch {
    return "";
  }
}

function readPerformanceToolStatus() {
  const toolNames = [
    "nsys",
    "ncu",
    "nvcc",
    "nvidia-smi",
    "cmake",
    "make",
    "ninja",
    "perf",
    "clang",
    "gcc",
    "g++",
    "python3",
    "time",
  ];
  const tools = {};
  for (const name of toolNames) {
    const resolved = commandPath(name);
    tools[name] = { present: Boolean(resolved), path: resolved || null };
  }
  tools["google-benchmark"] = {
    present: null,
    path: null,
    note: "Google Benchmark 是链接到 C++ benchmark 二进制里的库；请在面板里填写已编译好的 benchmark 命令。",
  };
  const apps = detectLocalDeveloperApps();
  for (const [name, info] of Object.entries(apps)) {
    tools[name] = info;
  }
  return tools;
}

function detectLocalDeveloperApps() {
  const apps = {};
  const home = os.homedir();
  const macAppCandidates = {
    clion: [
      "/Applications/CLion.app",
      path.join(home, "Applications", "CLion.app"),
    ],
    vscode: [
      "/Applications/Visual Studio Code.app",
      path.join(home, "Applications", "Visual Studio Code.app"),
    ],
  };
  for (const [name, candidates] of Object.entries(macAppCandidates)) {
    const cli = commandPath(name === "vscode" ? "code" : name);
    const appPath = candidates.find((candidate) => fs.existsSync(candidate)) || "";
    apps[name] = {
      present: Boolean(cli || appPath),
      path: cli || appPath || null,
      kind: appPath ? "mac-app" : (cli ? "cli" : "missing"),
    };
  }
  if (process.platform === "darwin" && !apps.clion.present) {
    try {
      const out = execSync("mdfind 'kMDItemCFBundleIdentifier == \"com.jetbrains.CLion\"' | head -n 1", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1200,
      }).trim();
      if (out) {
        apps.clion = { present: true, path: out, kind: "mac-app" };
      }
    } catch {
      // Spotlight may be unavailable; command/known paths are enough.
    }
  }
  if (process.platform === "darwin" && !apps.vscode.present) {
    try {
      const out = execSync("mdfind 'kMDItemCFBundleIdentifier == \"com.microsoft.VSCode\"' | head -n 1", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1200,
      }).trim();
      if (out) {
        apps.vscode = { present: true, path: out, kind: "mac-app" };
      }
    } catch {
      // Spotlight may be unavailable; command/known paths are enough.
    }
  }
  return apps;
}

function listProjectFiles(cwd, maxDepth = 4, maxEntries = 3000) {
  const root = path.resolve(cwd || process.cwd());
  const skip = new Set([".git", ".researchloop", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache"]);
  const files = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth || files.length >= maxEntries) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxEntries) return;
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        let mode = 0;
        try {
          mode = fs.statSync(full).mode;
        } catch {
          mode = 0;
        }
        files.push({ path: rel, full, name: entry.name, executable: Boolean(mode & 0o111) });
      }
    }
  };
  walk(root, 0);
  return files;
}

function firstExistingProjectFile(cwd, names) {
  for (const name of names) {
    const full = path.join(cwd, name);
    if (fs.existsSync(full)) return name;
  }
  return "";
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function readTextPrefix(file, maxBytes = 64_000) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function chooseCMakeBuildCommand(cwd) {
  const presets = readJsonIfExists(path.join(cwd, "CMakePresets.json"));
  const buildPresets = Array.isArray(presets?.buildPresets) ? presets.buildPresets : [];
  const buildPreset = buildPresets.find((preset) => /release|relwithdebinfo/i.test(preset.name || ""))
    || buildPresets.find((preset) => /default/i.test(preset.name || ""))
    || buildPresets[0];
  if (buildPreset?.name) {
    return `cmake --build --preset ${shellQuote(buildPreset.name)} --parallel`;
  }
  const buildDirs = ["build", "cmake-build-release", "cmake-build-debug", "out/build"]
    .filter((dir) => fs.existsSync(path.join(cwd, dir)));
  if (buildDirs.length) {
    return `cmake --build ${shellQuote(buildDirs[0])} --parallel`;
  }
  return "cmake -S . -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build --parallel";
}

function chooseBenchmarkCandidate(cwd, files, project) {
  const executable = files.find((file) => file.executable && /(^|[/_-])(bench|benchmark|perf)([/_.-]|$)/i.test(file.path));
  if (executable) return `./${executable.path}`;
  const pythonBench = files
    .filter((file) => /\.py$/i.test(file.name) && !isEmptyPythonPackageInit(file))
    .map((file) => ({ file, score: benchmarkCandidateScore(file) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path))[0]?.file;
  if (pythonBench) return `python3 ${shellQuote(pythonBench.path)}`;
  const packageJson = readJsonIfExists(path.join(cwd, "package.json"));
  const scripts = packageJson?.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
  for (const scriptName of ["benchmark", "bench", "perf", "profile"]) {
    if (scripts[scriptName]) return `npm run ${scriptName}`;
  }
  if (project.hasCMake && fs.existsSync(path.join(cwd, "build", "CTestTestfile.cmake"))) {
    return "ctest --test-dir build -R 'bench|benchmark|perf' --output-on-failure";
  }
  const entry = firstExistingProjectFile(cwd, ["bench.py", "benchmark.py", "perf.py", "test_benchmark.py", "train.py"]);
  if (entry) return `python3 ${shellQuote(entry)}`;
  return "";
}

function isEmptyPythonPackageInit(file) {
  if (!file || file.name !== "__init__.py") return false;
  return !readTextPrefix(file.full, 4_000).trim();
}

function benchmarkCandidateScore(file) {
  const base = String(file.name || "").toLowerCase();
  const rel = String(file.path || "").toLowerCase();
  if (base === "__init__.py") return 0;
  let score = 0;
  if (/^(run_)?benchmark(s)?\.py$/.test(base)) score += 110;
  else if (/^(run_)?bench\.py$/.test(base)) score += 95;
  else if (/^(run_)?perf(ormance)?\.py$/.test(base)) score += 85;
  else if (/^test_.*benchmark.*\.py$/.test(base)) score += 60;
  else if (/(^|[/_-])(bench|benchmark|perf)([/_.-]|$)/i.test(rel)) score += 45;
  else if (/run_.*(bench|benchmark|perf|ops).*\.py$/i.test(base)) score += 35;
  const text = readTextPrefix(file.full, 40_000);
  if (/if\s+__name__\s*==\s*["']__main__["']/.test(text)) score += 30;
  if (/argparse|ArgumentParser|typer\.|click\./i.test(text)) score += 10;
  if (/print\s*\(|json\.dumps|benchmark/i.test(text)) score += 5;
  return score;
}

function detectBenchmarkMode(benchmarkCommand, files, languages) {
  const command = String(benchmarkCommand || "");
  const hasGoogleBenchmarkMarkers = files.some((file) =>
    /\.(cc|cpp|cxx|cu|h|hpp|txt|cmake)$/i.test(file.name)
    && /benchmark\/benchmark\.h|benchmark::/i.test(readTextPrefix(file.full, 60_000))
  );
  if (/--benchmark_/.test(command) || hasGoogleBenchmarkMarkers) return "google-benchmark";
  if (languages.includes("cuda") || languages.includes("triton")) return "cuda-kernel";
  return "generic";
}

function chooseSweepSpecCandidate(cwd, files) {
  const scored = files
    .filter((file) => /\.(ya?ml|json)$/i.test(file.name) && /sweep|grid|search/i.test(file.path))
    .map((file) => {
      let score = /sweep/i.test(file.name) ? 80 : 30;
      if (/m1|mlx|operator|ops|benchmark/i.test(file.name)) score += 15;
      if (/\.researchloop/i.test(file.path)) score -= 25;
      try {
        const spec = parseSweepSpec(fs.readFileSync(file.full, "utf8"));
        if (spec.command_template || spec.command) score += 25;
        if (spec.metric) score += 15;
      } catch {
        score -= 40;
      }
      return { file, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
  return scored[0]?.file || null;
}

function readSweepSpecCandidate(file) {
  if (!file) return null;
  try {
    const text = fs.readFileSync(file.full, "utf8");
    const spec = parseSweepSpec(text);
    return {
      path: file.path,
      text,
      spec,
    };
  } catch {
    return null;
  }
}

function chooseProfilerTool(tools, languages) {
  const hasCuda = languages.includes("cuda");
  if (hasCuda && tools.nsys?.present) return "nsys";
  if (hasCuda && tools.ncu?.present) return "ncu";
  if (process.platform === "linux" && tools.perf?.present) return "perf";
  return "time";
}

function chooseCompilerCommand(cwd, files, project, tools, buildCommand) {
  const firstCu = files.find((file) => /\.cu$/i.test(file.name));
  if (firstCu && tools.nvcc?.present) {
    return `mkdir -p build && nvcc -O3 -lineinfo -Xptxas -v ${shellQuote(firstCu.path)} -o build/autoresearch-kernel-probe`;
  }
  if (project.hasCMake && buildCommand) {
    return `${buildCommand} --verbose`;
  }
  const firstCpp = files.find((file) => /\.(cc|cpp|cxx)$/i.test(file.name));
  if (firstCpp && tools.clang?.present) {
    return `mkdir -p build && clang++ -O3 -Rpass=loop-vectorize -Rpass-missed=loop-vectorize ${shellQuote(firstCpp.path)} -o build/autoresearch-compiler-probe`;
  }
  return "";
}

function buildSweepDefaults(benchmarkCommand, languages) {
  if (!benchmarkCommand) {
    return { template: "", grid: "" };
  }
  if (languages.includes("cuda")) {
    return {
      template: `${benchmarkCommand} --block-size {block_size} --num-warps {num_warps}`,
      grid: JSON.stringify({ block_size: [128, 256], num_warps: [4, 8] }),
    };
  }
  if (languages.includes("python")) {
    return {
      template: `${benchmarkCommand} --batch-size {batch_size} --dtype {dtype}`,
      grid: JSON.stringify({ batch_size: [1, 4, 8], dtype: ["fp32", "fp16"] }),
    };
  }
  return {
    template: `${benchmarkCommand} --threads {threads}`,
    grid: JSON.stringify({ threads: [1, 2, 4, 8] }),
  };
}

function buildDashboardBatchSpecText({ name, metric, direction, commandTemplate, grid, maxRuns, maxParallel, maxRetries, timeoutSeconds, cudaVisibleDevices, stability }) {
  const stabilityConfig = normalizeQueueStabilityConfig(stability || {}, { defaultEnabled: true });
  const lines = [
    "version: 1",
    `name: ${sanitizeIdPart(name || "dashboard-batch-sweep", "dashboard-batch-sweep")}`,
    `metric: ${metric || "latency_ms"}`,
    `direction: ${direction || "lower"}`,
    `command_template: ${JSON.stringify(commandTemplate || "")}`,
    `timeout_seconds: ${Number(timeoutSeconds || 600) || 600}`,
    `max_parallel: ${Math.max(1, Number(maxParallel || 1) || 1)}`,
    "retry:",
    `  max_retries: ${Math.max(0, Number(maxRetries || 0) || 0)}`,
    "budget:",
    `  max_runs: ${Math.max(1, Number(maxRuns || 24) || 24)}`,
    "stability:",
    `  enabled: ${stabilityConfig.enabled ? "true" : "false"}`,
    `  top_k: ${stabilityConfig.top_k}`,
    `  repeats: ${stabilityConfig.repeats}`,
    `  aggregate: ${stabilityConfig.aggregate}`,
    "grid:",
  ];
  const deviceText = String(cudaVisibleDevices || "").trim();
  if (deviceText) lines.splice(6, 0, `cuda_visible_devices: ${JSON.stringify(deviceText)}`);
  for (const [key, values] of Object.entries(grid || {})) {
    if (!Array.isArray(values) || !values.length) continue;
    lines.push(`  ${key}: ${JSON.stringify(values)}`);
  }
  return `${lines.join("\n")}\n`;
}

function upsertSweepSpecMaxParallel(text, maxParallel) {
  const safeMax = normalizeQueueMaxParallel(maxParallel);
  const raw = String(text || "").trim();
  if (!raw) return raw;
  try {
    if (raw.startsWith("{") || raw.startsWith("[")) {
      const spec = parseSweepSpec(raw);
      return `${JSON.stringify({ ...spec, max_parallel: safeMax }, null, 2)}\n`;
    }
  } catch {
    return raw;
  }
  if (/^\s*max_parallel\s*:/m.test(raw)) {
    return `${raw.replace(/^\s*max_parallel\s*:.*$/m, `max_parallel: ${safeMax}`)}\n`;
  }
  if (/^\s*timeout_seconds\s*:/m.test(raw)) {
    return `${raw.replace(/^(\s*timeout_seconds\s*:.*)$/m, `$1\nmax_parallel: ${safeMax}`)}\n`;
  }
  if (/^\s*direction\s*:/m.test(raw)) {
    return `${raw.replace(/^(\s*direction\s*:.*)$/m, `$1\nmax_parallel: ${safeMax}`)}\n`;
  }
  try {
    const spec = parseSweepSpec(raw);
    return `${JSON.stringify({ ...spec, max_parallel: safeMax }, null, 2)}\n`;
  } catch {
    return raw;
  }
}

function buildDefaultBatchGrid(languages, benchmarkCommand, files) {
  const command = String(benchmarkCommand || "");
  if (/run_m1_safe_ops\.py/.test(command) || files.some((file) => file.name === "run_m1_safe_ops.py")) {
    return {
      op: ["matmul_256", "matmul_512", "layernorm_small", "softmax_small"],
      backend: ["mlx_cpu", "mlx_gpu", "mlx_gpu_compile"],
    };
  }
  if (/run_benchmark\.py/.test(command) && files.some((file) => /mlx_benchmark/.test(file.path))) {
    return {
      include_mlx_gpu: ["True"],
      include_mlx_gpu_compile: ["True", "False"],
      include_mlx_cpu: ["True", "False"],
      include_mps: ["True", "False"],
      include_cpu: ["False"],
    };
  }
  if (languages.includes("cuda") || languages.includes("triton")) {
    return {
      block_size: [128, 256],
      num_warps: [4, 8],
      dtype: ["fp16", "bf16"],
    };
  }
  if (languages.includes("python")) {
    return {
      batch_size: [1, 4, 8],
      dtype: ["fp32", "fp16"],
      seed: [1, 2],
    };
  }
  return { threads: [1, 2, 4, 8] };
}

function appendGridParamsToCommandTemplate(commandTemplate, grid) {
  let out = String(commandTemplate || "").trim();
  for (const key of Object.keys(grid || {})) {
    if (out.includes(`{${key}}`)) continue;
    out = `${out} --${key.replace(/_/g, "-")} {${key}}`.trim();
  }
  return out;
}

function detectProjectEnvironment(cwd, systemSnapshot = null, force = false) {
  const key = path.resolve(cwd || process.cwd());
  const now = Date.now();
  const cached = systemMetricsCache.envByCwd.get(key);
  if (!force && cached && now - cached.ts < 10_000) return cached.data;

  const files = listProjectFiles(key);
  const fileNames = new Set(files.map((file) => file.path));
  const languages = [];
  const addLanguage = (name, present) => {
    if (present && !languages.includes(name)) languages.push(name);
  };
  addLanguage("cuda", files.some((file) => /\.(cu|cuh)$/i.test(file.name)));
  addLanguage("c++", files.some((file) => /\.(cc|cpp|cxx|hpp|hxx)$/i.test(file.name)));
  addLanguage("c", files.some((file) => /\.(c|h)$/i.test(file.name)));
  addLanguage("python", files.some((file) => /\.py$/i.test(file.name)) || fileNames.has("pyproject.toml") || fileNames.has("requirements.txt"));
  addLanguage("triton", files.some((file) => /\.py$/i.test(file.name) && /triton/i.test(readTextPrefix(file.full, 20_000))));
  addLanguage("node", fileNames.has("package.json"));

  const hasCMake = fileNames.has("CMakeLists.txt");
  const hasMakefile = fileNames.has("Makefile") || fileNames.has("makefile");
  const hasPyProject = fileNames.has("pyproject.toml") || fileNames.has("requirements.txt") || fileNames.has("setup.py");
  const hasCompileCommands = files.some((file) => file.name === "compile_commands.json");
  const tools = readPerformanceToolStatus();
  const system = systemSnapshot || readSystemMetrics(key);
  const buildCommand = hasCMake
    ? chooseCMakeBuildCommand(key)
    : hasMakefile
      ? "make -j"
      : "";
  const benchmarkCommand = chooseBenchmarkCandidate(key, files, { hasCMake, hasMakefile, hasPyProject });
  const benchmarkMode = detectBenchmarkMode(benchmarkCommand, files, languages);
  const metric = benchmarkMode === "google-benchmark" ? "real_time" : "latency_ms";
  const profiler = chooseProfilerTool(tools, languages);
  const compilerCommand = chooseCompilerCommand(key, files, { hasCMake }, tools, buildCommand);
  const sweepDefaults = buildSweepDefaults(benchmarkCommand, languages);
  const sweepCandidate = readSweepSpecCandidate(chooseSweepSpecCandidate(key, files));
  const batchGrid = buildDefaultBatchGrid(languages, benchmarkCommand, files);
  const batchCommandTemplate = sweepCandidate?.spec?.command_template || sweepCandidate?.spec?.command || appendGridParamsToCommandTemplate(sweepDefaults.template || benchmarkCommand, batchGrid);
  const batchMetric = sweepCandidate?.spec?.metric || metric;
  const batchDirection = sweepCandidate?.spec?.direction || "lower";
  const batchMaxRuns = sweepCandidate?.spec?.budget?.max_runs || sweepCandidate?.spec?.max_runs || 24;
  const batchDevicePool = sweepCandidate?.spec?.cuda_visible_devices || sweepCandidate?.spec?.device_pool || "";
  const batchParallelism = recommendedQueueParallelism(system, {
    languages,
    benchmarkCommand,
    commandTemplate: batchCommandTemplate,
    sweepName: sweepCandidate?.spec?.name || "auto-perf-sweep",
    devicePool: batchDevicePool,
    cudaVisibleDevices: batchDevicePool,
  });
  const batchMaxParallel = batchParallelism.max_parallel;
  const batchMaxRetries = sweepCandidate?.spec?.retry?.max_retries ?? 1;
  const batchStability = normalizeQueueStabilityConfig(sweepCandidate?.spec?.stability || {}, {
    defaultEnabled: true,
    topK: 5,
    repeats: 3,
    aggregate: "median",
  });
  const batchSweepSpec = sweepCandidate?.text ? upsertSweepSpecMaxParallel(sweepCandidate.text, batchMaxParallel) : buildDashboardBatchSpecText({
    name: sweepCandidate?.spec?.name || "auto-perf-sweep",
    metric: batchMetric,
    direction: batchDirection,
    commandTemplate: batchCommandTemplate,
    grid: batchGrid,
    maxRuns: batchMaxRuns,
    maxParallel: batchMaxParallel,
    maxRetries: batchMaxRetries,
    timeoutSeconds: sweepCandidate?.spec?.timeout_seconds || sweepCandidate?.spec?.timeout || 600,
    cudaVisibleDevices: Array.isArray(batchDevicePool) ? batchDevicePool.join(",") : batchDevicePool,
    stability: batchStability,
  });
  const device = languages.includes("cuda") && tools["nvidia-smi"]?.present
    ? "cuda"
    : system.compute?.effective || "auto";
  const profileArgs = profiler === "nsys" ? "--trace=cuda,nvtx,osrt"
    : profiler === "ncu" ? "--set full"
      : "";
  const markers = [
    hasCMake ? "CMakeLists.txt" : "",
    hasMakefile ? "Makefile" : "",
    hasPyProject ? "Python env" : "",
    hasCompileCommands ? "compile_commands.json" : "",
    languages.includes("cuda") ? "CUDA sources" : "",
    languages.includes("triton") ? "Triton imports" : "",
  ].filter(Boolean);
  const warnings = [];
  if (languages.includes("cuda") && !tools.nvcc?.present) warnings.push("检测到 CUDA 源码，但本机没有 nvcc。");
  if (languages.includes("cuda") && !tools["nvidia-smi"]?.present) warnings.push("检测到 CUDA 项目，但本机没有 NVIDIA GPU/CUDA 运行环境。");
  if (!benchmarkCommand) warnings.push("没有找到明确的 benchmark 入口，需要手动填写 Benchmark 命令。");
  if (sweepCandidate?.path) warnings.push(`已发现参数扫描配置：${sweepCandidate.path}`);
  if (profiler === "time") warnings.push("未检测到 Nsight/perf，已回退到系统 time。");

  const recommendedConfig = {
    runner: languages.includes("cuda") || languages.includes("python") ? "python3" : "custom",
    device,
    metric: batchMetric || metric,
    direction: batchDirection || "lower",
    buildCommand,
    benchmarkMode,
    benchmarkCommand,
    benchmarkRepeat: benchmarkMode === "google-benchmark" ? "5" : "",
    benchmarkMinTime: benchmarkMode === "google-benchmark" ? "0.5s" : "",
    profileTool: profiler,
    profileArgs,
    profileCommand: benchmarkCommand,
    compilerCommand,
    compilerFlags: "",
    sweepName: sweepCandidate?.spec?.name || "auto-perf-sweep",
    sweepTemplate: batchCommandTemplate,
    sweepGrid: sweepCandidate?.spec?.grid ? JSON.stringify(sweepCandidate.spec.grid) : sweepDefaults.grid,
    batchSweepSpec,
    batchCommandTemplate,
    batchParamGrid: JSON.stringify(batchGrid),
    batchMaxRuns: String(batchMaxRuns || ""),
    batchMaxParallel: String(batchMaxParallel || "1"),
    batchMaxParallelSource: "hardware_auto",
    batchMaxParallelReason: batchParallelism.reason,
    batchDevicePool: Array.isArray(batchDevicePool) ? batchDevicePool.join(",") : String(batchDevicePool || ""),
    batchMaxRetries: String(batchMaxRetries ?? ""),
    batchStabilityEnabled: batchStability.enabled ? "true" : "false",
    batchStabilityTopK: String(batchStability.top_k),
    batchStabilityRepeats: String(batchStability.repeats),
    perfMetrics: "latency_ms,throughput,tflops,gbps,real_time",
    allowLocalPerf: "true",
  };
  const data = {
    generatedAt: new Date().toISOString(),
    project: {
      path: key,
      languages,
      markers,
      buildSystem: hasCMake ? "cmake" : hasMakefile ? "make" : hasPyProject ? "python" : fileNames.has("package.json") ? "node" : "unknown",
      filesScanned: files.length,
    },
    hardware: {
      platform: system.platform,
      cpu: system.cpu,
      memory: system.memory,
      gpu: system.gpu,
      compute: system.compute,
      queueParallelism: batchParallelism,
    },
    tools,
    recommendations: recommendedConfig,
    warnings,
  };
  systemMetricsCache.envByCwd.set(key, { ts: now, data });
  return data;
}

function formatBytesCompact(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let scaled = n;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

function probePythonPackages(cwd, python = "python3") {
  const pythonCmd = String(python || "python3").trim() || "python3";
  const version = runCapture(`${shellQuote(pythonCmd)} --version 2>&1`, cwd);
  if (!version.ok) {
    return {
      executable: pythonCmd,
      ok: false,
      version: null,
      packages: [],
      error: version.output || "python not found",
    };
  }

  const probeScript = `
import importlib.util
import json
try:
    from importlib import metadata
except Exception:
    metadata = None

packages = [
    {"name": "numpy", "module": "numpy", "dist": "numpy", "role": "local numeric benchmark"},
    {"name": "torch", "module": "torch", "dist": "torch", "role": "PyTorch baseline, MPS, CUDA"},
    {"name": "triton", "module": "triton", "dist": "triton", "role": "Triton operator kernels"},
    {"name": "transformers", "module": "transformers", "dist": "transformers", "role": "LLM model loading"},
    {"name": "vllm", "module": "vllm", "dist": "vllm", "role": "remote NVIDIA LLM serving"},
    {"name": "sglang", "module": "sglang", "dist": "sglang", "role": "remote NVIDIA LLM serving"},
    {"name": "mlx", "module": "mlx", "dist": "mlx", "role": "Apple Silicon local LLM"},
    {"name": "llama_cpp", "module": "llama_cpp", "dist": "llama-cpp-python", "role": "llama.cpp Python binding"},
]

out = []
for item in packages:
    present = False
    error = None
    try:
        present = importlib.util.find_spec(item["module"]) is not None
    except Exception as exc:
        error = str(exc)
    version = None
    if present and metadata is not None:
        try:
            version = metadata.version(item["dist"])
        except Exception:
            version = None
    details = {}
    if present and item["name"] == "torch":
        try:
            import torch
            details["cuda_available"] = bool(torch.cuda.is_available())
            details["cuda_version"] = torch.version.cuda or None
            details["mps_available"] = bool(
                hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            )
            details["device_count"] = int(torch.cuda.device_count()) if torch.cuda.is_available() else 0
        except Exception as exc:
            details["import_error"] = str(exc)
    out.append({
        "name": item["name"],
        "module": item["module"],
        "role": item["role"],
        "present": present,
        "version": version,
        "details": details,
        "error": error,
    })

print(json.dumps(out, sort_keys=True))
`.trim();

  const probe = runCapture(`${shellQuote(pythonCmd)} - <<'PY'\n${probeScript}\nPY`, cwd);
  if (!probe.ok) {
    return {
      executable: pythonCmd,
      ok: false,
      version: version.output,
      packages: [],
      error: probe.output || "package probe failed",
    };
  }
  try {
    return {
      executable: pythonCmd,
      ok: true,
      version: version.output,
      packages: JSON.parse(probe.output),
      error: null,
    };
  } catch (err) {
    return {
      executable: pythonCmd,
      ok: false,
      version: version.output,
      packages: [],
      error: `package probe JSON parse failed: ${err.message}`,
    };
  }
}

function readRemoteGpuConfig(cwd) {
  const file = path.join(cwd, ".researchloop", "remote-gpu.json");
  const fromFile = readJsonIfExists(file);
  const envHost = String(process.env.RESEARCHLOOP_REMOTE_GPU_HOST || process.env.AUTORESEARCH_REMOTE_GPU_HOST || "").trim();
  const envUser = String(process.env.RESEARCHLOOP_REMOTE_GPU_USER || process.env.AUTORESEARCH_REMOTE_GPU_USER || "").trim();
  const envPath = String(process.env.RESEARCHLOOP_REMOTE_GPU_PATH || process.env.AUTORESEARCH_REMOTE_GPU_PATH || "").trim();
  return {
    file: fs.existsSync(file) ? path.relative(cwd, file) : null,
    configured: Boolean(fromFile?.host || envHost),
    host: fromFile?.host || envHost || null,
    user: fromFile?.user || envUser || null,
    remotePath: fromFile?.remotePath || fromFile?.remote_path || envPath || null,
  };
}

function packageByName(packages, name) {
  return (packages || []).find((pkg) => pkg.name === name) || null;
}

function buildAiInfraReadiness({ currentEnv, detection, pythonProbe, remoteConfig }) {
  const tools = detection.tools || {};
  const system = detection.hardware || {};
  const packages = pythonProbe.packages || [];
  const torch = packageByName(packages, "torch");
  const numpy = packageByName(packages, "numpy");
  const hasCompiler = Boolean(tools.clang?.present || tools.gcc?.present || tools["g++"]?.present);
  const hasBuildTool = Boolean(tools.cmake?.present || tools.make?.present || tools.ninja?.present);
  const cudaTools = Boolean(tools.nvcc?.present && tools["nvidia-smi"]?.present);
  const cudaPython = currentEnv.cuda_available === true || torch?.details?.cuda_available === true;
  const mpsPython = torch?.details?.mps_available === true;
  const profilerReady = Boolean(tools.nsys?.present || tools.ncu?.present || (process.platform === "linux" && tools.perf?.present) || tools.time?.present);

  const readiness = {
    local_python_smoke: {
      ready: Boolean(pythonProbe.ok),
      status: pythonProbe.ok ? "ready" : "missing",
      evidence: pythonProbe.version || pythonProbe.error || "not detected",
    },
    local_python_benchmark: {
      ready: Boolean(pythonProbe.ok),
      status: pythonProbe.ok ? (numpy?.present ? "ready_with_numpy" : "ready_stdlib") : "missing",
      evidence: numpy?.present ? `numpy ${numpy.version || ""}`.trim() : "stdlib benchmark path available",
    },
    local_cpp_benchmark: {
      ready: hasBuildTool && hasCompiler,
      status: hasBuildTool && hasCompiler ? "ready" : "partial",
      evidence: [
        tools.cmake?.present ? "cmake" : "",
        tools.make?.present ? "make" : "",
        tools.ninja?.present ? "ninja" : "",
        tools.clang?.present ? "clang" : "",
        tools.gcc?.present ? "gcc" : "",
        tools["g++"]?.present ? "g++" : "",
      ].filter(Boolean).join(", ") || "build tools incomplete",
    },
    apple_mps_path: {
      ready: Boolean(process.platform === "darwin" && system.gpu?.present),
      status: mpsPython ? "ready_with_torch_mps" : (process.platform === "darwin" && system.gpu?.present ? "hardware_ready_needs_framework" : "unavailable"),
      evidence: mpsPython ? "torch.backends.mps is available" : (system.gpu?.name || "not Apple Silicon/MPS"),
    },
    local_cuda: {
      ready: cudaTools && cudaPython,
      status: cudaTools && cudaPython ? "ready" : "unavailable",
      evidence: cudaTools
        ? `nvcc=${tools.nvcc?.path || "present"}, nvidia-smi=${tools["nvidia-smi"]?.path || "present"}`
        : "nvcc or nvidia-smi not detected locally",
    },
    profiler: {
      ready: profilerReady,
      status: profilerReady ? "ready" : "missing",
      evidence: [
        tools.nsys?.present ? "nsys" : "",
        tools.ncu?.present ? "ncu" : "",
        tools.perf?.present ? "perf" : "",
        tools.time?.present ? "time" : "",
      ].filter(Boolean).join(", ") || "no profiler fallback detected",
    },
    remote_cuda: {
      ready: Boolean(remoteConfig.configured),
      status: remoteConfig.configured ? "configured" : "not_configured",
      evidence: remoteConfig.configured ? `${remoteConfig.user ? `${remoteConfig.user}@` : ""}${remoteConfig.host}` : "add .researchloop/remote-gpu.json when a remote NVIDIA host is available",
    },
  };

  const aiInfra = {
    localPythonReady: readiness.local_python_smoke.ready,
    localCppBenchmarkReady: readiness.local_cpp_benchmark.ready,
    appleMpsPathReady: readiness.apple_mps_path.ready,
    cudaLocalReady: readiness.local_cuda.ready,
    remoteCudaConfigured: readiness.remote_cuda.ready,
    profilerReady: readiness.profiler.ready,
    recommendedExecutionMode: readiness.local_cuda.ready
      ? "local-cuda"
      : readiness.remote_cuda.ready
        ? "remote-cuda"
        : "mac-local-python-cpp",
  };

  return { readiness, aiInfra };
}

function buildAiInfraRecommendations(report) {
  const recs = [];
  if (!report.aiInfra.cudaLocalReady) {
    recs.push("Use this Mac for orchestration, Python/C++ smoke benchmarks, reports, and ledger capture; run real CUDA kernels on a remote NVIDIA Linux host.");
  }
  if (!report.aiInfra.remoteCudaConfigured) {
    recs.push("Create .researchloop/remote-gpu.json later with host, user, port, remotePath, python, and projectSync when a CUDA server is available.");
  }
  if (!packageByName(report.python.packages, "torch")?.present) {
    recs.push("Install PyTorch only when a local MPS or PyTorch baseline is needed; the scaffolded Python benchmark works with the standard library.");
  }
  if (!report.project.recommendations?.benchmarkCommand) {
    recs.push("Generate a benchmark scaffold or add a bench.py/benchmark.py entry so runs can be captured automatically.");
  }
  recs.push("For benchmark claims, use warmup, repeated runs, median/p95 metrics, and record the command through autoresearch run.");
  return recs;
}

function buildAiInfraReport(cwd, opts = {}) {
  const python = String(opts.python || "python3").trim() || "python3";
  const system = readSystemMetrics(cwd);
  const detection = detectProjectEnvironment(cwd, system, true);
  const currentEnv = captureEnv(cwd, python);
  const pythonProbe = probePythonPackages(cwd, python);
  const remoteConfig = readRemoteGpuConfig(cwd);
  const { readiness, aiInfra } = buildAiInfraReadiness({
    currentEnv,
    detection,
    pythonProbe,
    remoteConfig,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    cwd: path.resolve(cwd),
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      cpu: system.cpu,
      memory: system.memory,
      gpu: system.gpu,
      disk: system.disk,
      compute: system.compute,
    },
    python: pythonProbe,
    env: currentEnv,
    project: detection,
    remote: remoteConfig,
    readiness,
    aiInfra,
    recommendations: [],
  };
  report.recommendations = buildAiInfraRecommendations(report);
  return report;
}

function renderAiInfraText(report, files = null) {
  const lines = [
    "AutoResearch-AI Infra Doctor",
    `cwd: ${report.cwd}`,
    `mode: ${report.aiInfra.recommendedExecutionMode}`,
    `python: ${report.python.version || report.python.error || "not found"}`,
    `platform: ${report.host.platform}`,
    `cpu: ${report.host.cpu?.count || "?"} cores, ${report.host.cpu?.model || "unknown"}`,
    `memory: ${formatBytesCompact(report.host.memory?.totalBytes)} total, ${report.host.memory?.usagePct ?? "?"}% used`,
    `gpu: ${report.host.gpu?.present ? report.host.gpu.name : "not detected"} (${report.host.gpu?.source || "none"})`,
    "",
    "Readiness:",
  ];
  for (const [key, item] of Object.entries(report.readiness || {})) {
    lines.push(`- ${key}: ${item.status} (${item.evidence})`);
  }
  lines.push("");
  lines.push("Python AI packages:");
  for (const pkg of report.python.packages || []) {
    lines.push(`- ${pkg.name}: ${pkg.present ? `present${pkg.version ? ` ${pkg.version}` : ""}` : "missing"} - ${pkg.role}`);
  }
  lines.push("");
  lines.push("Recommendations:");
  report.recommendations.forEach((rec, index) => lines.push(`${index + 1}. ${rec}`));
  if (files) {
    lines.push("");
    lines.push(`wrote: ${files.json}, ${files.markdown}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAiInfraMarkdown(report) {
  const rows = Object.entries(report.readiness || {}).map(([key, item]) => [
    key,
    item.status,
    item.evidence,
  ]);
  const packageRows = (report.python.packages || []).map((pkg) => [
    pkg.name,
    pkg.present ? "present" : "missing",
    pkg.version || "",
    pkg.role,
  ]);
  return [
    "# AutoResearch-AI Infra Environment",
    "",
    `Generated: ${report.generatedAt}`,
    `Project: \`${report.cwd}\``,
    `Recommended mode: \`${report.aiInfra.recommendedExecutionMode}\``,
    "",
    "## Host",
    "",
    `- Platform: ${report.host.platform}`,
    `- CPU: ${report.host.cpu?.count || "?"} cores, ${report.host.cpu?.model || "unknown"}`,
    `- Memory: ${formatBytesCompact(report.host.memory?.totalBytes)} total`,
    `- GPU: ${report.host.gpu?.present ? report.host.gpu.name : "not detected"} (${report.host.gpu?.source || "none"})`,
    `- Compute: ${report.host.compute?.label || "unknown"} (${report.host.compute?.reason || "unknown"})`,
    "",
    "## Readiness",
    "",
    markdownTable(["Area", "Status", "Evidence"], rows),
    "",
    "## Python AI Packages",
    "",
    markdownTable(["Package", "State", "Version", "Role"], packageRows),
    "",
    "## Recommendations",
    "",
    ...report.recommendations.map((rec, index) => `${index + 1}. ${rec}`),
    "",
  ].join("\n");
}

function writeAiInfraReport(cwd, report) {
  const dir = path.join(cwd, ".researchloop", "env");
  ensureDir(dir);
  const jsonFile = path.join(dir, "environment.json");
  const markdownFile = path.join(dir, "environment.md");
  fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownFile, renderAiInfraMarkdown(report));
  return {
    json: path.relative(cwd, jsonFile),
    markdown: path.relative(cwd, markdownFile),
  };
}

function cmdInfraDoctor() {
  const cwd = targetDir();
  const report = buildAiInfraReport(cwd, {
    python: String(option("--python", "python3")),
  });
  const files = hasFlag("--write") ? writeAiInfraReport(cwd, report) : null;
  const format = String(option("--format", "text")).toLowerCase();
  if (format === "json") {
    console.log(JSON.stringify(files ? { ...report, files } : report, null, 2));
    return;
  }
  process.stdout.write(renderAiInfraText(report, files));
}

function scaffoldTemplateNames() {
  return ["python-benchmark", "cpp-benchmark", "cuda-basic", "triton-operator", "llm-serving"];
}

function pythonBenchmarkScaffold(projectName) {
  const benchPy = `#!/usr/bin/env python3
import argparse
import math
import statistics
import time


def make_input(size, seed):
    return [(((i * 1103515245 + seed * 12345) & 0xFFFF) / 65535.0) - 0.5 for i in range(size)]


def rmsnorm(values, eps):
    inv = 1.0 / math.sqrt(sum(v * v for v in values) / len(values) + eps)
    return [v * inv for v in values]


def percentile(values, q):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(q * len(ordered)) - 1))
    return ordered[index]


def main():
    parser = argparse.ArgumentParser(description="Stdlib RMSNorm-like benchmark for AutoResearch-AI.")
    parser.add_argument("--size", type=int, default=65536)
    parser.add_argument("--repeat", type=int, default=9)
    parser.add_argument("--warmup", type=int, default=2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--eps", type=float, default=1e-6)
    args = parser.parse_args()

    values = make_input(max(1, args.size), args.seed)
    for _ in range(max(0, args.warmup)):
        rmsnorm(values, args.eps)

    times_ms = []
    checksum = 0.0
    for _ in range(max(1, args.repeat)):
        start = time.perf_counter()
        out = rmsnorm(values, args.eps)
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        times_ms.append(elapsed_ms)
        checksum += out[-1]

    p50 = statistics.median(times_ms)
    p95 = percentile(times_ms, 0.95)
    # Approximate traffic: read input once for sum, read input again for scale, write output.
    traffic_bytes = len(values) * 8 * 3
    gbps = (traffic_bytes / 1e9) / (p50 / 1000.0) if p50 > 0 else 0.0
    items_s = len(values) / (p50 / 1000.0) if p50 > 0 else 0.0

    print(f"latency_ms={p50:.6f}")
    print(f"latency_ms_p50={p50:.6f}")
    print(f"latency_ms_p95={p95:.6f}")
    print(f"throughput_items_s={items_s:.2f}")
    print(f"bandwidth_gb_s={gbps:.6f}")
    print(f"checksum={checksum:.6f}")


if __name__ == "__main__":
    main()
`;

  return {
    "README.md": `# ${projectName}

Mac-safe AI Infra benchmark scaffold generated by AutoResearch-AI.

This project uses only the Python standard library. It is meant for local run-loop testing on machines without CUDA, while keeping the same ledger/report workflow used for later CUDA or remote GPU experiments.

## Run

\`\`\`bash
python3 bench.py --size 65536 --repeat 9 --warmup 2
autoresearch run --metric latency_ms --direction lower --command "python3 bench.py --size 65536 --repeat 9 --warmup 2"
autoresearch compare --metric latency_ms --direction lower
autoresearch report --format markdown --out .researchloop/scratchpad/report.md --include-plots
\`\`\`

The benchmark prints latency, p95 latency, throughput, approximate bandwidth, and a checksum.
`,
    "bench.py": benchPy,
    "configs/benchmark.json": `${JSON.stringify({
      metric: "latency_ms",
      direction: "lower",
      warmup: 2,
      repeat: 9,
      size: 65536,
    }, null, 2)}\n`,
    ".researchloop/config.yaml": [
      "project_type: python-benchmark",
      "primary_metric: latency_ms",
      "direction: lower",
      "benchmark_command: python3 bench.py --size 65536 --repeat 9 --warmup 2",
      "",
    ].join("\n"),
    "reports/README.md": "# Reports\n\nGenerated benchmark and portfolio reports can live here.\n",
  };
}

function cppBenchmarkScaffold(projectName) {
  return {
    "README.md": `# ${projectName}

Minimal C++ benchmark scaffold. It avoids external dependencies so the first smoke test can run on macOS.
`,
    "CMakeLists.txt": [
      "cmake_minimum_required(VERSION 3.20)",
      `project(${projectName.replace(/[^A-Za-z0-9_]/g, "_")} LANGUAGES CXX)`,
      "set(CMAKE_CXX_STANDARD 17)",
      "add_executable(cache_walk bench/cache_walk.cpp)",
      "",
    ].join("\n"),
    "bench/cache_walk.cpp": [
      "#include <chrono>",
      "#include <cmath>",
      "#include <iostream>",
      "#include <vector>",
      "",
      "int main() {",
      "  constexpr int n = 1 << 20;",
      "  std::vector<double> x(n, 1.0);",
      "  volatile double sink = 0.0;",
      "  auto start = std::chrono::steady_clock::now();",
      "  for (int r = 0; r < 20; ++r) {",
      "    for (int i = 0; i < n; ++i) sink += std::sqrt(x[i]);",
      "  }",
      "  auto end = std::chrono::steady_clock::now();",
      "  double ms = std::chrono::duration<double, std::milli>(end - start).count();",
      "  std::cout << \"latency_ms=\" << ms << \"\\n\";",
      "  std::cout << \"checksum=\" << sink << \"\\n\";",
      "  return 0;",
      "}",
      "",
    ].join("\n"),
    ".researchloop/config.yaml": "project_type: cpp-benchmark\nprimary_metric: latency_ms\ndirection: lower\n",
  };
}

function cudaBasicScaffold(projectName) {
  return {
    "README.md": `# ${projectName}

CUDA basic scaffold for remote NVIDIA Linux execution. This Mac can create and track the project, but compiling requires a host with nvcc and an NVIDIA GPU.
`,
    "CMakeLists.txt": [
      "cmake_minimum_required(VERSION 3.24)",
      `project(${projectName.replace(/[^A-Za-z0-9_]/g, "_")} LANGUAGES CUDA CXX)`,
      "add_executable(vector_add src/vector_add.cu)",
      "set_target_properties(vector_add PROPERTIES CUDA_SEPARABLE_COMPILATION ON)",
      "",
    ].join("\n"),
    "src/vector_add.cu": [
      "#include <cstdio>",
      "",
      "__global__ void vector_add(const float* a, const float* b, float* c, int n) {",
      "  int i = blockIdx.x * blockDim.x + threadIdx.x;",
      "  if (i < n) c[i] = a[i] + b[i];",
      "}",
      "",
      "int main() {",
      "  std::puts(\"CUDA vector_add scaffold: compile and benchmark on a remote NVIDIA host.\");",
      "  return 0;",
      "}",
      "",
    ].join("\n"),
    ".researchloop/config.yaml": "project_type: cuda-basic\nprimary_metric: latency_ms\ndirection: lower\nrequires_remote_cuda: true\n",
  };
}

function tritonOperatorScaffold(projectName) {
  return {
    "README.md": `# ${projectName}

Triton operator scaffold. Use it on a Python environment with torch and triton installed.
`,
    "bench_triton.py": [
      "#!/usr/bin/env python3",
      "import importlib.util",
      "if importlib.util.find_spec('torch') is None or importlib.util.find_spec('triton') is None:",
      "    print('latency_ms=nan')",
      "    raise SystemExit('torch and triton are required for this scaffold')",
      "print('latency_ms=0.0')",
      "",
    ].join("\n"),
    ".researchloop/config.yaml": "project_type: triton-operator\nprimary_metric: latency_ms\ndirection: lower\n",
  };
}

function llmServingScaffold(projectName) {
  return {
    "README.md": `# ${projectName}

LLM serving benchmark scaffold. Fill in the endpoint and model, then record TTFT, TPOT, throughput, and p95 latency through AutoResearch-AI.
`,
    "configs/loadtest.json": `${JSON.stringify({
      backend: "openai-compatible",
      endpoint: "http://127.0.0.1:8000/v1/chat/completions",
      model: "local-model",
      concurrency: [1, 4, 8],
      output_tokens: [64, 128],
    }, null, 2)}\n`,
    ".researchloop/config.yaml": "project_type: llm-serving\nprimary_metric: p95_latency_ms\ndirection: lower\n",
  };
}

function scaffoldFilesForTemplate(template, projectName) {
  if (template === "python-benchmark") return pythonBenchmarkScaffold(projectName);
  if (template === "cpp-benchmark") return cppBenchmarkScaffold(projectName);
  if (template === "cuda-basic") return cudaBasicScaffold(projectName);
  if (template === "triton-operator") return tritonOperatorScaffold(projectName);
  if (template === "llm-serving") return llmServingScaffold(projectName);
  return null;
}

function cmdScaffold() {
  const template = String(option("--template", option("--type", "python-benchmark"))).trim() || "python-benchmark";
  if (template === "list" || hasFlag("--list")) {
    console.log(scaffoldTemplateNames().join("\n"));
    return;
  }
  const valid = scaffoldTemplateNames();
  if (!valid.includes(template)) {
    console.error(`Unknown scaffold template: ${template}`);
    console.error(`Available templates: ${valid.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const force = hasFlag("--force");
  const outRaw = option("--out", "") || positionalText(["--template", "--type", "--out", "--agent"]);
  const outDir = path.resolve(expandUserPath(outRaw || `./autoresearch-${template}`));
  const projectName = slugify(path.basename(outDir) || `autoresearch-${template}`).replace(/-/g, "_");
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length > 0 && !force) {
    console.error(`Destination is not empty: ${outDir}`);
    console.error("Use --force to allow writing missing files into the existing directory.");
    process.exitCode = 1;
    return;
  }

  ensureDir(outDir);
  copyDir(path.join(templatesRoot, "base"), path.join(outDir, ".researchloop"), force);
  copyDir(path.join(templatesRoot, "adapters"), path.join(outDir, ".researchloop", "adapters"), force);
  installAgentFile(outDir, String(option("--agent", "codex")), force);

  const files = scaffoldFilesForTemplate(template, projectName);
  const written = [];
  const skipped = [];
  for (const [rel, content] of Object.entries(files)) {
    const ok = writeFileSafe(path.join(outDir, rel), content, force);
    (ok ? written : skipped).push(rel);
    if (rel.endsWith(".py")) {
      try {
        fs.chmodSync(path.join(outDir, rel), 0o755);
      } catch {
        // chmod is best-effort.
      }
    }
  }
  const profile = detectRepo(outDir);
  fs.writeFileSync(path.join(outDir, ".researchloop", "repo-profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  const envReport = buildAiInfraReport(outDir, { python: String(option("--python", "python3")) });
  const envFiles = writeAiInfraReport(outDir, envReport);

  console.log(`Scaffolded ${template} project at ${outDir}`);
  console.log(`written_files: ${written.length}`);
  if (skipped.length) console.log(`skipped_existing: ${skipped.join(", ")}`);
  console.log(`environment_report: ${envFiles.markdown}`);
  if (template === "python-benchmark") {
    console.log('next: autoresearch run --metric latency_ms --direction lower --command "python3 bench.py --size 65536 --repeat 9 --warmup 2"');
  }
}

function dashboardRunnerExecutable(runner) {
  const normalized = String(runner || "python3").trim();
  if (normalized === "custom") return "";
  if (normalized === "cuda") return "python3";
  return normalized || "python3";
}

function buildDashboardCommand(config, variant = "experiment") {
  const runner = String(config.runner || "python3").trim();
  const entry = String(config.entry || "").trim();
  const customCommand = String(config.command || "").trim();
  if (customCommand) return customCommand;
  if (!entry) return "";

  const paramText = variant === "baseline"
    ? String(config.baselineArgs || "").trim()
    : String(config.experimentArgs || "").trim();
  const executable = dashboardRunnerExecutable(runner);
  const prefix = executable ? `${shellQuote(executable)} ` : "";
  return `${prefix}${shellQuote(entry)}${paramText ? ` ${paramText}` : ""}`.trim();
}

function compareDashboardRowsByMetric(a, b, primaryMetric, preferHigher) {
  const av = runMetricValue(a, primaryMetric);
  const bv = runMetricValue(b, primaryMetric);
  if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
  if (!Number.isFinite(av)) return 1;
  if (!Number.isFinite(bv)) return -1;
  return preferHigher ? bv - av : av - bv;
}

function selectDashboardRunsForPayload(runs, primaryMetric, preferHigher, limit = 500) {
  if (!Array.isArray(runs) || runs.length <= limit) return runs || [];
  const selected = new Map();
  const add = (row) => {
    if (row && row.id && !selected.has(row.id)) selected.set(row.id, row);
  };

  runs
    .filter((row) => row && !row.parse_error)
    .filter((row) => String(row.id || "").toLowerCase().includes("baseline") || (row.tags || []).includes("baseline"))
    .slice(0, 20)
    .forEach(add);

  runs
    .filter((row) => row && !row.parse_error)
    .slice()
    .sort((a, b) => compareDashboardRowsByMetric(a, b, primaryMetric, preferHigher))
    .slice(0, Math.floor(limit * 0.7))
    .forEach(add);

  [...runs].reverse().slice(0, limit - selected.size).forEach(add);
  return [...selected.values()].slice(0, limit);
}

function compactDashboardTracePayload(traces, limit = 1000) {
  if (!Array.isArray(traces) || traces.length <= limit) return traces || [];
  return traces.map((trace) => ({
    id: trace.id,
    status: trace.status,
    final: trace.final,
    values: Number.isFinite(Number(trace.final)) ? [{ step: 1, value: Number(trace.final) }] : [],
    color: trace.color,
    isBest: trace.isBest,
    isLatest: trace.isLatest,
    index: trace.index,
  }));
}

function buildDashboardState(cwd, systemSnapshot = null) {
  const goalPath = path.join(cwd, ".researchloop", "goal.md");
  const planPath = path.join(cwd, ".researchloop", "plan.md");
  const profilePath = path.join(cwd, ".researchloop", "repo-profile.json");
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  const goal = parseGoalFile(goalPath);
  const plan = parsePlanFile(planPath);
  let repoProfile = detectRepo(cwd);
  if (fs.existsSync(profilePath)) {
    try {
      repoProfile = JSON.parse(readTextIfExists(profilePath));
    } catch {
      repoProfile = detectRepo(cwd);
    }
  }
  const runs = parseRunsLedger(ledgerPath);
  const primaryMetric = choosePrimaryMetric(goal, runs);
  const preferHigher = String(goal.direction || "").toLowerCase().includes("high");
  const summary = summarizeDashboardRuns(runs, primaryMetric, preferHigher);
  const traces = buildRunTraces({
    cwd,
    runs,
    primaryMetric,
    preferHigher,
    readRunMetricSeries,
  });
  const lineage = buildRunLineage(runs, primaryMetric);
  const comparison = summarizeTraces(traces, preferHigher);
  const system = systemSnapshot || readSystemMetrics(cwd);
  const thread = readThreadTail(cwd, 24);
  const logTail = readLatestLogTail(cwd, runs, 30);
  const activeRun = detectActiveRun(cwd, runs, logTail);
  const dashboardConfig = readDashboardConfig(cwd);
  const metricTiers = readMetricTierConfig(cwd, dashboardConfig.metricProfile || "hpc_operator");
  const selectedBatchQueue = readSelectedMetricTierBatchQueue(cwd, dashboardConfig);
  const metricTierAnalysis = evaluateMetricTiers(runs, metricTiers, {
    batchQueue: selectedBatchQueue,
  });
  const performanceTools = readPerformanceToolStatus();
  const projectEnvironment = detectProjectEnvironment(cwd, system);
  const sweepQueues = listSweepQueues(cwd, 8);
  const researchArtifacts = readResearchArtifacts(cwd);
  const densePayload = runs.length > 1000 || traces.length > 1000;
  const payloadRuns = densePayload
    ? selectDashboardRunsForPayload(runs, primaryMetric, preferHigher, 500)
    : runs;
  const payloadTraces = densePayload
    ? compactDashboardTracePayload(traces, 1000)
    : traces;

  return {
    cwd,
    dashboardConfig,
    metricTiers,
    metricTierProfiles: METRIC_TIER_PROFILES,
    metricTierAnalysis,
    sweepQueues,
    researchArtifacts,
    performanceTools,
    projectEnvironment,
    generatedAt: new Date().toISOString(),
    goal,
    plan,
    repoProfile,
    runs: payloadRuns,
    primaryMetric,
    preferHigher,
    summary,
    traces: payloadTraces,
    lineage,
    comparison,
    payloadInfo: {
      dense: densePayload,
      totalRuns: runs.length,
      returnedRuns: payloadRuns.length,
      totalTraces: traces.length,
      returnedTraces: payloadTraces.length,
    },
    system,
    thread,
    logTail,
    activeRun,
  };
}

function sendDashboardJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function readDashboardJson(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > limitBytes) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function dashboardActionId(prefix = "action") {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function dashboardActionLog(cwd, actionId) {
  const dir = path.join(cwd, ".researchloop", "scratchpad", "dashboard-actions");
  ensureDir(dir);
  return path.join(dir, `${actionId}.log`);
}

function dashboardActionArtifactsDir(cwd, actionId) {
  const dir = path.join(cwd, ".researchloop", "scratchpad", "dashboard-actions", actionId);
  ensureDir(dir);
  return dir;
}

function spawnDashboardCliAction(cwd, command, args, prefix = command) {
  const actionId = dashboardActionId(prefix);
  const logFile = dashboardActionLog(cwd, actionId);
  const out = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [__filename, command, "--dir", cwd, ...args], {
    cwd,
    detached: true,
    env: process.env,
    stdio: ["ignore", out, out],
  });
  child.unref();
  return {
    actionId,
    pid: child.pid,
    log: path.relative(cwd, logFile),
  };
}

function spawnDashboardShellAction(cwd, commandText, prefix = "shell", opts = {}) {
  const command = String(commandText || "").trim();
  if (!command) {
    throw new Error("command is required");
  }
  const actionId = opts.actionId || dashboardActionId(prefix);
  const logFile = dashboardActionLog(cwd, actionId);
  const out = fs.openSync(logFile, "a");
  fs.writeSync(out, [
    `# AutoResearch dashboard action: ${actionId}`,
    `# cwd: ${cwd}`,
    `# command: ${command}`,
    `# started_at: ${new Date().toISOString()}`,
    "",
  ].join("\n"));
  const child = spawn(command, {
    cwd,
    shell: true,
    detached: true,
    env: { ...process.env, ...(opts.env || {}) },
    stdio: ["ignore", out, out],
  });
  child.unref();
  return {
    actionId,
    pid: child.pid,
    log: path.relative(cwd, logFile),
    command,
    artifacts: opts.artifacts || null,
  };
}

function mergeDashboardPerfConfig(cwd, body) {
  const merged = {
    ...readDashboardConfig(cwd),
    ...normalizeDashboardConfig(body),
  };
  if (hasOwn(body, "direction")) {
    merged.direction = String(body.direction || "").trim();
  }
  return merged;
}

function appendGoogleBenchmarkFlags(commandText, config) {
  let command = String(commandText || "").trim();
  if (!command || String(config.benchmarkMode || "") !== "google-benchmark") return command;
  const repeat = Number(config.benchmarkRepeat);
  const minTime = String(config.benchmarkMinTime || "").trim();
  if (Number.isFinite(repeat) && repeat > 0 && !command.includes("--benchmark_repetitions")) {
    command += ` --benchmark_repetitions=${Math.floor(repeat)}`;
  }
  if (minTime && !command.includes("--benchmark_min_time")) {
    command += ` --benchmark_min_time=${shellQuote(minTime)}`;
  }
  if (!command.includes("--benchmark_format")) {
    command += " --benchmark_format=json";
  }
  return command;
}

function buildDashboardBenchmarkCommand(config) {
  const explicit = String(config.benchmarkCommand || "").trim();
  const fallback = buildDashboardCommand(config, "experiment");
  return appendGoogleBenchmarkFlags(explicit || fallback, config);
}

function buildDashboardSweepSpec(config) {
  const template = String(config.sweepTemplate || config.benchmarkCommand || "").trim();
  if (!template) {
    throw new Error("请先填写参数扫描命令模板，例如 ./bench --tile {tile}");
  }
  const rawGrid = String(config.sweepGrid || "").trim();
  if (!rawGrid) {
    throw new Error("请填写参数网格 JSON，例如 {\"tile\":[16,32],\"dtype\":[\"fp16\",\"bf16\"]}");
  }
  let parsed;
  try {
    parsed = JSON.parse(rawGrid);
  } catch (err) {
    throw new Error(`参数网格 JSON 无法解析：${err.message}`);
  }
  const spec = parsed && typeof parsed === "object" && (Array.isArray(parsed.variants) || parsed.grid)
    ? parsed
    : { grid: parsed };
  return {
    name: String(config.sweepName || "dashboard-perf-sweep").replace(/[^A-Za-z0-9._-]/g, "-"),
    command_template: template,
    metric: String(config.metric || "latency_ms").trim() || "latency_ms",
    direction: String(config.direction || "lower").trim() || "lower",
    timeout: Number(config.timeout) || 600,
    ...spec,
  };
}

function buildProfilerCommand(cwd, config, actionId) {
  const toolRequested = String(config.profileTool || "auto").trim() || "auto";
  const command = String(config.profileCommand || config.benchmarkCommand || buildDashboardCommand(config, "experiment")).trim();
  if (!command) {
    throw new Error("请先填写 profiler 目标命令，或填写 benchmark 命令");
  }
  const artifactsDir = dashboardActionArtifactsDir(cwd, actionId);
  const scriptPath = path.join(artifactsDir, "target-command.sh");
  fs.writeFileSync(scriptPath, [
    "#!/usr/bin/env sh",
    "set -eu",
    `cd ${shellQuote(cwd)}`,
    `exec sh -lc ${shellQuote(command)}`,
    "",
  ].join("\n"));
  fs.chmodSync(scriptPath, 0o755);

  const chooseTool = () => {
    if (toolRequested !== "auto") return toolRequested;
    for (const candidate of ["nsys", "ncu", "perf", "time"]) {
      if (candidate === "perf" && process.platform !== "linux") continue;
      if (commandPath(candidate)) return candidate;
    }
    return "time";
  };
  const tool = chooseTool();
  const toolPath = commandPath(tool);
  if (!toolPath && tool !== "time") {
    throw new Error(`未检测到 profiler 工具：${tool}`);
  }
  const profileArgs = String(config.profileArgs || "").trim();
  const reportBase = path.join(artifactsDir, "profile");
  if (tool === "nsys") {
    return {
      tool,
      command: `${shellQuote(toolPath)} profile --stats=true --force-overwrite=true -o ${shellQuote(reportBase)} ${profileArgs} ${shellQuote(scriptPath)}`.trim(),
      artifactsDir,
    };
  }
  if (tool === "ncu") {
    return {
      tool,
      command: `${shellQuote(toolPath)} --set full --target-processes all --force-overwrite -o ${shellQuote(reportBase)} ${profileArgs} ${shellQuote(scriptPath)}`.trim(),
      artifactsDir,
    };
  }
  if (tool === "perf") {
    return {
      tool,
      command: `${shellQuote(toolPath)} stat -d -o ${shellQuote(path.join(artifactsDir, "perf-stat.txt"))} --append ${profileArgs} ${shellQuote(scriptPath)}`.trim(),
      artifactsDir,
    };
  }
  const timePath = fs.existsSync("/usr/bin/time") ? "/usr/bin/time" : (toolPath || "time");
  const timeFlag = process.platform === "darwin" ? "-lp" : "-v";
  return {
    tool: "time",
    command: `${shellQuote(timePath)} ${timeFlag} ${profileArgs} ${shellQuote(scriptPath)}`.trim(),
    artifactsDir,
  };
}

function latestDashboardActionLog(cwd, prefixes) {
  const dir = path.join(cwd, ".researchloop", "scratchpad", "dashboard-actions");
  if (!fs.existsSync(dir)) return null;
  const wanted = new Set(prefixes);
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".log") && [...wanted].some((prefix) => name.startsWith(`${prefix}-`)))
    .map((name) => {
      const full = path.join(dir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { name, full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = files[0];
  if (!latest) return null;
  const text = readTextIfExists(latest.full);
  return { path: latest.full, relative: path.relative(cwd, latest.full), text };
}

function compilerHintsFromText(text) {
  const hints = [];
  const add = (title, detail) => hints.push({ title, detail });
  const ptxas = text.match(/ptxas info\s*:\s*Used\s+([0-9]+)\s+registers/i);
  if (ptxas) add("CUDA 寄存器", `ptxas 显示每线程使用 ${ptxas[1]} 个 registers，后续可结合 occupancy 判断是否需要降寄存器压力。`);
  if (/spill stores|spill loads|local memory/i.test(text)) {
    add("寄存器溢出", "日志出现 spill/local memory，优先检查展开、临时变量、模板参数和 launch bounds。");
  }
  if (/not vectorized|missed.*vector|couldn't vectorize/i.test(text)) {
    add("向量化失败", "编译器报告未向量化，检查循环依赖、对齐、restrict、步长和分支。");
  }
  if (/bank conflict/i.test(text)) {
    add("Shared Memory Bank Conflict", "日志出现 bank conflict，检查 shared memory layout、padding 和访问模式。");
  }
  if (/occupancy/i.test(text)) {
    add("Occupancy", "日志包含 occupancy 信息，建议结合 block size、registers、shared memory 三者一起看。");
  }
  return hints;
}

function writeDashboardPerformanceReport(cwd, config) {
  const metric = String(config.metric || "latency_ms").trim() || "latency_ms";
  const direction = String(config.direction || "lower").toLowerCase();
  const preferHigher = direction === "higher" || direction === "max" || direction === "maximize";
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const runs = parseRunsLedger(ledgerPath);
  const metricRows = runs
    .filter((run) => isNumericMetric(run.metrics?.[metric]))
    .map((run) => ({ id: run.id, value: Number(run.metrics[metric]), status: run.status, command: run.command || "" }))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  const best = metricRows[0] || null;
  const worst = metricRows[metricRows.length - 1] || null;
  const latestProfile = latestDashboardActionLog(cwd, ["perf-profile", "perf-compile", "perf-build"]);
  const hints = compilerHintsFromText(latestProfile?.text || "");
  const tools = readPerformanceToolStatus();
  const outFile = path.join(cwd, ".researchloop", "scratchpad", "performance-analysis.md");
  ensureDir(path.dirname(outFile));
  const lines = [
    "# Performance Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Project: ${cwd}`,
    `Primary metric: ${metric} (${preferHigher ? "higher is better" : "lower is better"})`,
    "",
    "## Tool Status",
    "",
    ...Object.entries(tools).map(([name, info]) => `- ${name}: ${info.present ? "available" : info.present === null ? "configure in project" : "missing"}${info.path ? ` (${info.path})` : ""}`),
    "",
    "## Run Comparison",
    "",
  ];
  if (best) {
    lines.push(`- Best: ${best.id} ${metric}=${best.value}`);
  } else {
    lines.push("- Best: no numeric benchmark runs recorded yet.");
  }
  if (worst && best && worst.id !== best.id) {
    const delta = preferHigher ? best.value - worst.value : worst.value - best.value;
    lines.push(`- Spread vs worst: ${delta}`);
  }
  const optimizerRows = optimizerSchedulerRowsFromConfig(config);
  if (optimizerRows.length) {
    lines.push("", "## Optimizer / Scheduler Config", "");
    lines.push(markdownTable(["Field", "Value"], optimizerRows));
  }
  lines.push("", "## Benchmark Quality Checklist", "");
  lines.push("- Use warmup before timing so cache, JIT, and GPU clocks settle.");
  lines.push("- Repeat runs and compare median/p50 plus tail latency when applicable.");
  lines.push("- Keep input shapes, dtype, thread count, GPU clocks, and batch size fixed across baseline and experiment.");
  lines.push("- Separate compile time from runtime unless compile time is the target metric.");
  lines.push("", "## Profiler / Compiler Hints", "");
  if (hints.length) {
    for (const hint of hints) lines.push(`- ${hint.title}: ${hint.detail}`);
  } else {
    lines.push("- No specific compiler/profiler warning pattern found yet. Run Nsight, perf, or compiler analysis from the dashboard first.");
  }
  if (latestProfile) {
    lines.push("", `Latest action log: ${latestProfile.relative}`);
  }
  fs.writeFileSync(outFile, `${lines.join("\n")}\n`);
  return { out: path.relative(cwd, outFile), best, hints };
}

function writeEnvironmentDetection(cwd, detection) {
  const outFile = path.join(cwd, ".researchloop", "scratchpad", "environment-detection.json");
  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, `${JSON.stringify(detection, null, 2)}\n`);
  return path.relative(cwd, outFile);
}

function allowLocalPerf(body, config) {
  return body.allowUnsafe === true
    || String(body.allowLocalPerf || config.allowLocalPerf || "").toLowerCase() === "true";
}

function shellRunCommand(commandText) {
  const command = String(commandText || "").trim();
  if (!command) return "";
  if (/^(python|python3|node|npm|npx|bash|sh|cmake|make|ninja|pytest|printf|echo)\b/.test(command)) {
    return command;
  }
  return `bash -lc ${shellQuote(command)}`;
}

function buildAutoDiagnoseCommand(cwd, config, body) {
  const actionId = dashboardActionId("perf-auto");
  const logDir = dashboardActionArtifactsDir(cwd, actionId);
  const benchmarkCommand = buildDashboardBenchmarkCommand(config);
  if (!benchmarkCommand) {
    throw new Error("自动检测没有找到 benchmark 命令，请先手动填写 Benchmark 命令。");
  }
  const metric = String(config.metric || "latency_ms").trim() || "latency_ms";
  const timeout = String(config.timeout || "600").trim() || "600";
  const runId = `${actionId}-bench`;
  const buildCommand = String(config.buildCommand || "").trim();
  const compilerCommand = String(config.compilerCommand || "").trim();
  const allowFlag = allowLocalPerf(body, config) ? " --allow-unsafe" : "";
  const runCommand = [
    shellQuote(process.execPath),
    shellQuote(__filename),
    "run",
    "--dir", shellQuote(cwd),
    "--id", shellQuote(runId),
    "--metric", shellQuote(metric),
    "--command", shellQuote(shellRunCommand(benchmarkCommand)),
    "--timeout", shellQuote(timeout),
    "--device", shellQuote(String(config.device || "auto")),
    "--tags", shellQuote("performance,autodetect,benchmark"),
    allowFlag.trim(),
  ].filter(Boolean).join(" ");
  let profiler = null;
  try {
    profiler = buildProfilerCommand(cwd, { ...config, profileCommand: String(config.profileCommand || benchmarkCommand) }, `${actionId}-profile`);
  } catch {
    profiler = null;
  }
  const lines = [
    "set -eu",
    `cd ${shellQuote(cwd)}`,
    "echo '[AutoResearch] 自动性能诊断开始'",
  ];
  if (buildCommand) {
    lines.push("echo '[AutoResearch] 构建项目'", shellRunCommand(buildCommand));
  }
  lines.push("echo '[AutoResearch] 运行 benchmark 并记录指标'", runCommand);
  if (profiler?.command) {
    lines.push("echo '[AutoResearch] 运行 profiler'", `(${profiler.command}) || true`);
  }
  if (compilerCommand) {
    lines.push("echo '[AutoResearch] 运行编译器分析'", `(${shellRunCommand(compilerCommand)}) || true`);
  }
  lines.push("echo '[AutoResearch] 自动性能诊断结束'");
  const scriptFile = path.join(logDir, "auto-diagnose.sh");
  fs.writeFileSync(scriptFile, `#!/usr/bin/env bash\n${lines.join("\n")}\n`);
  fs.chmodSync(scriptFile, 0o755);
  return { actionId, scriptFile, command: shellQuote(scriptFile), logDir };
}

function openLocalIde(cwd, ide) {
  const normalized = String(ide || "clion").trim().toLowerCase();
  const apps = detectLocalDeveloperApps();
  const app = apps[normalized];
  if (!app?.present) {
    throw new Error(`${normalized} 未检测到，请先安装或把命令加入 PATH。`);
  }
  if (process.platform === "darwin" && normalized === "clion") {
    const child = spawn("open", ["-a", "CLion", cwd], { detached: true, stdio: "ignore" });
    child.unref();
    return { ide: "clion", path: app.path };
  }
  if (normalized === "vscode") {
    const command = commandPath("code");
    if (command) {
      const child = spawn(command, [cwd], { detached: true, stdio: "ignore" });
      child.unref();
      return { ide: "vscode", path: command };
    }
    if (process.platform === "darwin") {
      const child = spawn("open", ["-a", "Visual Studio Code", cwd], { detached: true, stdio: "ignore" });
      child.unref();
      return { ide: "vscode", path: app.path };
    }
  }
  if (app.path && app.kind === "cli") {
    const child = spawn(app.path, [cwd], { detached: true, stdio: "ignore" });
    child.unref();
    return { ide: normalized, path: app.path };
  }
  throw new Error(`${normalized} 已检测到，但当前系统暂不支持从面板打开。`);
}

function writeResearchGoal(cwd, fields) {
  const researchDir = path.join(cwd, ".researchloop");
  ensureDir(researchDir);
  const goalFile = path.join(researchDir, "goal.md");
  const goalText = String(fields.goal || "").trim();
  if (!goalText) {
    throw new Error("research goal is required");
  }
  const metric = String(fields.metric || "validation loss").trim() || "validation loss";
  const direction = String(fields.direction || "lower").trim() || "lower";
  const baseline = String(fields.baseline || "unknown").trim() || "unknown";
  const evaluation = String(fields.evaluation || "unknown").trim() || "unknown";
  const allowed = String(fields.allowed || "optimizer, schedules, initialization, hyperparameters").trim();
  const forbidden = String(fields.forbidden || "data, architecture, batch size, benchmark definition").trim();

  const content = [
    "# Research Goal",
    "",
    "## Goal",
    goalText,
    "",
    "## Target Metric",
    metric,
    "",
    "## Direction",
    direction,
    "",
    "## Baseline Command",
    baseline,
    "",
    "## Evaluation Command",
    evaluation,
    "",
    "## Allowed Changes",
    allowed,
    "",
    "## Forbidden Changes",
    forbidden,
    "",
    "## Current Best",
    "Unknown.",
    "",
    "## Notes",
    "Use `autoresearch inspect` to generate a repo profile, then ask an agent to fill in the missing benchmark details.",
    "",
  ].join("\n");

  fs.writeFileSync(goalFile, content);
  return { goalText, metric, direction, file: path.relative(cwd, goalFile) };
}

function parseDashboardMetricText(text) {
  const metrics = {};
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const [key, value] = parseMetric(line);
    if (key) metrics[key] = value;
  }
  return metrics;
}

function appendDashboardRecord(cwd, body) {
  const metrics = {
    ...(body.metrics && typeof body.metrics === "object" && !Array.isArray(body.metrics) ? body.metrics : {}),
    ...parseDashboardMetricText(body.metricText || ""),
  };
  if (!Object.keys(metrics).length) {
    throw new Error("at least one metric is required, for example val_loss=0.42");
  }
  const id = String(body.id || dashboardActionId("manual")).trim();
  const row = {
    id,
    timestamp: new Date().toISOString(),
    status: String(body.status || "complete"),
    agent: "dashboard",
    command: body.command ? String(body.command) : null,
    metrics,
    notes: String(body.note || ""),
  };
  const tags = String(body.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  if (tags.length) row.tags = tags;
  appendRunRow(cwd, row);
  const thread = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  ensureDir(path.dirname(thread));
  const metricSuffix = Object.entries(metrics).map(([k, v]) => `${k}=${v}`).join(" ");
  fs.appendFileSync(thread, `- ${row.timestamp} dashboard record ${id} status=${row.status} ${metricSuffix}\n`);
  return row;
}

function dashboardRunArgs(cwd, body, isBaseline) {
  const goalFields = readGoalFields(cwd);
  const savedConfig = readDashboardConfig(cwd);
  const mergedConfig = {
    ...savedConfig,
    ...normalizeDashboardConfig(body),
  };
  if (mergedConfig.runner === "cuda" && (!mergedConfig.device || mergedConfig.device === "auto")) {
    mergedConfig.device = "cuda";
  }
  if (hasOwn(body, "command")) {
    mergedConfig.command = String(body.command || "").trim();
  }
  if (!isBaseline && hasOwn(body, "runArgs")) {
    mergedConfig.experimentArgs = String(body.runArgs || "").trim();
  }
  const id = String(body.id || dashboardActionId(isBaseline ? "baseline" : "run")).trim();
  const commandText = buildDashboardCommand(mergedConfig, isBaseline ? "baseline" : "experiment");
  const metric = String(mergedConfig.metric || goalFields.metric || "val_loss").trim() || "val_loss";
  const regex = hasOwn(body, "regex") ? String(body.regex || "").trim() : String(mergedConfig.regex || "").trim();
  const timeout = hasOwn(body, "timeout") ? String(body.timeout || "").trim() : String(mergedConfig.timeout || "").trim();
  const args = ["--id", id, "--metric", metric];
  if (commandText) args.push("--command", commandText);
  if (regex) args.push("--regex", regex);
  if (timeout) args.push("--timeout", timeout);
  if (mergedConfig.device) args.push("--device", String(mergedConfig.device));
  if (mergedConfig.cudaVisibleDevices) {
    args.push("--cuda-visible-devices", String(mergedConfig.cudaVisibleDevices));
  }
  if (body.tags) args.push("--tags", String(body.tags));
  if (body.notes) args.push("--note", String(body.notes));
  if (body.seeds && !isBaseline) args.push("--seeds", String(body.seeds));
  if (body.allowUnsafe) args.push("--allow-unsafe");
  return { id, args };
}

async function handleDashboardAction(req, res, getCwd, setCwd, hostIsLoopback, getSystemSnapshot = null) {
  if (req.method !== "POST") {
    sendDashboardJson(res, 405, { ok: false, error: "method not allowed" });
    return;
  }
  if (!hostIsLoopback) {
    sendDashboardJson(res, 403, {
      ok: false,
      error: "dashboard actions are only available on loopback hosts",
    });
    return;
  }

  let body;
  try {
    body = await readDashboardJson(req);
  } catch (err) {
    sendDashboardJson(res, 400, { ok: false, error: err.message });
    return;
  }

  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const action = url.pathname.replace(/^\/api\/action\/?/, "");
    const cwd = getCwd();
    const stateFor = (dir) => buildDashboardState(dir, getSystemSnapshot ? getSystemSnapshot() : null);
    if (action === "switch-project") {
      const requestedPath = expandUserPath(body.path || "");
      if (!requestedPath) {
        throw new Error("project folder is required");
      }
      const nextDir = path.resolve(requestedPath);
      if (!fs.existsSync(nextDir) || !fs.statSync(nextDir).isDirectory()) {
        throw new Error("project folder does not exist");
      }
      setCwd(nextDir);
      sendDashboardJson(res, 200, { ok: true, action, cwd: nextDir, state: stateFor(nextDir) });
      return;
    }
    if (action === "open-folder") {
      const requestedPath = expandUserPath(body.path || "");
      const folder = requestedPath ? path.resolve(requestedPath) : cwd;
      if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
        throw new Error("project folder does not exist");
      }
      const opener = process.platform === "darwin" ? "open" : (process.platform === "win32" ? "explorer.exe" : "xdg-open");
      const child = spawn(opener, [folder], { detached: true, stdio: "ignore" });
      child.unref();
      sendDashboardJson(res, 202, { ok: true, action, cwd: folder });
      return;
    }
    if (action === "config") {
      const config = writeDashboardConfig(cwd, normalizeDashboardConfig(body, true));
      sendDashboardJson(res, 200, { ok: true, action, config, state: stateFor(cwd) });
      return;
    }
    if (action === "metric-tiers") {
      const metricTiers = writeMetricTierConfig(cwd, metricTierConfigFromDashboardBody(body));
      const config = writeDashboardConfig(cwd, { metricProfile: metricTiers.profile });
      sendDashboardJson(res, 200, { ok: true, action, metricTiers, config, state: stateFor(cwd) });
      return;
    }
    if (action === "goal") {
      const incomingConfig = normalizeDashboardConfig(body);
      const config = Object.keys(incomingConfig).length
        ? writeDashboardConfig(cwd, incomingConfig)
        : readDashboardConfig(cwd);
      const fields = { ...body };
      if (!String(fields.baseline || "").trim()) {
        fields.baseline = buildDashboardCommand(config, "baseline") || "unknown";
      }
      if (!String(fields.evaluation || "").trim()) {
        fields.evaluation = buildDashboardCommand(config, "experiment") || "unknown";
      }
      const result = writeResearchGoal(cwd, fields);
      sendDashboardJson(res, 200, { ok: true, action, ...result, state: stateFor(cwd) });
      return;
    }
    if (action === "record") {
      const row = appendDashboardRecord(cwd, body);
      sendDashboardJson(res, 200, { ok: true, action, row, state: stateFor(cwd) });
      return;
    }
    if (action === "clear-runs") {
      const cleared = archiveAndClearDashboardRuns(cwd);
      sendDashboardJson(res, 200, { ok: true, action, ...cleared, state: stateFor(cwd) });
      return;
    }
    if (action === "inspect") {
      const spawned = spawnDashboardCliAction(cwd, "inspect", [], "inspect");
      sendDashboardJson(res, 202, { ok: true, action, ...spawned });
      return;
    }
    if (action === "report") {
      const incomingConfig = normalizeDashboardConfig(body);
      if (Object.keys(incomingConfig).length) writeDashboardConfig(cwd, incomingConfig);
      const outFile = String(body.out || ".researchloop/scratchpad/dashboard-report.md");
      const args = ["--format", "markdown", "--out", outFile];
      if (body.includePlots !== false) args.push("--include-plots");
      const spawned = spawnDashboardCliAction(cwd, "report", args, "report");
      sendDashboardJson(res, 202, { ok: true, action, out: outFile, ...spawned });
      return;
    }
    if (action === "portfolio") {
      const incomingConfig = normalizeDashboardConfig(body);
      if (Object.keys(incomingConfig).length) writeDashboardConfig(cwd, incomingConfig);
      const outFile = String(body.out || ".researchloop/scratchpad/portfolio-report.md");
      const written = writePortfolioReport(cwd, {
        out: outFile,
        python: String(body.python || "python3"),
        writeEnv: body.writeEnv !== false,
      });
      sendDashboardJson(res, 200, { ok: true, action, ...written, state: stateFor(cwd) });
      return;
    }
    if (action === "perf-autoconfig") {
      const detection = detectProjectEnvironment(cwd, getSystemSnapshot ? getSystemSnapshot() : null, true);
      const detectionFile = writeEnvironmentDetection(cwd, detection);
      const config = writeDashboardConfig(cwd, detection.recommendations || {});
      sendDashboardJson(res, 200, {
        ok: true,
        action,
        config,
        detection,
        detectionFile,
        state: stateFor(cwd),
      });
      return;
    }
    if (action === "batch-autoconfig") {
      const detection = detectProjectEnvironment(cwd, getSystemSnapshot ? getSystemSnapshot() : null, true);
      const detectionFile = writeEnvironmentDetection(cwd, detection);
      const rec = detection.recommendations || {};
      const config = writeDashboardConfig(cwd, {
        metric: rec.metric || body.metric || "latency_ms",
        direction: rec.direction || body.direction || "lower",
        benchmarkMode: rec.benchmarkMode || "generic",
        benchmarkCommand: rec.benchmarkCommand || "",
        profileTool: rec.profileTool || "time",
        profileArgs: rec.profileArgs || "",
        profileCommand: rec.profileCommand || rec.benchmarkCommand || "",
        sweepName: rec.sweepName || "auto-perf-sweep",
        sweepTemplate: rec.sweepTemplate || rec.batchCommandTemplate || "",
        sweepGrid: rec.sweepGrid || "",
        batchSweepSpec: rec.batchSweepSpec || "",
        batchCommandTemplate: rec.batchCommandTemplate || rec.sweepTemplate || "",
        batchParamGrid: rec.batchParamGrid || "",
        batchMaxRuns: rec.batchMaxRuns || "",
        batchMaxParallel: rec.batchMaxParallel || "1",
        batchMaxParallelSource: rec.batchMaxParallelSource || "hardware_auto",
        batchMaxParallelReason: rec.batchMaxParallelReason || "",
        batchDevicePool: rec.batchDevicePool || body.cudaVisibleDevices || "",
        batchMaxRetries: rec.batchMaxRetries || "",
        batchStabilityEnabled: rec.batchStabilityEnabled || "true",
        batchStabilityTopK: rec.batchStabilityTopK || "5",
        batchStabilityRepeats: rec.batchStabilityRepeats || "3",
        allowLocalPerf: rec.allowLocalPerf || "true",
      });
      sendDashboardJson(res, 200, {
        ok: true,
        action,
        config,
        detection,
        detectionFile,
        state: stateFor(cwd),
      });
      return;
    }
    if (action === "open-ide") {
      const ide = String(body.ide || "clion");
      const opened = openLocalIde(cwd, ide);
      sendDashboardJson(res, 202, { ok: true, action, ...opened });
      return;
    }
    if (action === "perf-autodiagnose") {
      const detection = detectProjectEnvironment(cwd, getSystemSnapshot ? getSystemSnapshot() : null, true);
      const detectionFile = writeEnvironmentDetection(cwd, detection);
      const config = writeDashboardConfig(cwd, {
        ...(detection.recommendations || {}),
        ...normalizeDashboardConfig(body),
      });
      const auto = buildAutoDiagnoseCommand(cwd, config, body);
      const spawned = spawnDashboardShellAction(cwd, auto.command, "perf-auto", {
        actionId: auto.actionId,
        artifacts: { dir: path.relative(cwd, auto.logDir), detectionFile },
      });
      sendDashboardJson(res, 202, {
        ok: true,
        action,
        detectionFile,
        config,
        ...spawned,
      });
      return;
    }
    if (action === "perf-build") {
      const config = mergeDashboardPerfConfig(cwd, body);
      const commandText = String(config.buildCommand || "").trim();
      if (!commandText) throw new Error("请先填写构建命令，例如 cmake --build build -j");
      const spawned = spawnDashboardShellAction(cwd, commandText, "perf-build");
      sendDashboardJson(res, 202, { ok: true, action, ...spawned });
      return;
    }
    if (action === "perf-benchmark") {
      const config = mergeDashboardPerfConfig(cwd, body);
      const id = String(body.id || dashboardActionId("bench")).trim();
      const commandText = buildDashboardBenchmarkCommand(config);
      if (!commandText) throw new Error("请先填写 benchmark 命令，或填写入口文件和参数");
      const metric = String(config.metric || "latency_ms").trim() || "latency_ms";
      const args = ["--id", id, "--metric", metric, "--command", commandText];
      const regex = String(config.regex || "").trim();
      const timeout = String(config.timeout || "").trim();
      if (regex) args.push("--regex", regex);
      if (timeout) args.push("--timeout", timeout);
      if (config.device) args.push("--device", String(config.device));
      if (config.cudaVisibleDevices) args.push("--cuda-visible-devices", String(config.cudaVisibleDevices));
      args.push("--tags", ["performance", "benchmark", String(config.benchmarkMode || "generic")].filter(Boolean).join(","));
      if (config.notes) args.push("--note", String(config.notes));
      if (allowLocalPerf(body, config)) args.push("--allow-unsafe");
      const spawned = spawnDashboardCliAction(cwd, "run", args, "perf-benchmark");
      sendDashboardJson(res, 202, { ok: true, action, runId: id, command: commandText, ...spawned });
      return;
    }
    if (action === "perf-profile") {
      const config = mergeDashboardPerfConfig(cwd, body);
      const actionId = dashboardActionId("perf-profile");
      const profile = buildProfilerCommand(cwd, config, actionId);
      const spawned = spawnDashboardShellAction(cwd, profile.command, "perf-profile", {
        actionId,
        artifacts: {
          tool: profile.tool,
          dir: path.relative(cwd, profile.artifactsDir),
        },
      });
      sendDashboardJson(res, 202, { ok: true, action, profiler: profile.tool, ...spawned });
      return;
    }
    if (action === "perf-compile") {
      const config = mergeDashboardPerfConfig(cwd, body);
      let commandText = String(config.compilerCommand || "").trim();
      if (!commandText) throw new Error("请先填写编译器分析命令，例如 nvcc -Xptxas -v kernel.cu -o bench");
      const flags = String(config.compilerFlags || "").trim();
      if (flags) commandText = `${commandText} ${flags}`;
      const spawned = spawnDashboardShellAction(cwd, commandText, "perf-compile");
      sendDashboardJson(res, 202, { ok: true, action, ...spawned });
      return;
    }
    if (action === "perf-sweep") {
      const config = mergeDashboardPerfConfig(cwd, body);
      const spec = buildDashboardSweepSpec(config);
      const specDir = path.join(cwd, ".researchloop", "scratchpad", "dashboard-sweeps");
      ensureDir(specDir);
      const specFile = path.join(specDir, `${spec.name}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      fs.writeFileSync(specFile, `${JSON.stringify(spec, null, 2)}\n`);
      const args = ["--spec", specFile, "--metric", spec.metric, "--direction", spec.direction];
      if (spec.timeout) args.push("--timeout", String(spec.timeout));
      if (allowLocalPerf(body, config)) args.push("--allow-unsafe");
      const spawned = spawnDashboardCliAction(cwd, "sweep", args, "perf-sweep");
      sendDashboardJson(res, 202, { ok: true, action, spec: path.relative(cwd, specFile), ...spawned });
      return;
    }
    if (action === "sweep-validate" || action === "sweep-preview") {
      const spec = buildSweepSpecFromDashboardBody(body, cwd);
      const validation = validateSweepSpec(spec, cwd, {
        allowUnsafe: body.allowUnsafe === true || String(body.allowLocalPerf || "").toLowerCase() === "true",
        maxRuns: body.maxRuns || body.batchMaxRuns || null,
      });
      sendDashboardJson(res, validation.ok ? 200 : 400, {
        ok: validation.ok,
        action,
        validation,
        preview: validation.variants.slice(0, 100),
        state: stateFor(cwd),
        error: validation.ok ? undefined : validation.errors.join("; "),
      });
      return;
    }
    if (action === "sweep-create") {
      const spec = buildSweepSpecFromDashboardBody(body, cwd);
      const configPatch = normalizeDashboardConfig({
        batchSweepSpec: body.specText || body.batchSweepSpec || "",
        batchCommandTemplate: body.commandTemplate || body.batchCommandTemplate || "",
        batchMaxRuns: body.maxRuns || body.batchMaxRuns || "",
        batchMaxParallel: body.maxParallel || body.batchMaxParallel || "",
        batchDevicePool: body.devicePool || body.batchDevicePool || body.cudaVisibleDevices || "",
        batchMaxRetries: body.maxRetries || body.batchMaxRetries || "",
        batchStabilityEnabled: body.stabilityEnabled || body.batchStabilityEnabled || "",
        batchStabilityTopK: body.stabilityTopK || body.batchStabilityTopK || "",
        batchStabilityRepeats: body.stabilityRepeats || body.batchStabilityRepeats || "",
      });
      if (Object.keys(configPatch).length) writeDashboardConfig(cwd, configPatch);
      const created = createSweepQueue(cwd, spec, {
        allowUnsafe: body.allowUnsafe === true || String(body.allowLocalPerf || "").toLowerCase() === "true",
        queueId: body.queueId || body.batchQueueId || "",
        maxRuns: body.maxRuns || body.batchMaxRuns || null,
        maxParallel: body.maxParallel || body.batchMaxParallel || null,
        cudaVisibleDevices: body.devicePool || body.batchDevicePool || body.cudaVisibleDevices || "",
      });
      writeDashboardConfig(cwd, {
        batchQueueId: created.queueId,
        batchMaxParallel: String(created.state.max_parallel || ""),
      });
      sendDashboardJson(res, 200, {
        ok: true,
        action,
        queueId: created.queueId,
        queue: created.state,
        state: stateFor(cwd),
      });
      return;
    }
    if (action === "sweep-start") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const argsList = ["start", "--id", queueId];
      const maxParallel = String(body.maxParallel || body.batchMaxParallel || "").trim();
      const devicePool = String(body.devicePool || body.batchDevicePool || body.cudaVisibleDevices || "").trim();
      if (maxParallel) argsList.push("--max-parallel", maxParallel);
      if (devicePool) argsList.push("--cuda-visible-devices", devicePool);
      if (body.allowUnsafe === true || String(body.allowLocalPerf || "").toLowerCase() === "true") argsList.push("--allow-unsafe");
      const spawned = spawnDashboardCliAction(cwd, "queue", argsList, "sweep-start");
      sendDashboardJson(res, 202, { ok: true, action, queueId, ...spawned, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-pause") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const queue = setQueueStatus(cwd, queueId, "pausing", "queue_pause_requested");
      sendDashboardJson(res, 200, { ok: true, action, queueId, queue, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-resume") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      setQueueStatus(cwd, queueId, "pending", "queue_resume_requested");
      const argsList = ["start", "--id", queueId];
      const maxParallel = String(body.maxParallel || body.batchMaxParallel || "").trim();
      const devicePool = String(body.devicePool || body.batchDevicePool || body.cudaVisibleDevices || "").trim();
      if (maxParallel) argsList.push("--max-parallel", maxParallel);
      if (devicePool) argsList.push("--cuda-visible-devices", devicePool);
      if (body.allowUnsafe === true || String(body.allowLocalPerf || "").toLowerCase() === "true") argsList.push("--allow-unsafe");
      const spawned = spawnDashboardCliAction(cwd, "queue", argsList, "sweep-resume");
      sendDashboardJson(res, 202, { ok: true, action, queueId, ...spawned, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-cancel") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const queue = setQueueStatus(cwd, queueId, "cancelled", "queue_cancel_requested");
      sendDashboardJson(res, 200, { ok: true, action, queueId, queue, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-retry-failed") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const retry = resetFailedTrialsForRetry(cwd, queueId);
      sendDashboardJson(res, 200, { ok: true, action, queueId, changed: retry.changed, queue: retry.state, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-status") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const queue = readQueueState(cwd, queueId);
      sendDashboardJson(res, 200, { ok: true, action, queueId, queue, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-report") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const written = writeSweepReport(cwd, queueId);
      sendDashboardJson(res, 200, { ok: true, action, queueId, ...written, state: stateFor(cwd) });
      return;
    }
    if (action === "sweep-delete") {
      const queueId = String(body.queueId || body.batchQueueId || "").trim();
      if (!queueId) throw new Error("queue id is required");
      const archived = archiveSweepQueue(cwd, queueId);
      const config = readDashboardConfig(cwd);
      if (String(config.batchQueueId || "") === archived.queueId || String(body.clearCurrent || "").toLowerCase() === "true") {
        writeDashboardConfig(cwd, { batchQueueId: "" });
      }
      sendDashboardJson(res, 200, { ok: true, action, ...archived, state: stateFor(cwd) });
      return;
    }
    if (action === "perf-report") {
      const config = mergeDashboardPerfConfig(cwd, body);
      const report = writeDashboardPerformanceReport(cwd, config);
      sendDashboardJson(res, 200, { ok: true, action, ...report, state: stateFor(cwd) });
      return;
    }
    if (action === "baseline" || action === "run") {
      const isBaseline = action === "baseline";
      const { id, args } = dashboardRunArgs(cwd, body, isBaseline);
      const spawned = spawnDashboardCliAction(cwd, isBaseline ? "baseline" : "run", args, action);
      sendDashboardJson(res, 202, { ok: true, action, runId: id, ...spawned });
      return;
    }

    sendDashboardJson(res, 404, { ok: false, error: "unknown dashboard action" });
  } catch (err) {
    sendDashboardJson(res, 400, { ok: false, error: err.message });
  }
}

function renderAsciiSparkline(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return finite.length === 1 ? "·" : "";
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const ramp = "▁▂▃▄▅▆▇█";
  return values.map((v) => {
    if (!Number.isFinite(v)) return "?";
    const idx = Math.min(ramp.length - 1, Math.max(0, Math.round(((v - min) / span) * (ramp.length - 1))));
    return ramp[idx];
  }).join("");
}

function cmdCurves() {
  const cwd = targetDir();
  const runId = option("--id", positionalText(["--id", "--format", "--dir", "--metric"])) || null;
  const format = String(option("--format", "text")).toLowerCase();
  if (!runId) {
    console.error("autoresearch curves: missing --id <run-id>");
    process.exitCode = 1;
    return;
  }
  const payload = readCurvesForRun(cwd, runId);
  if (format === "json" || format === "jsonl") {
    if (format === "jsonl") {
      for (const point of payload.series) {
        console.log(JSON.stringify(point));
      }
      return;
    }
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.error) {
    console.error(`autoresearch curves: ${payload.error}`);
    process.exitCode = 1;
    return;
  }
  const series = payload.series;
  if (series.length === 0) {
    console.log(`run: ${payload.run_id}`);
    console.log("series: empty (no metric samples were streamed)");
    return;
  }
  const values = series.map((p) => Number(p.value));
  const finite = values.filter((v) => Number.isFinite(v));
  const metricName = series[0].metric || "metric";
  const min = finite.length ? Math.min(...finite) : null;
  const max = finite.length ? Math.max(...finite) : null;
  const last = values.length ? values[values.length - 1] : null;
  const fmt = (v) => (Number.isFinite(v) ? Number(v).toFixed(4).replace(/\.?0+$/, "") : String(v));
  console.log(`run: ${payload.run_id}`);
  console.log(`metric: ${metricName}`);
  console.log(`samples: ${series.length}`);
  if (min !== null) console.log(`min: ${fmt(min)}`);
  if (max !== null) console.log(`max: ${fmt(max)}`);
  if (last !== null) console.log(`final: ${fmt(last)}`);
  const non = values.length - finite.length;
  if (non > 0) console.log(`non_finite: ${non}`);
  const spark = renderAsciiSparkline(values);
  if (spark) console.log(`curve: ${spark}`);
}

function cmdDashboard() {
  const cwd = targetDir();
  let activeCwd = cwd;
  const host = String(option("--host", "127.0.0.1"));
  const port = Number(option("--port", 8787));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  const hostIsLoopback = loopbackHosts.has(host);
  if (!hostIsLoopback) {
    console.error("");
    console.error(`WARNING: --host ${host} is not loopback.`);
    console.error("The dashboard has no auth. Anyone who can reach this address can read");
    console.error("your run ledger, goal, and plan files. Press Ctrl+C now if that is not");
    console.error("what you want, and re-run without --host to stay on 127.0.0.1.");
    console.error("");
  }
  const dashboardFile = path.join(templatesRoot, "dashboard", "index.html");
  const html = readTextIfExists(dashboardFile);
  const dashboardAssetsRoot = path.join(packageRoot, "assets");
  const systemSampler = startDashboardSystemSampler(() => activeCwd, 1000);
  const setActiveCwd = (nextCwd) => {
    activeCwd = nextCwd;
    systemSampler.sampleNow();
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      const rel = decodeURIComponent(url.pathname.slice("/assets/".length));
      const file = path.resolve(dashboardAssetsRoot, rel);
      if (!file.startsWith(`${dashboardAssetsRoot}${path.sep}`) || !fs.existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const contentType = ext === ".png" ? "image/png"
        : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg"
          : ext === ".webp" ? "image/webp"
            : ext === ".svg" ? "image/svg+xml"
              : "application/octet-stream";
      res.writeHead(200, {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    if (url.pathname === "/lineage") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname === "/diff") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(buildDashboardState(activeCwd, systemSampler.getSnapshot()), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/lineage") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(activeCwd, systemSampler.getSnapshot());
      res.end(`${JSON.stringify(state.lineage || { roots: [] }, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/runs") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(activeCwd, systemSampler.getSnapshot());
      res.end(`${JSON.stringify(state.runs, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/diff") {
      const runIdA = String(url.searchParams.get("a") || url.searchParams.get("id_a") || "").trim();
      const runIdB = String(url.searchParams.get("b") || url.searchParams.get("id_b") || "").trim();
      if (!runIdA || !runIdB) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(`${JSON.stringify({ error: "missing diff run ids" }, null, 2)}\n`);
        return;
      }
      const rows = parseRunsLedger(path.join(activeCwd, ".researchloop", "scratchpad", "runs.jsonl"));
      const rowA = rows.find((r) => r && !r.parse_error && String(r.id) === runIdA) || null;
      const rowB = rows.find((r) => r && !r.parse_error && String(r.id) === runIdB) || null;
      if (!rowA || !rowB) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(`${JSON.stringify({ error: "run not found", id_a: runIdA, id_b: runIdB }, null, 2)}\n`);
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(buildRunDiff(rowA, rowB), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/goal") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(activeCwd, systemSampler.getSnapshot());
      res.end(`${JSON.stringify(state.goal, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/system") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(systemSampler.getSnapshot(), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/thread") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(readThreadTail(activeCwd, 50), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/log-tail") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(activeCwd, systemSampler.getSnapshot());
      res.end(`${JSON.stringify(state.logTail || null, null, 2)}\n`);
      return;
    }
    if (url.pathname.startsWith("/api/action/")) {
      handleDashboardAction(req, res, () => activeCwd, setActiveCwd, hostIsLoopback, () => systemSampler.getSnapshot());
      return;
    }
    if (url.pathname === "/api/curves") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const runId = url.searchParams.get("run") || url.searchParams.get("id");
      const payload = readCurvesForRun(activeCwd, runId);
      res.end(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    console.log(`AutoResearch-AI dashboard running at http://${host}:${actualPort}`);
    console.log(`Repo: ${cwd}`);
    console.log("No auth. Localhost only.");
  });

  server.on("close", () => systemSampler.stop());
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

function loadRepoProfile(cwd) {
  const profileFile = path.join(cwd, ".researchloop", "repo-profile.json");
  if (fs.existsSync(profileFile)) {
    try {
      return JSON.parse(fs.readFileSync(profileFile, "utf8"));
    } catch {
      return detectRepo(cwd);
    }
  }
  return detectRepo(cwd);
}

function readPaperNotes(cwd) {
  const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
  if (!fs.existsSync(papersDir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(papersDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = path.join(papersDir, entry.name);
    const raw = fs.readFileSync(file, "utf8");
    const titleMatch = raw.match(/^#\s+(.+?)\s*$/m);
    const idMatch = raw.match(/^arXiv:\s*(.+?)\s*$/m);
    out.push({
      title: titleMatch ? titleMatch[1].trim() : entry.name.replace(/\.md$/, ""),
      arxivId: idMatch ? idMatch[1].trim() : entry.name.replace(/\.md$/, ""),
      file: path.relative(cwd, file),
    });
  }
  return out;
}

function cmdIdea() {
  const cwd = targetDir();
  const researchDir = path.join(cwd, ".researchloop");
  ensureDir(researchDir);
  const goalText = option("--goal", "") || readGoalSummary(path.join(researchDir, "goal.md"));
  const profile = loadRepoProfile(cwd);
  const history = readExperimentHistory(cwd);
  const system = readSystemSummary();
  const papers = readPaperNotes(cwd);
  const timeBudget = normalizeTimeBudget(history.timeBudget || "");
  const question = timeBudget
    ? "Ask at most one short follow-up about the user's actual research priority, then propose ideas."
    : 'Ask exactly one question first: "How long do you usually want a typical experiment to run?" Save the answer in `.researchloop/plan.md` under `Time Budget`, then continue.';
  const recentRunLines = history.recentRuns.length
    ? history.recentRuns.map((run) => {
        const metricSummary = Object.entries(run.metrics || {})
          .map(([key, value]) => `${key}=${value}`)
          .join(", ");
        return `- ${run.id}${metricSummary ? `: ${metricSummary}` : ""}`;
      }).join("\n")
    : "- none yet";
  const paperLines = papers.length
    ? papers.map((paper) => `- ${paper.arxivId}: ${paper.title}`).join("\n")
    : "- none yet";
  const prompt = [
    "# Research Idea Chat",
    "",
    "You are preparing research ideas by talking with the user, not by using a fixed sweep template.",
    "If the user named a topic, treat it as a topic-intake conversation: baseline first, then modes, then ideas.",
    "",
    "First inspect the repo memory:",
    "- `.researchloop/baseline.md`",
    "- `.researchloop/scratchpad/runs.jsonl`",
    "- `.researchloop/scratchpad/THREAD.md`",
    "- `.researchloop/plan.md`",
    "- recent idea notes in `.researchloop/scratchpad/ideas/`",
    "",
    `Goal: ${goalText || "Unknown"}`,
    `Adapters: ${(profile?.adapters || ["generic"]).join(", ")}`,
    `System: ${system.cores} CPU / ${system.memoryGiB} GB RAM (${system.scale})`,
    timeBudget ? `Saved time budget: ${timeBudget}` : "Saved time budget: missing",
    "",
    "Recent runs:",
    recentRunLines,
    "",
    "Recent papers:",
    paperLines,
    "",
    "What to do:",
    `1. ${question}`,
    "2. Check whether a usable baseline already exists and where it is documented.",
    "3. If no clear baseline markdown note exists, propose creating or updating `.researchloop/baseline.md` before experiments.",
    "4. If the baseline is clear, offer modes: propose, novel, or autonomous.",
    "5. In propose mode, suggest 2-4 grounded next experiments for the user to choose from.",
    "6. In novel mode, generate genuinely different hypotheses with mechanism, failure mode, smallest test, evidence, time band, and kill criterion.",
    "7. In autonomous mode, proceed only after explicit approval, then search papers when useful, write idea notes, choose the cheapest meaningful test, run it, record it, compare it, and stop with a clear result.",
    "8. Do not default to generic learning-rate or hyperparameter sweeps unless the history justifies them.",
    "9. If the repo has no useful history, say so and ask for the next real target repo or research dir.",
    "",
  ].join("\n");

  process.stdout.write(`${prompt}\n`);

  if (hasFlag("--write")) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(researchDir, "scratchpad", "ideas", `${stamp}-idea-chat.md`);
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, `${prompt}\n`);
    console.log(`\nIdea chat prompt written to ${path.relative(cwd, file)}`);
  }
}

function cmdCompare() {
  const cwd = targetDir();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const metricName = option("--metric", null);
  const direction = String(option("--direction", "lower")).toLowerCase();
  const preferHigher = direction === "higher" || direction === "max" || direction === "maximize";

  if (!fs.existsSync(ledger)) {
    console.log("No run ledger found. Run `autoresearch init` first.");
    return;
  }

  const rows = fs
    .readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      try {
        return JSON.parse(row);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const candidates = rows.filter((row) => row.metrics && typeof row.metrics === "object");
  let resolvedMetric = metricName;
  if (!resolvedMetric) {
    for (const row of candidates) {
      for (const key of Object.keys(row.metrics)) {
        if (Number.isFinite(rowMetricValue(row, key))) {
          resolvedMetric = key;
          break;
        }
      }
      if (resolvedMetric) {
        break;
      }
    }
  }

  if (!resolvedMetric) {
    console.log("No comparable numeric metric found in the run ledger.");
    return;
  }

  const scored = candidates
    .map((row) => ({
      row,
      value: rowMetricValue(row, resolvedMetric),
    }))
    .filter((entry) => Number.isFinite(entry.value));

  if (!scored.length) {
    console.log(`No numeric values found for metric: ${resolvedMetric}`);
    return;
  }

  if (scored.length >= 2) {
    const fp0 = scored[0].row.data_fingerprint;
    const fp1 = scored[1].row.data_fingerprint;
    if (fp0 && fp1 && fp0 !== fp1) {
      console.error("WARNING: compared runs have different data fingerprints — data may have changed between runs");
    }
  }

  scored.sort((a, b) => (preferHigher ? b.value - a.value : a.value - b.value));
  const best = scored[0];
  const worst = scored[scored.length - 1];

  console.log(`metric: ${resolvedMetric}`);
  console.log(`direction: ${preferHigher ? "higher" : "lower"}`);
  console.log(`runs_compared: ${scored.length}`);
  console.log(`best: ${best.row.id} = ${best.value}`);
  console.log(`worst: ${worst.row.id} = ${worst.value}`);
  console.log("top_3:");
  for (const entry of scored.slice(0, 3)) {
    console.log(`- ${entry.row.id}: ${entry.value}`);
  }

  const gpuRows = scored.filter((e) => e.row && e.row.gpu_present);
  if (gpuRows.length > 0) {
    const totalGpuHours = gpuRows.reduce((acc, e) => acc + (Number(e.row.gpu_hours) || 0), 0);
    const peakMem = Math.max(...gpuRows.map((e) => Number(e.row.gpu_memory_peak_mb) || 0));
    console.log(`gpu_runs: ${gpuRows.length}`);
    console.log(`gpu_hours_total: ${totalGpuHours.toFixed(4)}`);
    console.log(`gpu_memory_peak_mb: ${peakMem}`);
  }

  const tierAnalysis = evaluateMetricTiers(rows, readMetricTierConfig(cwd));
  if (tierAnalysis.comparable_runs > 0) {
    console.log("metric_tiers:");
    console.log(`  profile: ${tierAnalysis.profile}`);
    console.log(`  baseline: ${tierAnalysis.baseline_id || "none"}`);
    console.log(`  candidate: ${tierAnalysis.candidate_id || "none"}`);
    console.log(`  recommendation: ${tierAnalysis.recommendation.label}`);
    console.log(`  reason: ${tierAnalysis.recommendation.reason}`);
    console.log(`  overall_score: ${formatReportNumber(tierAnalysis.overall_score)}`);
    for (const level of tierAnalysis.levels) {
      console.log(`  ${level.key}: available=${level.available}/${level.metrics.length} avg=${formatReportPercent(level.avg_improvement)} weighted=${formatReportNumber(level.weighted_score)}`);
    }
  }

  // Auto-significance: when the best run is distinct from the worst, run
  // the permutation test + bootstrap CI automatically. Skips when either
  // side is a single-point scalar AND the other side is also a single-point
  // scalar (uninformative) unless the user passes --skip-significance.
  if (!hasFlag("--skip-significance") && scored.length >= 2 && best.row.id !== worst.row.id) {
    try {
      const extractA = extractRunValues(worst.row, resolvedMetric);
      const extractB = extractRunValues(best.row, resolvedMetric);
      if (extractA.values.length > 0 && extractB.values.length > 0
          && !(extractA.source === "scalar" && extractB.source === "scalar")) {
        const stats = runSignificanceTest(extractA.values, extractB.values, { nPermutations: 5000, nBootstrap: 2000, seed: 42 });
        const verdict = stats.p_value < 0.05 ? "SIGNIFICANT" : "not significant";
        console.log("---");
        console.log(`significance (best vs worst, auto):`);
        console.log(`  delta: ${(stats.delta).toFixed(6)}   CI95 [${stats.ci_low.toFixed(6)}, ${stats.ci_high.toFixed(6)}]`);
        console.log(`  Cohen's d: ${stats.cohens_d.toFixed(3)}   p (permutation): ${stats.p_value.toFixed(4)}   verdict: ${verdict}`);
        if (stats.p_value >= 0.05) {
          console.log("  Tip: \"best\" may be inside the seed noise. Run `autoresearch power --detect-delta` to size N.");
        }
      }
    } catch { /* never block compare on a stats failure */ }
  }
}

function renderMetricTierText(analysis) {
  const lines = [
    `profile: ${analysis.profile} (${analysis.profile_label || "custom"})`,
    `baseline: ${analysis.baseline_id || "none"}`,
    `candidate: ${analysis.candidate_id || "none"}`,
    `recommendation: ${analysis.recommendation.label}`,
    `reason: ${analysis.recommendation.reason}`,
    `overall_score: ${formatReportNumber(analysis.overall_score)}`,
  ];
  for (const level of analysis.levels) {
    lines.push(`${level.key}: available=${level.available}/${level.metrics.length} avg=${formatReportPercent(level.avg_improvement)} weighted=${formatReportNumber(level.weighted_score)}`);
    for (const metric of level.metrics) {
      const delta = metric.improvement === null ? "—" : formatReportPercent(metric.improvement);
      lines.push(`  - ${metric.name}: ${metric.direction} baseline=${metric.baseline ?? "—"} current=${metric.current ?? "—"} improvement=${delta}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function cmdMetricTiers() {
  const cwd = targetDir();
  const sub = subcommandFor("metric-tiers", ["init", "show", "score"]) || "show";
  const profile = String(option("--profile", "hpc_operator")).trim() || "hpc_operator";
  const format = String(option("--format", "text")).toLowerCase();
  if (sub === "init") {
    const config = writeMetricTierConfig(cwd, buildDefaultMetricTierConfig(profile));
    if (format === "json") {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(`metric_tiers: ${config.file}`);
      console.log(`profile: ${config.profile}`);
    }
    return;
  }
  const config = readMetricTierConfig(cwd, profile);
  if (sub === "show") {
    if (format === "json") {
      console.log(JSON.stringify(config, null, 2));
    } else {
      process.stdout.write(metricTierConfigToYaml(config));
    }
    return;
  }
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const rows = parseRunsLedger(ledger);
  const analysis = evaluateMetricTiers(rows, config);
  if (format === "json") {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    process.stdout.write(renderMetricTierText(analysis));
  }
}

function rowMetricValue(row, key) {
  if (!row || !row.metrics || !(key in row.metrics)) {
    return Number.NaN;
  }
  return metricNumber(row.metrics[key]);
}

// Returns { values, source } for a run row.
// - Seed aggregate rows (with seeds.values array) contribute every seed value.
// - Single rows contribute the scalar at metrics[name], if finite.
// - Returns { values: [], source: "none" } when nothing usable is present.
function extractRunValues(row, metricName) {
  if (!row) return { values: [], source: "none" };
  if (row.seeds && Array.isArray(row.seeds.values)) {
    const vals = row.seeds.values.filter((v) => Number.isFinite(Number(v))).map(Number);
    if (vals.length > 0) return { values: vals, source: "seeds" };
  }
  const v = metricNumber(row.metrics ? row.metrics[metricName] : NaN);
  if (Number.isFinite(v)) return { values: [v], source: "scalar" };
  return { values: [], source: "none" };
}

// Mulberry32 PRNG — deterministic, no deps. Returns floats in [0, 1).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arrMean(arr) {
  if (arr.length === 0) return NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Sample standard deviation (n-1). For n<=1 returns 0 to avoid NaN-cascade in display.
function arrStd(arr) {
  if (arr.length <= 1) return 0;
  const m = arrMean(arr);
  const ss = arr.reduce((a, b) => a + (b - m) ** 2, 0);
  return Math.sqrt(ss / (arr.length - 1));
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo);
}

// Permutation test (two-sided) + bootstrap CI on the delta of means.
//
// Permutation test answers "is the observed |delta| unlikely under the null
// that the two groups are exchangeable?" — exact for small n, no t-distribution
// approximation required.
//
// Bootstrap CI: resample within each group, recompute delta. Wide CIs at small
// n are honest; the caller should not pretend otherwise.
function runSignificanceTest(valuesA, valuesB, opts = {}) {
  const nPerm = Math.max(100, Math.min(200000, opts.nPermutations || 10000));
  const nBoot = Math.max(100, Math.min(200000, opts.nBootstrap || 10000));
  const seed = Number.isFinite(opts.seed) ? opts.seed : 42;
  const rng = mulberry32(seed);

  const meanA = arrMean(valuesA);
  const meanB = arrMean(valuesB);
  const stdA = arrStd(valuesA);
  const stdB = arrStd(valuesB);
  const observedDelta = meanA - meanB;

  const pooled = valuesA.concat(valuesB);
  const nA = valuesA.length;
  let countExtreme = 0;
  for (let i = 0; i < nPerm; i += 1) {
    const shuffled = pooled.slice();
    for (let j = shuffled.length - 1; j > 0; j -= 1) {
      const k = Math.floor(rng() * (j + 1));
      const tmp = shuffled[j];
      shuffled[j] = shuffled[k];
      shuffled[k] = tmp;
    }
    let sumA = 0;
    for (let j = 0; j < nA; j += 1) sumA += shuffled[j];
    let sumB = 0;
    for (let j = nA; j < shuffled.length; j += 1) sumB += shuffled[j];
    const permDelta = sumA / nA - sumB / (shuffled.length - nA);
    if (Math.abs(permDelta) >= Math.abs(observedDelta) - 1e-12) countExtreme += 1;
  }
  const pValue = countExtreme / nPerm;

  const bootDeltas = new Array(nBoot);
  for (let i = 0; i < nBoot; i += 1) {
    let sumA = 0;
    for (let j = 0; j < nA; j += 1) sumA += valuesA[Math.floor(rng() * nA)];
    let sumB = 0;
    const nB = valuesB.length;
    for (let j = 0; j < nB; j += 1) sumB += valuesB[Math.floor(rng() * nB)];
    bootDeltas[i] = sumA / nA - sumB / nB;
  }
  bootDeltas.sort((a, b) => a - b);
  const ciLow = percentile(bootDeltas, 0.025);
  const ciHigh = percentile(bootDeltas, 0.975);

  // Pooled SD for Cohen's d; falls back to averaged SD when one group has n=1.
  let pooledSd = NaN;
  if (valuesA.length > 1 || valuesB.length > 1) {
    const num = (Math.max(0, valuesA.length - 1)) * stdA ** 2 + (Math.max(0, valuesB.length - 1)) * stdB ** 2;
    const den = Math.max(1, valuesA.length + valuesB.length - 2);
    pooledSd = Math.sqrt(num / den);
  }
  const cohensD = Number.isFinite(pooledSd) && pooledSd > 0 ? observedDelta / pooledSd : null;

  return {
    n_a: valuesA.length,
    n_b: valuesB.length,
    mean_a: meanA,
    mean_b: meanB,
    std_a: stdA,
    std_b: stdB,
    delta: observedDelta,
    ci_low: ciLow,
    ci_high: ciHigh,
    cohens_d: cohensD,
    p_value: pValue,
    n_permutations: nPerm,
    n_bootstrap: nBoot,
    seed,
  };
}

function fmtSig(n, digits = 6) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "null";
  return Number(n).toFixed(digits);
}

async function cmdSignificance() {
  const cwd = targetDir();
  const sigIdx = args.findIndex((a) => a === "significance" || a === "sig");
  const runIdA = String(option("--id-a", sigIdx !== -1 && args[sigIdx + 1] && !args[sigIdx + 1].startsWith("-") ? args[sigIdx + 1] : "")).trim();
  const runIdB = String(option("--id-b", sigIdx !== -1 && args[sigIdx + 2] && !args[sigIdx + 2].startsWith("-") ? args[sigIdx + 2] : "")).trim();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const alpha = Math.max(0, Math.min(1, parseFloat(String(option("--alpha", "0.05")))));
  const nPermutations = parseInt(String(option("--n-permutations", "10000")), 10);
  const nBootstrap = parseInt(String(option("--n-bootstrap", "10000")), 10);
  const seed = parseInt(String(option("--seed", "42")), 10);
  const requireSignificant = hasFlag("--require-significant");
  const directionRaw = option("--direction", null);

  if (!runIdA || !runIdB) {
    console.error("Usage: autoresearch significance <run-a> <run-b> [--metric NAME] [--alpha N] [--n-permutations N] [--seed N] [--format text|json] [--require-significant] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found at " + ledger);
    process.exitCode = 1;
    return;
  }

  const rowA = readRunRowById(cwd, runIdA);
  const rowB = readRunRowById(cwd, runIdB);
  if (!rowA) { console.error("Run not found: " + runIdA); process.exitCode = 1; return; }
  if (!rowB) { console.error("Run not found: " + runIdB); process.exitCode = 1; return; }

  let metricName = option("--metric", null);
  if (!metricName || typeof metricName !== "string") {
    const fromA = rowA.metrics ? Object.keys(rowA.metrics).filter((k) => !k.endsWith("_std"))[0] : null;
    const fromB = rowB.metrics ? Object.keys(rowB.metrics).filter((k) => !k.endsWith("_std"))[0] : null;
    metricName = fromA || fromB || "val_loss";
  }
  metricName = String(metricName).trim();

  const extractA = extractRunValues(rowA, metricName);
  const extractB = extractRunValues(rowB, metricName);
  if (extractA.values.length === 0) {
    console.error(`Run ${runIdA} has no usable value for metric "${metricName}".`);
    process.exitCode = 1;
    return;
  }
  if (extractB.values.length === 0) {
    console.error(`Run ${runIdB} has no usable value for metric "${metricName}".`);
    process.exitCode = 1;
    return;
  }
  if (extractA.source === "scalar" && extractB.source === "scalar") {
    console.error("WARNING: both sides are single-point runs (n=1 vs n=1). Permutation p-value is uninformative; rerun with `--seeds N` on at least one side for a real test.");
  }

  const stats = runSignificanceTest(extractA.values, extractB.values, {
    nPermutations,
    nBootstrap,
    seed,
  });
  const significant = stats.p_value < alpha;
  const direction = directionRaw && typeof directionRaw === "string" ? String(directionRaw).toLowerCase() : null;
  let interpretation = "no preference declared";
  if (direction === "lower" || direction === "min" || direction === "minimize") {
    interpretation = stats.delta < 0 ? `${runIdA} better (lower)` : (stats.delta > 0 ? `${runIdB} better (lower)` : "tied");
  } else if (direction === "higher" || direction === "max" || direction === "maximize") {
    interpretation = stats.delta > 0 ? `${runIdA} better (higher)` : (stats.delta < 0 ? `${runIdB} better (higher)` : "tied");
  }

  const minN = Math.min(stats.n_a, stats.n_b);
  const smallN = minN < 3;

  if (formatJson) {
    const out = {
      metric: metricName,
      alpha,
      run_a: { id: runIdA, n: stats.n_a, mean: stats.mean_a, std: stats.std_a, source: extractA.source },
      run_b: { id: runIdB, n: stats.n_b, mean: stats.mean_b, std: stats.std_b, source: extractB.source },
      delta: stats.delta,
      ci_95: [stats.ci_low, stats.ci_high],
      cohens_d: stats.cohens_d,
      p_value: stats.p_value,
      significant,
      n_permutations: stats.n_permutations,
      n_bootstrap: stats.n_bootstrap,
      seed: stats.seed,
      direction,
      interpretation,
      small_n_warning: smallN,
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`significance: ${runIdA} vs ${runIdB}`);
    console.log(`metric: ${metricName}`);
    console.log(`alpha: ${alpha}`);
    console.log(`n_permutations: ${stats.n_permutations}`);
    console.log(`n_bootstrap: ${stats.n_bootstrap}`);
    console.log(`seed: ${stats.seed}`);
    console.log("---");
    console.log("| run | source | n | mean | std |");
    console.log("| --- | --- | --- | --- | --- |");
    console.log(`| ${runIdA} | ${extractA.source} | ${stats.n_a} | ${fmtSig(stats.mean_a)} | ${fmtSig(stats.std_a)} |`);
    console.log(`| ${runIdB} | ${extractB.source} | ${stats.n_b} | ${fmtSig(stats.mean_b)} | ${fmtSig(stats.std_b)} |`);
    console.log("---");
    console.log(`delta (${runIdA} - ${runIdB}): ${fmtSig(stats.delta)}`);
    console.log(`ci_95 (bootstrap): [${fmtSig(stats.ci_low)}, ${fmtSig(stats.ci_high)}]`);
    console.log(`cohens_d: ${stats.cohens_d === null ? "null" : fmtSig(stats.cohens_d, 3)}`);
    console.log(`p_value (permutation, two-sided): ${fmtSig(stats.p_value, 4)}`);
    console.log(`significant: ${significant ? "yes" : "no"} (p${significant ? "<" : ">="}${alpha})`);
    if (direction) console.log(`interpretation: ${interpretation}`);
    if (smallN) {
      console.log(`warning: small n on at least one side (min=${minN}) — CI and effect size are wide`);
    }
  }

  if (requireSignificant && !significant) {
    process.exitCode = 1;
  }
}

function parseMetric(metricText) {
  const splitAt = metricText.indexOf("=");
  if (splitAt === -1) {
    return [metricText, true];
  }
  const key = metricText.slice(0, splitAt).trim();
  const rawValue = metricText.slice(splitAt + 1).trim();
  const numberValue = Number(rawValue);
  return [key, Number.isNaN(numberValue) ? rawValue : numberValue];
}

function cmdRecord() {
  const cwd = targetDir();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  ensureDir(path.dirname(ledger));

  const metrics = {};
  for (const metric of optionsAll("--metric")) {
    const [key, value] = parseMetric(metric);
    if (key) {
      metrics[key] = value;
    }
  }

  const row = {
    id: String(option("--id", `run-${new Date().toISOString().replace(/[:.]/g, "-")}`)),
    timestamp: new Date().toISOString(),
    status: String(option("--status", "recorded")),
    agent: String(option("--agent", "manual")),
    command: option("--command", null),
    metrics,
    notes: String(option("--note", "")),
  };

  fs.appendFileSync(ledger, `${JSON.stringify(row)}\n`);
  console.log(`Recorded run: ${row.id}`);
}

function defaultMetricRegex(metricName) {
  const escaped = metricName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])["']?${escaped}["']?\\s*[:=]\\s*["']?(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`, "gi");
}

function knownMetricNamesForParsing(primaryMetric = "") {
  const names = new Set(Object.keys(METRIC_DIRECTION_DEFAULTS));
  for (const profile of Object.values(METRIC_TIER_PROFILES)) {
    for (const level of METRIC_TIER_LEVELS) {
      for (const metric of profile[level.key] || []) names.add(metric);
    }
  }
  if (primaryMetric) names.add(String(primaryMetric));
  return names;
}

function isMetricLikeKey(key, knownNames) {
  const normalized = String(key || "").trim();
  if (!normalized) return false;
  if (knownNames.has(normalized)) return true;
  return /(?:latency|throughput|tflops|speedup|bandwidth|util|memory|footprint|rate|tokens|samples|cost|time|overhead|occupancy|efficiency|_ms|_sec|_seconds|_pct)$/i.test(normalized);
}

function extractJsonMetrics(value, knownNames, out = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      extractJsonMetrics(raw, knownNames, out);
      continue;
    }
    if (!isMetricLikeKey(key, knownNames)) continue;
    const num = Number(raw);
    if (Number.isFinite(num)) out[key] = num;
  }
  return out;
}

function extractMarkdownTableMetrics(output) {
  const text = String(output || "");
  const averageIndex = text.toLowerCase().lastIndexOf("average benchmark");
  const scope = averageIndex >= 0 ? text.slice(averageIndex) : text;
  const numericValues = [];
  for (const rawLine of scope.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (/^\|[-:\s|]+\|$/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2 || /^operation$/i.test(cells[0])) continue;
    for (const cell of cells.slice(1)) {
      if (/%/.test(cell)) continue;
      const match = cell.match(/[-+]?(\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?/);
      if (!match) continue;
      const value = Number(match[0]);
      if (Number.isFinite(value)) numericValues.push(value);
    }
  }
  if (!numericValues.length) return {};
  const sorted = numericValues.slice().sort((a, b) => a - b);
  const mean = numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
  const median = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    latency_ms: Number(median.toFixed(6)),
    mean_ms: Number(mean.toFixed(6)),
    min_ms: Number(sorted[0].toFixed(6)),
    max_ms: Number(sorted[sorted.length - 1].toFixed(6)),
  };
}

function extractMetricsFromOutput(output, primaryMetric, customRegexSource) {
  const knownNames = knownMetricNamesForParsing(primaryMetric);
  const metrics = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) extractJsonMetrics(entry, knownNames, metrics);
      } else {
        extractJsonMetrics(parsed, knownNames, metrics);
      }
    } catch {
      // Most logs are not JSON; skip non-JSON lines.
    }
  }
  for (const metric of knownNames) {
    const values = extractMetricSeriesFromText(output, metric, null);
    if (values.length) metrics[metric] = values[values.length - 1];
  }
  if (primaryMetric && customRegexSource) {
    const primary = parseMetricFromOutput(output, primaryMetric, customRegexSource);
    if (primary !== null) metrics[primaryMetric] = primary;
  }
  for (const [key, value] of Object.entries(extractMarkdownTableMetrics(output))) {
    if (!isNumericMetric(metrics[key])) metrics[key] = value;
  }
  return metrics;
}

function parseMetricFromOutput(output, metricName, customRegexSource) {
  const regex = customRegexSource
    ? new RegExp(customRegexSource, "gi")
    : defaultMetricRegex(metricName);
  let last = null;
  let match;
  while ((match = regex.exec(output)) !== null) {
    last = match[1] !== undefined ? match[1] : match[0];
  }
  if (last !== null && Number.isFinite(Number(last))) {
    return Number(last);
  }
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    try {
      const obj = JSON.parse(lines[idx]);
      if (obj && typeof obj === "object" && metricName in obj && Number.isFinite(Number(obj[metricName]))) {
        return Number(obj[metricName]);
      }
    } catch {
      // not JSON, skip
    }
  }
  return null;
}

// Eval config (G04/G05/G09/G11) — parses .researchloop/eval.yaml without a YAML dep.
// Keep this intentionally small: top-level scalar keys and inline-list rules.

function loadEvalConfig(cwd) {
  const evalFile = path.join(cwd, ".researchloop", "eval.yaml");
  if (!fs.existsSync(evalFile)) {
    return { earlyStop: [], gates: [], checkpointGlob: null, resumeFlagTemplate: null, metrics: [], evalCommand: null, present: false };
  }
  const raw = fs.readFileSync(evalFile, "utf8");
  const spec = loadEvalSpec(cwd);
  return {
    earlyStop: parseEvalListSection(raw, "early_stop"),
    gates: parseEvalListSection(raw, "gates"),
    checkpointGlob: parseEvalScalar(raw, "checkpoint_glob"),
    resumeFlagTemplate: parseEvalScalar(raw, "resume_flag_template"),
    metrics: spec.metrics || [],
    evalCommand: spec.evalCommand || null,
    present: true,
  };
}

function stripYamlInlineComment(text) {
  let inStr = null;
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (ch === inStr && text[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      out += ch;
      continue;
    }
    if (ch === "#") break;
    out += ch;
  }
  return out.trim();
}

function parseEvalScalar(text, key) {
  const re = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(.*)$`);
  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s*#/.test(rawLine)) continue;
    const match = rawLine.match(re);
    if (!match) continue;
    let value = stripYamlInlineComment(match[1] || "");
    if (!value || value === "null" || value === "~" || value === "[]") return null;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value.trim() || null;
  }
  return null;
}

function parseEvalListSection(text, sectionName) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inSection = false;
  const headRe = new RegExp(`^${sectionName}\\s*:`);
  const flowEmptyRe = new RegExp(`^${sectionName}\\s*:\\s*\\[\\s*\\]\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!inSection) {
      if (flowEmptyRe.test(line)) {
        return [];
      }
      if (headRe.test(line)) {
        inSection = true;
      }
      continue;
    }
    if (/^\S/.test(line) && !/^\s*-/.test(line)) {
      break;
    }
    const item = line.match(/^\s*-\s*(\{.*\})\s*$/);
    if (item) {
      const parsed = parseInlineObject(item[1]);
      if (parsed) out.push(parsed);
    }
  }
  return out;
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
    if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue; }
    if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  const obj = {};
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
    let value = part.slice(idx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
      value = Number(value);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (value === "null" || value === "~") {
      value = null;
    }
    obj[key] = value;
  }
  return obj;
}

function toPosixPath(filePath) {
  return String(filePath).split(path.sep).join("/");
}

function hasGlobMagic(pattern) {
  return /[*?\[]/.test(String(pattern || ""));
}

function globStaticBase(pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const firstMagic = normalized.search(/[*?\[]/);
  if (firstMagic === -1) {
    const dir = path.posix.dirname(normalized);
    return dir === "." ? "." : dir;
  }
  const prefix = normalized.slice(0, firstMagic);
  const slash = prefix.lastIndexOf("/");
  if (slash === -1) return ".";
  const dir = prefix.slice(0, slash);
  return dir || ".";
}

function globPatternToRegex(pattern) {
  const normalized = String(pattern || "").replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "^";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i += 1;
        if (normalized[i + 1] === "/") {
          i += 1;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  out += "$";
  return new RegExp(out);
}

function collectFilesForGlob(baseDir, out = [], limit = 20000) {
  if (out.length >= limit) return out;
  let entries;
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (out.length >= limit) break;
    const full = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache"].includes(entry.name)) {
        continue;
      }
      collectFilesForGlob(full, out, limit);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function checkpointResult(cwd, filePath, stat) {
  const absolute = path.resolve(filePath);
  return {
    absolute,
    relative: toPosixPath(path.relative(cwd, absolute)),
    mtimeMs: stat.mtimeMs,
  };
}

function findNewestCheckpoint(cwd, pattern) {
  if (!pattern || typeof pattern !== "string") return null;
  const normalized = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized) return null;
  if (!hasGlobMagic(normalized)) {
    const filePath = path.resolve(cwd, normalized);
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() ? checkpointResult(cwd, filePath, stat) : null;
    } catch {
      return null;
    }
  }

  const base = globStaticBase(normalized);
  const baseDir = path.resolve(cwd, base);
  if (!fs.existsSync(baseDir)) return null;
  const re = globPatternToRegex(normalized);
  let best = null;
  for (const filePath of collectFilesForGlob(baseDir)) {
    const rel = toPosixPath(path.relative(cwd, filePath));
    if (!re.test(rel)) continue;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const hit = checkpointResult(cwd, filePath, stat);
    if (!best || hit.mtimeMs > best.mtimeMs || (hit.mtimeMs === best.mtimeMs && hit.relative > best.relative)) {
      best = hit;
    }
  }
  return best;
}

function existingCheckpointFromRow(cwd, row) {
  if (!row || !row.last_checkpoint || typeof row.last_checkpoint !== "string") return null;
  const rel = row.last_checkpoint.trim();
  if (!rel) return null;
  const absolute = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
  try {
    const stat = fs.statSync(absolute);
    return stat.isFile() ? checkpointResult(cwd, absolute, stat) : null;
  } catch {
    return null;
  }
}

function applyResumeFlagTemplate(commandText, template, checkpointRel) {
  const flagTemplate = template && typeof template === "string" ? template : "--resume {path}";
  const quotedPath = shellQuote(checkpointRel);
  const flag = flagTemplate
    .replace(/\{path\}/g, quotedPath)
    .replace(/\{checkpoint\}/g, quotedPath)
    .trim();
  return flag ? `${commandText} ${flag}` : commandText;
}

// Retry rules (G12): same loader pattern as gates / early_stop.
function loadEvalRetryRules(cwd) {
  const evalFile = path.join(cwd, ".researchloop", "eval.yaml");
  if (!fs.existsSync(evalFile)) return [];
  const raw = fs.readFileSync(evalFile, "utf8");
  return parseEvalListSection(raw, "retry");
}

// Apply a transform string to a command. Supported today:
//   halve:<flag>         e.g. halve:batch_size  -> "--batch_size 64" becomes "--batch_size 32"
//   set:<flag>=<value>   e.g. set:gradient_checkpointing=true
// Returns { command, applied: bool, change: string|null }
function applyRetryTransform(commandText, transform) {
  if (!commandText || !transform) return { command: commandText, applied: false, change: null };
  const halveMatch = String(transform).match(/^halve:([A-Za-z0-9_.-]+)$/);
  if (halveMatch) {
    const flag = halveMatch[1];
    const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Match --flag VAL, --flag=VAL, -flag VAL, -flag=VAL, or env-style FLAG=VAL.
    const patterns = [
      new RegExp(`(--?${escapedFlag})(\\s+)(-?\\d+(?:\\.\\d+)?)`, "i"),
      new RegExp(`(--?${escapedFlag}=)(-?\\d+(?:\\.\\d+)?)`, "i"),
      new RegExp(`(\\b${escapedFlag}=)(-?\\d+(?:\\.\\d+)?)`),
    ];
    for (const re of patterns) {
      const m = commandText.match(re);
      if (m) {
        // m[0] is full match; m[1..N] are groups; the value is the last group.
        const valueIdx = m.length - 1;
        const current = Number(m[valueIdx]);
        if (!Number.isFinite(current) || current <= 1) continue;
        const next = Math.max(1, Math.floor(current / 2));
        // Within String.replace's callback, `groups` starts at m[1] — so the
        // value is at index `valueIdx - 1`. Keep the prefix groups, drop the
        // value group, append the halved value.
        const valueIdxInGroups = valueIdx - 1;
        const replaced = commandText.replace(re, (_full, ...groups) => {
          const prefix = groups.slice(0, valueIdxInGroups);
          return prefix.join("") + String(next);
        });
        if (replaced !== commandText) {
          return { command: replaced, applied: true, change: `${flag}: ${current} -> ${next}` };
        }
      }
    }
    return { command: commandText, applied: false, change: null };
  }
  const setMatch = String(transform).match(/^set:([A-Za-z0-9_.-]+)=(.+)$/);
  if (setMatch) {
    const flag = setMatch[1];
    const value = setMatch[2];
    const escapedFlag = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const present = new RegExp(`(--?${escapedFlag})(\\s+|=)[^\\s]+`, "i").test(commandText);
    if (present) {
      const replaced = commandText.replace(
        new RegExp(`(--?${escapedFlag})(\\s+|=)([^\\s]+)`, "i"),
        (_full, g1, g2) => `${g1}${g2}${value}`,
      );
      return { command: replaced, applied: replaced !== commandText, change: `${flag} <- ${value}` };
    }
    // Append the flag.
    return { command: `${commandText} --${flag} ${value}`, applied: true, change: `${flag} appended as ${value}` };
  }
  return { command: commandText, applied: false, change: null };
}

// Pick a retry rule whose `match` regex appears in the output. Returns the rule or null.
function findRetryRule(rules, output) {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    if (!rule || !rule.match) continue;
    try {
      const re = new RegExp(rule.match, "i");
      if (re.test(output)) return rule;
    } catch { /* invalid regex, skip */ }
  }
  return null;
}

// Resolve "{baseline}-0.02" / "{baseline}*0.95" / literal numbers against a baseline value.
function resolveGateValue(spec, baselineValue) {
  if (typeof spec === "number") return spec;
  if (typeof spec !== "string") return null;
  const text = spec.trim();
  const num = Number(text);
  if (Number.isFinite(num)) return num;
  const m = text.match(/^\{baseline\}\s*([+\-*\/])?\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)?$/);
  if (!m) return null;
  if (!Number.isFinite(baselineValue)) return null;
  if (!m[1]) return baselineValue;
  const delta = Number(m[2]);
  if (!Number.isFinite(delta)) return null;
  switch (m[1]) {
    case "+": return baselineValue + delta;
    case "-": return baselineValue - delta;
    case "*": return baselineValue * delta;
    case "/": return delta === 0 ? null : baselineValue / delta;
    default: return null;
  }
}

function evalCompareOp(op, lhs, rhs) {
  if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) return false;
  switch (op) {
    case "<": return lhs < rhs;
    case "<=": return lhs <= rhs;
    case ">": return lhs > rhs;
    case ">=": return lhs >= rhs;
    case "==": case "=": return lhs === rhs;
    case "!=": return lhs !== rhs;
    default: return false;
  }
}

function readBaselineMetricValue(cwd, metricName) {
  const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
  if (fs.existsSync(lockFile)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      const v = lock?.metric_value ?? lock?.value ?? (lock?.metrics && lock.metrics[metricName]);
      const numeric = metricNumber(v);
      if (Number.isFinite(numeric)) return numeric;
    } catch { /* fall through */ }
  }
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) return null;
  const rows = fs.readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    try {
      const row = JSON.parse(rows[i]);
      if (row.agent && String(row.agent).startsWith("autoresearch baseline")) {
        const v = row?.metrics?.[metricName];
        const numeric = metricNumber(v);
        if (Number.isFinite(numeric)) return numeric;
      }
    } catch { /* skip */ }
  }
  return null;
}

function applyPromotionGates(cwd, gates, finalMetrics, defaultMetric) {
  if (!gates || gates.length === 0) {
    return { status: null, reasons: [] };
  }
  const reasons = [];
  let promoted = false;
  let discarded = false;
  for (const gate of gates) {
    const metric = gate.metric || defaultMetric;
    const value = metricNumber(finalMetrics?.[metric]);
    if (!Number.isFinite(value)) {
      reasons.push(`${metric}: no value (gate skipped)`);
      continue;
    }
    const baseline = readBaselineMetricValue(cwd, metric);
    const threshold = resolveGateValue(gate.value, baseline);
    if (threshold === null) {
      reasons.push(`${metric}: could not resolve threshold ${JSON.stringify(gate.value)}`);
      continue;
    }
    const triggered = evalCompareOp(gate.op, value, threshold);
    if (!triggered) continue;
    const action = String(gate.action || "promote").toLowerCase();
    reasons.push(`${metric}=${value} ${gate.op} ${threshold} -> ${action}`);
    if (action === "promote") promoted = true;
    else if (action === "discard") discarded = true;
  }
  let status = null;
  if (discarded) status = "discarded";
  else if (promoted) status = "promoted";
  else status = "kept";
  return { status, reasons };
}

// Early-stop rule evaluator: returns a string reason on trigger, or null.
function evaluateEarlyStopRules(rules, metricName, value, sampleCount, baselineByMetric) {
  for (const rule of rules) {
    const m = rule.metric || metricName;
    if (m !== metricName) continue;
    const ruleText = String(rule.rule || "").trim();
    if (ruleText === "nan_or_inf") {
      if (!Number.isFinite(value)) {
        return `nan_or_inf ${m}`;
      }
      continue;
    }
    const xMatch = ruleText.match(/^>\s*(\d+(?:\.\d+)?)\s*x_baseline(?:_after_step_(\d+))?$/);
    if (xMatch) {
      const factor = Number(xMatch[1]);
      const afterStep = xMatch[2] ? Number(xMatch[2]) : 0;
      const baseline = baselineByMetric[m];
      if (!Number.isFinite(baseline) || baseline === 0) continue;
      if (sampleCount <= afterStep) continue;
      if (Number.isFinite(value) && Math.abs(value) > factor * Math.abs(baseline)) {
        return `>${factor}x_baseline ${m}=${value} (baseline=${baseline})`;
      }
    }
  }
  return null;
}

// Per-run artifact directory contract (G32).
// Each run / baseline writes a self-describing bundle into runDir so
// downstream tools (replay, promote, dashboard, external trainers) can
// consume a run without re-parsing runs.jsonl.

function writeArtifactEnvJson(runDir, env) {
  fs.writeFileSync(path.join(runDir, "env.json"), `${JSON.stringify(env, null, 2)}\n`);
}

function writeArtifactCodeDiff(runDir, cwd) {
  const result = runCapture("git diff HEAD 2>&1", cwd);
  const content = result.ok ? result.output : "";
  fs.writeFileSync(path.join(runDir, "code.diff"), content ? `${content}\n` : "");
}

function writeArtifactConfigJson(runDir, fields) {
  fs.writeFileSync(path.join(runDir, "config.json"), `${JSON.stringify(fields, null, 2)}\n`);
}

function writeArtifactMetricsJsonl(runDir, metricName, metricSeries) {
  const file = path.join(runDir, "metrics.jsonl");
  if (!metricSeries || metricSeries.length === 0) {
    fs.writeFileSync(file, "");
    return;
  }
  const lines = metricSeries
    .map((value, index) => JSON.stringify({ metric: metricName, step: index + 1, value }))
    .join("\n");
  fs.writeFileSync(file, `${lines}\n`);
}

function probeGpuStats() {
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const gpus = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [util, used, total] = line.split(",").map((p) => Number(p.trim()));
        return {
          util_pct: Number.isFinite(util) ? util : null,
          mem_used_mb: Number.isFinite(used) ? used : null,
          mem_total_mb: Number.isFinite(total) ? total : null,
        };
      });
    return gpus.length ? gpus : null;
  } catch {
    return null;
  }
}

function probeGpuProcessStats(pids) {
  const pidSet = new Set((pids || []).map((pid) => Number(pid)).filter((pid) => Number.isFinite(pid)));
  if (!pidSet.size) return null;
  try {
    const out = execSync(
      "nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 },
    );
    const rows = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pidText, memoryText] = line.split(",").map((p) => p.trim());
        const pid = Number(pidText);
        const memoryMb = Number(memoryText);
        return {
          pid,
          memory_mb: Number.isFinite(memoryMb) ? memoryMb : null,
        };
      })
      .filter((row) => pidSet.has(row.pid));
    if (!rows.length) return null;
    const memoryMb = rows.reduce((sum, row) => sum + (Number(row.memory_mb) || 0), 0);
    return {
      source: "nvidia-smi compute-apps",
      process_gpu_memory_mb: memoryMb,
      processes: rows,
    };
  } catch {
    return null;
  }
}

function parseCpuTimeSeconds(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const daySplit = text.split("-");
  let days = 0;
  let timeText = text;
  if (daySplit.length === 2) {
    days = Number(daySplit[0]);
    timeText = daySplit[1];
  }
  const parts = timeText.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  } else {
    return null;
  }
  return days * 86400 + seconds;
}

function readUnixProcessTable() {
  try {
    const out = execSync("ps -axo pid=,ppid=,pcpu=,rss=,time=,command=", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1800,
    });
    const rows = out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d+)\s+([0-9.]+)\s+(\d+)\s+([0-9:.+-]+)\s*(.*)$/);
        if (!match) return null;
        const pid = Number(match[1]);
        const ppid = Number(match[2]);
        const pcpuPct = Number(match[3]);
        const rssKb = Number(match[4]);
        return {
          pid,
          ppid,
          pcpuPct: Number.isFinite(pcpuPct) ? pcpuPct : 0,
          rssBytes: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
          cpuTimeSeconds: parseCpuTimeSeconds(match[5]),
          command: match[6] || "",
        };
      })
      .filter((row) => row && Number.isFinite(row.pid) && Number.isFinite(row.ppid));
    return { rows, source: "ps" };
  } catch (err) {
    return { rows: [], source: "ps", error: err.message };
  }
}

function readWindowsProcessTable() {
  try {
    const script = [
      "$ErrorActionPreference='SilentlyContinue';",
      "Get-CimInstance Win32_Process |",
      "Select-Object ProcessId,ParentProcessId,WorkingSetSize,UserModeTime,KernelModeTime,ReadTransferCount,WriteTransferCount,Name |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const out = execSync(`powershell -NoProfile -Command ${JSON.stringify(script)}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3000,
    }).trim();
    const parsed = out ? JSON.parse(out) : [];
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const rows = list
      .map((row) => {
        const pid = Number(row.ProcessId);
        const ppid = Number(row.ParentProcessId);
        const user = Number(row.UserModeTime);
        const kernel = Number(row.KernelModeTime);
        return {
          pid,
          ppid,
          pcpuPct: 0,
          rssBytes: Number(row.WorkingSetSize) || 0,
          cpuTimeSeconds: Number.isFinite(user) && Number.isFinite(kernel) ? (user + kernel) / 10_000_000 : null,
          diskReadBytes: Number(row.ReadTransferCount),
          diskWriteBytes: Number(row.WriteTransferCount),
          command: row.Name || "",
        };
      })
      .filter((row) => Number.isFinite(row.pid) && Number.isFinite(row.ppid));
    return { rows, source: "powershell-cim" };
  } catch (err) {
    return { rows: [], source: "powershell-cim", error: err.message };
  }
}

function readProcessTable() {
  if (process.platform === "win32") return readWindowsProcessTable();
  return readUnixProcessTable();
}

function collectProcessTreeRows(rows, rootPid) {
  const root = Number(rootPid);
  if (!Number.isFinite(root) || root <= 0) return [];
  const byPid = new Map();
  const children = new Map();
  for (const row of rows || []) {
    byPid.set(row.pid, row);
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const found = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const row = byPid.get(pid);
    if (row) found.push(row);
    for (const child of children.get(pid) || []) {
      stack.push(child);
    }
  }
  return found;
}

function readLinuxProcessIo(pid) {
  if (process.platform !== "linux") return null;
  try {
    const text = fs.readFileSync(`/proc/${pid}/io`, "utf8");
    const readMatch = text.match(/^read_bytes:\s+(\d+)/m);
    const writeMatch = text.match(/^write_bytes:\s+(\d+)/m);
    return {
      readBytes: readMatch ? Number(readMatch[1]) : null,
      writeBytes: writeMatch ? Number(writeMatch[1]) : null,
      source: "procfs",
    };
  } catch {
    return null;
  }
}

function readProcessIoTotals(rows) {
  let readBytes = 0;
  let writeBytes = 0;
  let count = 0;
  let source = null;
  for (const row of rows || []) {
    let io = null;
    if (Number.isFinite(row.diskReadBytes) || Number.isFinite(row.diskWriteBytes)) {
      io = {
        readBytes: Number(row.diskReadBytes),
        writeBytes: Number(row.diskWriteBytes),
        source: "powershell-cim",
      };
    } else {
      io = readLinuxProcessIo(row.pid);
    }
    if (!io) continue;
    if (Number.isFinite(io.readBytes)) readBytes += io.readBytes;
    if (Number.isFinite(io.writeBytes)) writeBytes += io.writeBytes;
    source = io.source;
    count += 1;
  }
  if (!count) {
    const unsupported = process.platform === "darwin" ? "unsupported-macos" : "unsupported";
    return { readBytes: null, writeBytes: null, source: unsupported };
  }
  return { readBytes, writeBytes, source };
}

function readNetworkCounters() {
  try {
    if (process.platform === "linux") {
      const text = fs.readFileSync("/proc/net/dev", "utf8");
      let rxBytes = 0;
      let txBytes = 0;
      for (const line of text.split("\n").slice(2)) {
        const [ifaceRaw, restRaw] = line.split(":");
        if (!restRaw) continue;
        const iface = ifaceRaw.trim();
        if (!iface || iface === "lo") continue;
        const parts = restRaw.trim().split(/\s+/).map((part) => Number(part));
        if (Number.isFinite(parts[0])) rxBytes += parts[0];
        if (Number.isFinite(parts[8])) txBytes += parts[8];
      }
      return { rxBytes, txBytes, source: "procfs" };
    }
    if (process.platform === "darwin") {
      const out = execSync("netstat -ibn", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1800,
      });
      const byInterface = new Map();
      for (const line of out.split("\n").slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const iface = parts[0];
        if (!iface || iface === "lo0") continue;
        const rx = Number(parts[6]);
        const tx = Number(parts[9]);
        if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
        const prev = byInterface.get(iface) || { rxBytes: 0, txBytes: 0 };
        byInterface.set(iface, {
          rxBytes: Math.max(prev.rxBytes, rx),
          txBytes: Math.max(prev.txBytes, tx),
        });
      }
      let rxBytes = 0;
      let txBytes = 0;
      for (const row of byInterface.values()) {
        rxBytes += row.rxBytes;
        txBytes += row.txBytes;
      }
      return { rxBytes, txBytes, source: "netstat" };
    }
    if (process.platform === "win32") {
      const script = [
        "$ErrorActionPreference='SilentlyContinue';",
        "Get-NetAdapterStatistics |",
        "Select-Object ReceivedBytes,SentBytes |",
        "ConvertTo-Json -Compress",
      ].join(" ");
      const out = execSync(`powershell -NoProfile -Command ${JSON.stringify(script)}`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2500,
      }).trim();
      const parsed = out ? JSON.parse(out) : [];
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return {
        rxBytes: list.reduce((sum, row) => sum + (Number(row.ReceivedBytes) || 0), 0),
        txBytes: list.reduce((sum, row) => sum + (Number(row.SentBytes) || 0), 0),
        source: "powershell-netadapter",
      };
    }
  } catch {
    return null;
  }
  return null;
}

function bytesToMiB(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Number((n / (1024 * 1024)).toFixed(2)) : null;
}

function buildProcessResourceSnapshot(rootPid, state = {}) {
  const table = readProcessTable();
  const nowMs = Date.now();
  const rows = collectProcessTreeRows(table.rows, rootPid);
  const cpuCount = os.cpus()?.length || 1;
  const currentCpuTimes = new Map();
  let cpuPct = 0;
  let deltaCount = 0;
  const elapsedSec = state.previousProcessSampleMs
    ? Math.max(0, (nowMs - state.previousProcessSampleMs) / 1000)
    : 0;

  for (const row of rows) {
    if (Number.isFinite(row.cpuTimeSeconds)) {
      currentCpuTimes.set(row.pid, row.cpuTimeSeconds);
      const prev = state.previousCpuTimes?.get(row.pid);
      if (Number.isFinite(prev) && row.cpuTimeSeconds >= prev && elapsedSec > 0) {
        cpuPct += ((row.cpuTimeSeconds - prev) / elapsedSec) * 100;
        deltaCount += 1;
      }
    }
  }
  if (!deltaCount) {
    cpuPct = rows.reduce((sum, row) => sum + (Number(row.pcpuPct) || 0), 0);
  }

  state.previousCpuTimes = currentCpuTimes;
  state.previousProcessSampleMs = nowMs;

  const rssBytes = rows.reduce((sum, row) => sum + (Number(row.rssBytes) || 0), 0);
  const io = readProcessIoTotals(rows);
  if (io.readBytes != null && state.diskReadStart == null) state.diskReadStart = io.readBytes;
  if (io.writeBytes != null && state.diskWriteStart == null) state.diskWriteStart = io.writeBytes;
  const diskReadDelta = io.readBytes != null && state.diskReadStart != null
    ? Math.max(0, io.readBytes - state.diskReadStart)
    : null;
  const diskWriteDelta = io.writeBytes != null && state.diskWriteStart != null
    ? Math.max(0, io.writeBytes - state.diskWriteStart)
    : null;

  if (!state.networkStart) state.networkStart = readNetworkCounters();
  const networkNow = readNetworkCounters();
  const networkRxDelta = state.networkStart && networkNow
    ? Math.max(0, networkNow.rxBytes - state.networkStart.rxBytes)
    : null;
  const networkTxDelta = state.networkStart && networkNow
    ? Math.max(0, networkNow.txBytes - state.networkStart.txBytes)
    : null;

  const pids = rows.map((row) => row.pid);
  const gpuProcess = probeGpuProcessStats(pids);
  const top = rows
    .slice()
    .sort((a, b) => (Number(b.rssBytes) || 0) - (Number(a.rssBytes) || 0))
    .slice(0, 5)
    .map((row) => ({
      pid: row.pid,
      cpu_pct: Number((Number(row.pcpuPct) || 0).toFixed(2)),
      rss_bytes: row.rssBytes,
      command: String(row.command || "").slice(0, 120),
    }));

  return {
    root_pid: Number(rootPid) || null,
    active: rows.length > 0,
    pids,
    process_count: rows.length,
    cpu_pct: Number(Math.max(0, cpuPct).toFixed(2)),
    cpu_total_pct: Number(Math.max(0, Math.min(100, cpuPct / cpuCount)).toFixed(2)),
    rss_bytes: rssBytes,
    rss_mb: bytesToMiB(rssBytes),
    disk_read_bytes: diskReadDelta,
    disk_write_bytes: diskWriteDelta,
    network_rx_bytes: networkRxDelta,
    network_tx_bytes: networkTxDelta,
    gpu: gpuProcess,
    top,
    sources: {
      process: table.source,
      disk: io.source,
      network: networkNow?.source ? `system_delta:${networkNow.source}` : "unsupported",
      cpu: deltaCount ? "cpu_time_delta" : "ps_percent",
      gpu_process: gpuProcess?.source || "unsupported",
    },
    error: table.error || null,
  };
}

function startSystemSampler(runDir, intervalMs = 1000, options = {}) {
  if (typeof intervalMs === "object" && intervalMs !== null) {
    options = intervalMs;
    intervalMs = Number(options.intervalMs) || 1000;
  }
  const file = path.join(runDir, "system.jsonl");
  fs.writeFileSync(file, "");
  const cwd = options.cwd || process.cwd();
  let rootPid = Number(options.rootPid) || null;
  let timer = null;
  let stopped = false;
  let seq = 0;
  let missedSamples = 0;
  let errorCount = 0;
  let lastStartMs = 0;
  const processState = {
    previousCpuTimes: new Map(),
    previousProcessSampleMs: 0,
    networkStart: readNetworkCounters(),
  };
  const agg = {
    samples: 0,
    gpu_present: false,
    gpu_count: 0,
    gpu_util_max_pct: 0,
    gpu_util_sum_pct: 0,
    gpu_memory_peak_mb: 0,
    gpu_memory_total_mb: 0,
  };
  const processAgg = {
    samples: 0,
    root_pid: rootPid,
    process_count_peak: 0,
    process_cpu_max_pct: null,
    process_cpu_sum_pct: 0,
    process_cpu_total_max_pct: null,
    process_memory_peak_bytes: null,
    process_memory_sum_bytes: 0,
    process_disk_read_bytes: null,
    process_disk_write_bytes: null,
    process_gpu_memory_peak_mb: null,
    system_network_rx_bytes: null,
    system_network_tx_bytes: null,
    sample_collect_max_ms: 0,
    sample_drift_max_ms: 0,
    source: "process-tree",
    disk_source: null,
    network_source: null,
    process_source: null,
    last_error: null,
  };
  const sample = () => {
    const startedMs = Date.now();
    let driftMs = 0;
    if (lastStartMs > 0) {
      driftMs = startedMs - lastStartMs - intervalMs;
      if (driftMs > intervalMs * 0.8) {
        missedSamples += Math.max(1, Math.floor(driftMs / intervalMs));
      }
    }
    lastStartMs = startedMs;
    let row;
    try {
      const load = os.loadavg();
      const gpus = probeGpuStats();
      const processSnapshot = rootPid ? buildProcessResourceSnapshot(rootPid, processState) : null;
      const finishedMs = Date.now();
      seq += 1;
      row = {
        ts: new Date(startedMs).toISOString(),
        load_avg_1m: load[0],
        load_avg_5m: load[1],
        load_avg_15m: load[2],
        mem_total_bytes: os.totalmem(),
        mem_free_bytes: os.freemem(),
        gpus: gpus || null,
        process: processSnapshot,
        sample: {
          seq,
          interval_ms: intervalMs,
          collect_ms: finishedMs - startedMs,
          drift_ms: Number(driftMs.toFixed(2)),
          missed_samples: missedSamples,
          error_count: errorCount,
          cwd,
        },
      };
      if (gpus) {
        agg.gpu_present = true;
        agg.gpu_count = Math.max(agg.gpu_count, gpus.length);
        let sampleMax = 0;
        let sampleSum = 0;
        let sampleMemPeak = 0;
        let sampleMemTotal = 0;
        for (const g of gpus) {
          if (Number.isFinite(g.util_pct)) {
            sampleMax = Math.max(sampleMax, g.util_pct);
            sampleSum += g.util_pct;
          }
          if (Number.isFinite(g.mem_used_mb)) {
            sampleMemPeak = Math.max(sampleMemPeak, g.mem_used_mb);
          }
          if (Number.isFinite(g.mem_total_mb)) {
            sampleMemTotal = Math.max(sampleMemTotal, g.mem_total_mb);
          }
        }
        agg.gpu_util_max_pct = Math.max(agg.gpu_util_max_pct, sampleMax);
        agg.gpu_util_sum_pct += sampleSum / Math.max(1, gpus.length);
        agg.gpu_memory_peak_mb = Math.max(agg.gpu_memory_peak_mb, sampleMemPeak);
        agg.gpu_memory_total_mb = Math.max(agg.gpu_memory_total_mb, sampleMemTotal);
      }
      agg.samples += 1;
      if (processSnapshot?.active) {
        processAgg.samples += 1;
        processAgg.root_pid = rootPid;
        processAgg.process_count_peak = Math.max(processAgg.process_count_peak, processSnapshot.process_count || 0);
        processAgg.process_cpu_max_pct = Math.max(processAgg.process_cpu_max_pct ?? 0, processSnapshot.cpu_pct || 0);
        processAgg.process_cpu_sum_pct += processSnapshot.cpu_pct || 0;
        processAgg.process_cpu_total_max_pct = Math.max(processAgg.process_cpu_total_max_pct ?? 0, processSnapshot.cpu_total_pct || 0);
        processAgg.process_memory_peak_bytes = Math.max(processAgg.process_memory_peak_bytes ?? 0, processSnapshot.rss_bytes || 0);
        processAgg.process_memory_sum_bytes += processSnapshot.rss_bytes || 0;
        if (processSnapshot.disk_read_bytes != null) {
          processAgg.process_disk_read_bytes = Math.max(processAgg.process_disk_read_bytes ?? 0, processSnapshot.disk_read_bytes);
        }
        if (processSnapshot.disk_write_bytes != null) {
          processAgg.process_disk_write_bytes = Math.max(processAgg.process_disk_write_bytes ?? 0, processSnapshot.disk_write_bytes);
        }
        if (processSnapshot.network_rx_bytes != null) {
          processAgg.system_network_rx_bytes = Math.max(processAgg.system_network_rx_bytes ?? 0, processSnapshot.network_rx_bytes);
        }
        if (processSnapshot.network_tx_bytes != null) {
          processAgg.system_network_tx_bytes = Math.max(processAgg.system_network_tx_bytes ?? 0, processSnapshot.network_tx_bytes);
        }
        if (processSnapshot.gpu?.process_gpu_memory_mb != null) {
          processAgg.process_gpu_memory_peak_mb = Math.max(
            processAgg.process_gpu_memory_peak_mb ?? 0,
            processSnapshot.gpu.process_gpu_memory_mb,
          );
        }
        processAgg.sample_collect_max_ms = Math.max(processAgg.sample_collect_max_ms, row.sample.collect_ms);
        processAgg.sample_drift_max_ms = Math.max(processAgg.sample_drift_max_ms, Number(row.sample.drift_ms) || 0);
        processAgg.disk_source = processSnapshot.sources?.disk || processAgg.disk_source;
        processAgg.network_source = processSnapshot.sources?.network || processAgg.network_source;
        processAgg.process_source = processSnapshot.sources?.process || processAgg.process_source;
        processAgg.last_error = processSnapshot.error || null;
      }
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    } catch (err) {
      errorCount += 1;
      processAgg.last_error = err.message;
      try {
        fs.appendFileSync(file, `${JSON.stringify({
          ts: new Date(startedMs).toISOString(),
          process: rootPid ? { root_pid: rootPid, active: false, error: err.message } : null,
          sample: {
            seq: seq + 1,
            interval_ms: intervalMs,
            collect_ms: Date.now() - startedMs,
            drift_ms: Number(driftMs.toFixed(2)),
            missed_samples: missedSamples,
            error_count: errorCount,
            cwd,
          },
        })}\n`);
        seq += 1;
      } catch {
        // run dir may have been removed mid-sample; ignore
      }
    }
  };
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      sample();
      schedule();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  };
  sample();
  schedule();
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  stop.bindPid = (pid) => {
    const numeric = Number(pid);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    rootPid = numeric;
    processAgg.root_pid = numeric;
    sample();
  };
  stop.getAggregates = () => {
    const meanUtil = agg.samples > 0 && agg.gpu_present
      ? Number((agg.gpu_util_sum_pct / agg.samples).toFixed(2))
      : null;
    const processCpuMean = processAgg.samples > 0
      ? Number((processAgg.process_cpu_sum_pct / processAgg.samples).toFixed(2))
      : null;
    const processMemoryMeanBytes = processAgg.samples > 0
      ? Math.round(processAgg.process_memory_sum_bytes / processAgg.samples)
      : null;
    const resourceProfile = {
      source: processAgg.source,
      samples: processAgg.samples,
      sampler_interval_ms: intervalMs,
      root_pid: processAgg.root_pid || null,
      process_count_peak: processAgg.process_count_peak || null,
      process_cpu_max_pct: processAgg.process_cpu_max_pct,
      process_cpu_mean_pct: processCpuMean,
      process_cpu_total_max_pct: processAgg.process_cpu_total_max_pct,
      process_memory_peak_bytes: processAgg.process_memory_peak_bytes,
      process_memory_peak_mb: bytesToMiB(processAgg.process_memory_peak_bytes),
      process_memory_mean_bytes: processMemoryMeanBytes,
      process_memory_mean_mb: bytesToMiB(processMemoryMeanBytes),
      process_disk_read_bytes: processAgg.process_disk_read_bytes,
      process_disk_write_bytes: processAgg.process_disk_write_bytes,
      process_disk_read_mb: bytesToMiB(processAgg.process_disk_read_bytes),
      process_disk_write_mb: bytesToMiB(processAgg.process_disk_write_bytes),
      process_gpu_memory_peak_mb: processAgg.process_gpu_memory_peak_mb,
      system_network_rx_bytes: processAgg.system_network_rx_bytes,
      system_network_tx_bytes: processAgg.system_network_tx_bytes,
      system_network_rx_mb: bytesToMiB(processAgg.system_network_rx_bytes),
      system_network_tx_mb: bytesToMiB(processAgg.system_network_tx_bytes),
      disk_source: processAgg.disk_source,
      network_source: processAgg.network_source,
      process_source: processAgg.process_source,
      sample_collect_max_ms: processAgg.sample_collect_max_ms,
      sample_drift_max_ms: processAgg.sample_drift_max_ms,
      missed_samples: missedSamples,
      error_count: errorCount,
      last_error: processAgg.last_error,
    };
    return {
      gpu_present: agg.gpu_present,
      gpu_count: agg.gpu_count || null,
      gpu_util_max_pct: agg.gpu_present ? agg.gpu_util_max_pct : null,
      gpu_util_mean_pct: meanUtil,
      gpu_memory_peak_mb: agg.gpu_present ? agg.gpu_memory_peak_mb : null,
      gpu_memory_total_mb: agg.gpu_present ? agg.gpu_memory_total_mb || null : null,
      resource_profile: resourceProfile,
      process_cpu_max_pct: resourceProfile.process_cpu_max_pct,
      process_cpu_mean_pct: resourceProfile.process_cpu_mean_pct,
      process_cpu_total_max_pct: resourceProfile.process_cpu_total_max_pct,
      process_memory_peak_mb: resourceProfile.process_memory_peak_mb,
      process_memory_mean_mb: resourceProfile.process_memory_mean_mb,
      process_disk_read_mb: resourceProfile.process_disk_read_mb,
      process_disk_write_mb: resourceProfile.process_disk_write_mb,
      system_network_rx_mb: resourceProfile.system_network_rx_mb,
      system_network_tx_mb: resourceProfile.system_network_tx_mb,
    };
  };
  return stop;
}

function writeArtifactManifest(runDir) {
  const entries = fs.readdirSync(runDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === "MANIFEST.json") continue;
    const fullPath = path.join(runDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    let sha256 = null;
    try {
      const buf = fs.readFileSync(fullPath);
      sha256 = createHash("sha256").update(buf).digest("hex");
    } catch {
      sha256 = null;
    }
    files.push({
      path: entry.name,
      size_bytes: stat.size,
      sha256,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = {
    generated_at: new Date().toISOString(),
    files,
  };
  fs.writeFileSync(path.join(runDir, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function spawnCommand(commandText, cwd, timeoutMs, logFile, timeoutReason = "timeout", childEnv = process.env, opts = {}) {
  const { onLine = null, echoOutput = true, onSpawn = null } = opts;
  return new Promise((resolve) => {
    // detached:true puts the shell into its own process group so we can signal
    // the whole group (shell + any grandchildren like `sleep`). Without this,
    // killing the shell leaves grandchildren holding the stdout pipe and
    // child.on('close') never fires.
    const child = spawn(commandText, { cwd, shell: true, env: childEnv, detached: true });
    if (typeof onSpawn === "function") {
      try {
        onSpawn(child);
      } catch {
        // Sampler hooks are best-effort; command execution must continue.
      }
    }
    const chunks = [];
    let timedOut = false;
    let killedByRule = null;
    let stdoutBuf = "";
    let stderrBuf = "";
    const logStream = fs.createWriteStream(logFile);
    const killGroup = (signal) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* gone */ }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGKILL");
    }, timeoutMs);
    const requestKill = (reason) => {
      if (killedByRule || timedOut) return;
      killedByRule = reason;
      killGroup("SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) killGroup("SIGKILL");
      }, 2000);
    };
    const handleLine = (line) => {
      if (!onLine || !line) return;
      const verdict = onLine(line);
      if (verdict && typeof verdict === "object" && verdict.kill) {
        requestKill(verdict.kill);
      }
    };
    const drainBuffer = (buf, stream) => {
      const text = stream === "out" ? stdoutBuf : stderrBuf;
      const updated = text + buf;
      const lines = updated.split(/\r?\n/);
      const remainder = lines.pop();
      for (const line of lines) handleLine(line);
      if (stream === "out") stdoutBuf = remainder;
      else stderrBuf = remainder;
    };
    child.stdout.on("data", (data) => {
      chunks.push(data);
      if (echoOutput) process.stdout.write(data);
      logStream.write(data);
      drainBuffer(data.toString("utf8"), "out");
    });
    child.stderr.on("data", (data) => {
      chunks.push(data);
      if (echoOutput) process.stderr.write(data);
      logStream.write(data);
      drainBuffer(data.toString("utf8"), "err");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      const message = `\nautoresearch: spawn error: ${err.message}\n`;
      logStream.end(message);
      resolve({
        output: Buffer.concat(chunks).toString("utf8") + message,
        exitCode: null,
        timedOut,
        spawnError: err.message,
        killedByRule,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutBuf) { handleLine(stdoutBuf); stdoutBuf = ""; }
      if (stderrBuf) { handleLine(stderrBuf); stderrBuf = ""; }
      logStream.end();
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: code,
        timedOut,
        timedOutBy: timedOut ? timeoutReason : null,
        spawnError: null,
        killedByRule,
      });
    });
  });
}

function replaceOrAppendSection(text, heading, body) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^## ${escaped}\\s+)([\\s\\S]*?)(?=\\n## |\\n# |$)`, "mi");
  if (pattern.test(text)) {
    return text.replace(pattern, `$1${body}\n`);
  }
  const suffix = text.endsWith("\n") ? "" : "\n";
  return `${text}${suffix}\n## ${heading}\n${body}\n`;
}

function updateGoalCurrentBest(cwd, metricName, value, runId) {
  const goalFile = path.join(cwd, ".researchloop", "goal.md");
  if (!fs.existsSync(goalFile)) {
    return;
  }
  const raw = fs.readFileSync(goalFile, "utf8");
  const body = `${metricName} = ${value} (run ${runId})`;
  fs.writeFileSync(goalFile, replaceOrAppendSection(raw, "Current Best", body));
}

function updatePlanBaseline(cwd, metricName, value, runId) {
  const planFile = path.join(cwd, ".researchloop", "plan.md");
  if (!fs.existsSync(planFile)) {
    return;
  }
  const raw = fs.readFileSync(planFile, "utf8");
  const body = [
    `- Baseline: ${metricName} = ${value} (run ${runId})`,
    "- Best valid result: same as baseline",
    "- Active family: none",
    "- Running jobs: none",
    "- Next action: design first experiment",
  ].join("\n");
  fs.writeFileSync(planFile, replaceOrAppendSection(raw, "Current State", body));
}

function readGoalFields(cwd) {
  const goalFile = path.join(cwd, ".researchloop", "goal.md");
  const raw = readTextIfExists(goalFile);
  return {
    goal: parseMarkdownSection(raw, "Goal") || "",
    metric: parseMarkdownSection(raw, "Target Metric") || "",
    direction: parseMarkdownSection(raw, "Direction") || "",
    baseline: parseMarkdownSection(raw, "Baseline Command") || "",
    evaluation: parseMarkdownSection(raw, "Evaluation Command") || "",
  };
}

async function executeRun(opts) {
  const {
    cwd,
    cmdText,
    metricName,
    regexSource,
    timeoutSec,
    allowUnsafe,
    isBaseline,
    idOverride,
    extraConfig = null,
    extraEnv = null,
    suppressGoalUpdate = false,
    suppressExitCode = false,
    enableSystemSampling = true,
    quiet = false,
    tags = null,
    notes = "",
    parentId = null,
  } = opts;
  if (!cmdText || cmdText.toLowerCase() === "unknown") {
    if (!quiet) {
      console.error("No command to run.");
      console.error("Set one via:");
      console.error("  autoresearch goal \"<text>\" --baseline \"python train.py\" --evaluation \"python eval.py\"");
      console.error("Or pass --command directly.");
    }
    if (!suppressExitCode) process.exitCode = 1;
    return { ok: false, status: "no_command" };
  }

  const safetyPolicy = loadSafetyPolicy(cwd);
  const safetyCheck = evaluateCommandSafety(cmdText, safetyPolicy);
  if (!allowUnsafe && !safetyCheck.allowed) {
    if (!quiet) {
      console.error("autoresearch safety: blocked command before execution");
      console.error(`rule: ${safetyCheck.rule}`);
      console.error(`reason: ${safetyCheck.message}`);
    }
    if (!suppressExitCode) process.exitCode = 1;
    return { ok: false, status: "blocked", safety: safetyCheck };
  }
  if (allowUnsafe && !quiet) {
    console.error("WARNING: --allow-unsafe bypasses command safety checks. This command will run unsafely.");
  }

  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 600000;
  const prefix = isBaseline ? "baseline" : "run";
  const id = String(idOverride || `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", id);
  ensureDir(runDir);
  const logFile = path.join(runDir, "log.txt");
  const env = captureEnv(cwd);
  const goalFields = readGoalFields(cwd);
  const dataFingerprint = computeDataFingerprint(cwd, goalFields.data_globs);
  const effectiveTimeoutMs = allowUnsafe || !Number.isFinite(safetyCheck.maxMs)
    ? timeoutMs
    : Math.min(timeoutMs, safetyCheck.maxMs);
  const timeoutReason = !allowUnsafe && Number.isFinite(safetyCheck.maxMs) && safetyCheck.maxMs < timeoutMs
    ? "safety"
    : "timeout";

  writeArtifactEnvJson(runDir, env);
  writeArtifactCodeDiff(runDir, cwd);
  writeArtifactConfigJson(runDir, {
    run_id: id,
    autoresearch_command: prefix,
    is_baseline: isBaseline,
    inner_command: cmdText,
    metric: metricName,
    metric_regex: regexSource,
    timeout_ms: effectiveTimeoutMs,
    timeout_reason: timeoutReason,
    allow_unsafe: allowUnsafe,
    safety_max_minutes_per_run: safetyPolicy.maxMinutesPerRun ?? null,
    ...(extraConfig || {}),
  });

  if (!quiet) {
    console.log(`autoresearch ${prefix}`);
    console.log(`command: ${cmdText}`);
    console.log(`metric: ${metricName}`);
    console.log(`timeout: ${effectiveTimeoutMs / 1000}s`);
    if (!allowUnsafe && timeoutReason === "safety") {
      console.log(`safety: max_minutes_per_run=${safetyPolicy.maxMinutesPerRun}`);
    }
    console.log(`log: ${path.relative(cwd, logFile)}`);
    console.log("---");
  }

  const stopSampler = enableSystemSampling ? startSystemSampler(runDir, 1000, { cwd }) : () => ({});
  const childEnv = { ...process.env, RESEARCHLOOP_RUN_DIR: runDir, ...(extraEnv || {}) };
  const startedAt = new Date().toISOString();

  // Streaming metric pipeline (G06 minimal): line-by-line parse, push to
  // metrics.jsonl live, evaluate early_stop (G11) per sample.
  const evalConfig = loadEvalConfig(cwd);
  let lastCheckpoint = null;
  const refreshLastCheckpoint = () => {
    if (!evalConfig.checkpointGlob) return null;
    const hit = findNewestCheckpoint(cwd, evalConfig.checkpointGlob);
    if (hit) lastCheckpoint = hit;
    return hit;
  };
  const liveMetricsPath = path.join(runDir, "metrics.jsonl");
  fs.writeFileSync(liveMetricsPath, "");
  const liveStream = fs.createWriteStream(liveMetricsPath, { flags: "a" });
  const streamedSeries = [];
  const baselineByMetric = {};
  for (const rule of evalConfig.earlyStop) {
    const m = rule.metric || metricName;
    if (!(m in baselineByMetric)) {
      baselineByMetric[m] = readBaselineMetricValue(cwd, m);
    }
  }
  const numericRegex = regexSource
    ? new RegExp(regexSource, "i")
    : new RegExp(defaultMetricRegex(metricName).source, "i");
  // Companion regex that *also* matches non-finite tokens (nan / inf / -inf)
  // so early_stop:nan_or_inf can fire on training output like "train_loss=nan".
  const escapedMetric = metricName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nonFiniteRegex = new RegExp(
    `["']?${escapedMetric}["']?\\s*[:=]\\s*["']?([+\\-]?(?:nan|inf|infinity))\\b`,
    "i",
  );

  const onLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line) return null;
    let raw = null;
    const numMatch = line.match(numericRegex);
    if (numMatch) {
      raw = numMatch[1] !== undefined ? numMatch[1] : numMatch[0];
    } else {
      const nfMatch = line.match(nonFiniteRegex);
      if (nfMatch) raw = nfMatch[1];
    }
    if (raw === null) return null;
    let value;
    const lower = String(raw).toLowerCase();
    if (lower === "nan" || lower === "+nan" || lower === "-nan") {
      value = NaN;
    } else if (lower === "inf" || lower === "+inf" || lower === "infinity" || lower === "+infinity") {
      value = Infinity;
    } else if (lower === "-inf" || lower === "-infinity") {
      value = -Infinity;
    } else {
      value = Number(raw);
    }
    const step = streamedSeries.length + 1;
    streamedSeries.push(value);
    refreshLastCheckpoint();
    try {
      liveStream.write(`${JSON.stringify({ metric: metricName, step, value: Number.isFinite(value) ? value : null, raw })}\n`);
    } catch { /* best-effort */ }
    if (evalConfig.earlyStop.length > 0) {
      const reason = evaluateEarlyStopRules(
        evalConfig.earlyStop,
        metricName,
        value,
        step,
        baselineByMetric,
      );
      if (reason) return { kill: reason };
    }
    return null;
  };

  let result;
  try {
    result = await spawnCommand(cmdText, cwd, effectiveTimeoutMs, logFile, timeoutReason, childEnv, {
      onLine,
      onSpawn(child) {
        if (stopSampler.bindPid) stopSampler.bindPid(child.pid);
      },
      echoOutput: !quiet,
    });
  } finally {
    stopSampler();
    try { liveStream.end(); } catch { /* ignore */ }
  }
  const gpuAgg = (stopSampler.getAggregates && stopSampler.getAggregates()) || {};
  const finishedAt = new Date().toISOString();
  refreshLastCheckpoint();

  let status;
  let killReason = null;
  if (result.spawnError) {
    status = "spawn_error";
  } else if (result.killedByRule) {
    status = "killed_by_rule";
    killReason = result.killedByRule;
  } else if (result.timedOut && result.timedOutBy === "safety") {
    status = "killed_by_safety";
  } else if (result.timedOut) {
    status = "timeout";
  } else if (result.exitCode !== 0) {
    status = "failed";
  } else {
    status = "complete";
  }

  const metrics = extractMetricsFromOutput(result.output, metricName, regexSource);
  // Prefer streamed series for both the final value and the history — it's the
  // ground truth the early-stop loop already saw. Fall back to post-hoc parsing
  // if streaming caught nothing (e.g. stdout buffered above the line splitter).
  const finiteStreamed = streamedSeries.filter((v) => Number.isFinite(v));
  let metricValue = finiteStreamed.length ? finiteStreamed[finiteStreamed.length - 1] : null;
  let metricSeries = streamedSeries.slice();
  if (metricValue === null) {
    metricValue = parseMetricFromOutput(result.output, metricName, regexSource);
    metricSeries = extractMetricSeriesFromText(result.output, metricName, regexSource);
  }
  if (metricValue === null && isNumericMetric(metrics[metricName])) {
    metricValue = Number(metrics[metricName]);
  }
  if (metricValue === null) {
    const fallbackMetric = Object.entries(metrics).find(([, value]) => isNumericMetric(value));
    if (fallbackMetric) {
      metricValue = Number(fallbackMetric[1]);
      metrics[metricName] = metricValue;
    }
  }
  if (metricValue !== null) {
    metrics[metricName] = metricValue;
  }
  if (status === "complete" && metricValue === null) {
    status = "complete_no_metric";
  }

  let evalResult = null;
  if (evalConfig.present && Array.isArray(evalConfig.metrics) && evalConfig.metrics.length > 0 && evalConfig.evalCommand) {
    evalResult = await runDeclaredEval({
      cwd,
      runId: id,
      command: evalConfig.evalCommand,
      allowUnsafe,
      quiet: true,
    });
    if (evalResult && evalResult.ok) {
      for (const [key, value] of Object.entries(evalResult.metrics || {})) {
        metrics[key] = value;
      }
      const evalMetricValue = metricNumber(evalResult.metrics?.[metricName]);
      if (metricValue === null && Number.isFinite(evalMetricValue)) {
        metricValue = evalMetricValue;
        metrics[metricName] = metricValue;
        if (status === "complete_no_metric") status = "complete";
      }
    }
  }

  // Promotion gates (G05): apply after the training metric and any declared eval metrics.
  const gateResult = applyPromotionGates(cwd, evalConfig.gates, metrics, metricName);
  if (status === "complete" && gateResult.status) {
    status = gateResult.status;
  }

  const wallSeconds = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
  const gpuHours = gpuAgg.gpu_present ? Number((wallSeconds / 3600).toFixed(4)) : null;
  let estCostUsd = null;
  const costConfigPath = path.join(cwd, ".researchloop", "cost.yaml");
  if (fs.existsSync(costConfigPath)) {
    try {
      const costRaw = fs.readFileSync(costConfigPath, "utf8");
      const hourlyMatch = costRaw.match(/hourly_usd:\s*([0-9.]+)/i);
      if (hourlyMatch && hourlyMatch[1]) {
        estCostUsd = parseFloat((wallSeconds / 3600 * parseFloat(hourlyMatch[1])).toFixed(4));
      }
    } catch { /* skip */ }
  }

  const row = {
    id,
    timestamp: finishedAt,
    started_at: startedAt,
    ended_at: finishedAt,
    wall_seconds: wallSeconds,
    status,
    agent: `autoresearch ${prefix}`,
    command: cmdText,
    exit_code: result.exitCode,
    log: path.relative(cwd, logFile),
    metrics,
    metric_history: metricSeries.length ? { [metricName]: metricSeries } : {},
    notes: String(notes || ""),
    env,
    data_fingerprint: dataFingerprint,
    est_cost_usd: estCostUsd,
    gpu_present: gpuAgg.gpu_present || false,
    gpu_count: gpuAgg.gpu_count || null,
    gpu_util_max_pct: gpuAgg.gpu_util_max_pct ?? null,
    gpu_util_mean_pct: gpuAgg.gpu_util_mean_pct ?? null,
    gpu_memory_peak_mb: gpuAgg.gpu_memory_peak_mb ?? null,
    gpu_memory_total_mb: gpuAgg.gpu_memory_total_mb ?? null,
    gpu_hours: gpuHours,
    resource_profile: gpuAgg.resource_profile || null,
    process_cpu_max_pct: gpuAgg.process_cpu_max_pct ?? null,
    process_cpu_mean_pct: gpuAgg.process_cpu_mean_pct ?? null,
    process_cpu_total_max_pct: gpuAgg.process_cpu_total_max_pct ?? null,
    process_memory_peak_mb: gpuAgg.process_memory_peak_mb ?? null,
    process_memory_mean_mb: gpuAgg.process_memory_mean_mb ?? null,
    process_disk_read_mb: gpuAgg.process_disk_read_mb ?? null,
    process_disk_write_mb: gpuAgg.process_disk_write_mb ?? null,
    system_network_rx_mb: gpuAgg.system_network_rx_mb ?? null,
    system_network_tx_mb: gpuAgg.system_network_tx_mb ?? null,
  };
  if (extraConfig?.sweep || extraConfig?.queue_id) {
    row.sweep = {
      queue_id: extraConfig.queue_id || parentId || null,
      name: extraConfig.sweep || null,
      index: extraConfig.sweep_index ?? null,
      params: extraConfig.sweep_params || {},
    };
  }
  if (extraConfig?.compute_device?.effective) {
    row.compute_device = extraConfig.compute_device.effective;
  }
  if (evalResult && evalResult.ok) {
    row.eval_command = evalResult.command;
    row.eval_log = evalResult.logPath ? path.relative(cwd, evalResult.logPath) : null;
    row.eval_status = evalResult.status;
    if (evalResult.parseWarnings && evalResult.parseWarnings.length) {
      row.parse_warnings = evalResult.parseWarnings.slice();
    }
  } else if (evalResult && evalResult.parseWarnings && evalResult.parseWarnings.length) {
    row.eval_status = evalResult.status;
    row.parse_warnings = evalResult.parseWarnings.slice();
  }
  if (evalConfig.checkpointGlob) {
    row.last_checkpoint = lastCheckpoint ? lastCheckpoint.relative : null;
  }
  if (killReason) row.kill_reason = killReason;
  if (gateResult.reasons.length) row.gate_reasons = gateResult.reasons;
  if (tags) row.tags = tags;
  if (parentId) row.parent_id = parentId;
  // Auto overfit-watch: when both train_loss and val_loss streamed to
  // metrics.jsonl, attach an overfit summary to the row + emit a warning
  // line so the agent doesn't have to know to call `overfit-watch`.
  try {
    const overfit = analyzeOverfit(cwd, id);
    if (overfit && !overfit.error) {
      row.overfit = {
        val_best_step: overfit.val_best_step,
        val_best_value: overfit.val_best_value,
        diverge_step: overfit.diverge_step,
        wasted_fraction: overfit.wasted_fraction,
        still_descending: overfit.still_descending,
      };
    }
  } catch { /* opt-in feature; never block the run */ }
  appendRunRow(cwd, row);
  // metrics.jsonl is now written live during the run; do not clobber it here
  // unless the live stream caught nothing (post-hoc fallback path).
  if (streamedSeries.length === 0 && metricSeries.length > 0) {
    writeArtifactMetricsJsonl(runDir, metricName, metricSeries);
  }
  writeArtifactManifest(runDir);

  const thread = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  ensureDir(path.dirname(thread));
  const metricSuffix = metricValue !== null ? ` ${metricName}=${metricValue}` : "";
  fs.appendFileSync(thread, `- ${finishedAt} ${prefix} ${id} status=${status}${metricSuffix}\n`);

  if (!quiet) {
    console.log("---");
    console.log(`status: ${status}`);
    console.log(`exit_code: ${result.exitCode}`);
    if (killReason) {
      console.log(`kill_reason: ${killReason}`);
    }
    if (metricValue !== null) {
      console.log(`${metricName}: ${metricValue}`);
    } else {
      console.log("metric: not parsed");
    }
    if (evalResult && evalResult.ok) {
      console.log(`eval: ${path.relative(cwd, evalResult.logPath)}`);
      for (const [key, value] of Object.entries(evalResult.metrics || {})) {
        console.log(`eval_metric: ${key}=${value === null ? "null" : value}`);
      }
      for (const warning of evalResult.parseWarnings || []) {
        console.log(`eval_warning: ${warning}`);
      }
    } else if (evalResult && !evalResult.ok && evalResult.parseWarnings && evalResult.parseWarnings.length) {
      for (const warning of evalResult.parseWarnings) {
        console.log(`eval_warning: ${warning}`);
      }
    }
    if (gateResult.reasons.length) {
      for (const r of gateResult.reasons) {
        console.log(`gate: ${r}`);
      }
    }
    if (gpuAgg.gpu_present) {
      const peak = gpuAgg.gpu_memory_peak_mb ?? "?";
      const util = gpuAgg.gpu_util_max_pct ?? "?";
      console.log(`gpu: max_util=${util}% peak_mem=${peak}MB gpu_hours=${gpuHours}`);
    }
    if (evalConfig.checkpointGlob) {
      console.log(`checkpoint: ${row.last_checkpoint || "not found"}`);
    }
    if (row.overfit) {
      if (row.overfit.diverge_step !== null) {
        console.log(`overfit: divergence at step ${row.overfit.diverge_step}; val best @ ${row.overfit.val_best_step} (=${row.overfit.val_best_value.toFixed(6)}); ${(row.overfit.wasted_fraction * 100).toFixed(1)}% of compute spent after the val min`);
      } else if (row.overfit.still_descending) {
        console.log(`overfit: val still descending — more training likely helps`);
      }
    }
    console.log(`recorded: ${id}`);
  }

  if (isBaseline && metricValue !== null && !suppressGoalUpdate) {
    updateGoalCurrentBest(cwd, metricName, metricValue, id);
    updatePlanBaseline(cwd, metricName, metricValue, id);
    if (!quiet) {
      console.log("goal.md Current Best updated.");
      console.log("plan.md Current State updated.");
    }
  }

  if (!suppressExitCode) {
    if (status === "failed" || status === "timeout" || status === "spawn_error") {
      process.exitCode = 1;
    }
    if (status === "killed_by_safety" || status === "killed_by_rule") {
      process.exitCode = 1;
    }
  }
  return { ok: true, id, status, metricValue, metricName, row, gpuAgg, wallSeconds, output: result.output };
}

async function cmdRun(isBaseline) {
  const cwd = targetDir();
  const goalFields = readGoalFields(cwd);
  const explicitCommand = option("--command", null);
  const allowUnsafe = hasFlag("--allow-unsafe");
  let cmdText = explicitCommand && typeof explicitCommand === "string" ? explicitCommand : "";
  if (!cmdText) {
    cmdText = isBaseline
      ? goalFields.baseline
      : (goalFields.evaluation || goalFields.baseline);
  }
  const metricName = String(option("--metric", goalFields.metric || "val_loss")).trim() || "val_loss";
  const customRegex = option("--regex", null);
  const regexSource = customRegex && typeof customRegex === "string" ? customRegex : null;
  const timeoutSec = Number(option("--timeout", 600));
  const seedsRaw = option("--seeds", null);
  const seeds = seedsRaw && typeof seedsRaw === "string" ? parseInt(seedsRaw, 10) : null;
  const cudaVisibleDevicesRaw = option("--cuda-visible-devices", "");
  const computeDevice = inferComputeDevice(String(option("--device", "auto")), null, {
    cudaVisibleDevices: cudaVisibleDevicesRaw && typeof cudaVisibleDevicesRaw === "string"
      ? cudaVisibleDevicesRaw
      : "",
  });
  const tagsText = String(option("--tags", "") || "");
  const tags = tagsText.split(",").map((tag) => tag.trim()).filter(Boolean);
  const notes = String(option("--note", "") || "");

  const enableSystemSampling = !hasFlag("--no-system-sampling");

  if (Number.isFinite(seeds) && seeds > 1 && !isBaseline) {
    await runWithSeeds({
      cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, seeds,
      idBase: option("--id", null),
      direction: String(option("--direction", goalFields.direction || "lower")).toLowerCase(),
      enableSystemSampling,
      computeDevice,
    });
    return;
  }

  const idOverride = option("--id", null);
  await executeRunWithRetries({
    cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, isBaseline,
    idOverride,
    enableSystemSampling,
    extraConfig: { compute_device: computeDevice },
    extraEnv: computeDevice.env,
    tags: tags.length ? tags : null,
    notes,
  });
}

// Run once. On `failed | spawn_error | timeout`, scan the captured output for
// retry rules from eval.yaml (G12), mutate the command (e.g. halve:batch_size),
// re-launch with parent_id pointing at the original, and record `retry_of`.
async function executeRunWithRetries(opts) {
  const cwd = opts.cwd;
  const retryRules = loadEvalRetryRules(cwd);
  const maxRetries = retryRules.length > 0
    ? Math.max(...retryRules.map((r) => Number.isFinite(Number(r.max_retries)) ? Number(r.max_retries) : 2))
    : 0;

  let currentCmd = opts.cmdText;
  let attempt = 0;
  let firstId = null;
  let lastResult = null;
  let parentId = null;

  while (true) {
    const attemptId = attempt === 0
      ? (opts.idOverride || null)
      : `${firstId}-retry${attempt}`;
    const result = await executeRun({
      ...opts,
      cmdText: currentCmd,
      idOverride: attemptId,
      parentId,
      extraConfig: attempt > 0 ? { retry_of: firstId, retry_attempt: attempt } : null,
      suppressExitCode: true,
    });
    lastResult = result;
    if (!result.ok) {
      process.exitCode = 1;
      return result;
    }
    if (attempt === 0) firstId = result.id;
    if (attempt > 0) {
      updateRunRow(cwd, result.id, (row) => {
        row.retry_of = firstId;
        row.retry_attempt = attempt;
        return row;
      });
    }

    const retryableStatus = result.status === "failed"
      || result.status === "spawn_error"
      || result.status === "timeout";

    if (!retryableStatus || attempt >= maxRetries) {
      const finalBad = retryableStatus
        || result.status === "killed_by_safety"
        || result.status === "killed_by_rule";
      if (finalBad) process.exitCode = 1;
      return result;
    }

    const rule = findRetryRule(retryRules, result.output || "");
    if (!rule) {
      if (retryableStatus) process.exitCode = 1;
      return result;
    }
    const transform = applyRetryTransform(currentCmd, rule.transform);
    if (!transform.applied) {
      console.error(`autoresearch retry: matched rule but transform did not apply (${rule.transform})`);
      if (retryableStatus) process.exitCode = 1;
      return result;
    }

    // Mark the failed row with retry_reason so the audit trail is clear.
    updateRunRow(cwd, result.id, (row) => {
      row.retry_reason = `matched ${rule.match}; transform ${rule.transform} -> ${transform.change}`;
      return row;
    });

    console.log("---");
    console.log(`retry: rule matched (${rule.match}) — applying ${rule.transform}`);
    console.log(`change: ${transform.change}`);
    console.log(`next attempt: ${attempt + 1}/${maxRetries}`);
    currentCmd = transform.command;
    parentId = result.id;
    attempt += 1;
  }
}

function applySeedToCommand(cmdText, seed) {
  if (cmdText.includes("{seed}")) {
    return cmdText.replace(/\{seed\}/g, String(seed));
  }
  return cmdText;
}

async function runWithSeeds({ cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, seeds, idBase, direction, enableSystemSampling = true, computeDevice = null }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = idBase && typeof idBase === "string" ? idBase : `run-${stamp}`;
  const seedList = Array.from({ length: seeds }, (_, i) => i);
  const seedRows = [];
  console.log(`autoresearch run --seeds ${seeds}`);
  console.log(`command_template: ${cmdText}`);
  console.log(`metric: ${metricName}`);
  console.log("---");
  for (const seed of seedList) {
    const seedId = `${base}-seed${seed}`;
    const seedCmd = applySeedToCommand(cmdText, seed);
    const childEnv = { ...(computeDevice?.env || {}), RESEARCHLOOP_SEED: String(seed) };
    console.log(`[seed ${seed}] ${seedCmd}`);
    const res = await executeRun({
      cwd, cmdText: seedCmd, metricName, regexSource, timeoutSec, allowUnsafe,
      isBaseline: false,
      idOverride: seedId,
      extraConfig: { seed, parent_run: base, ...(computeDevice ? { compute_device: computeDevice } : {}) },
      extraEnv: childEnv,
      suppressExitCode: true,
      quiet: true,
      tags: ["seed-run"],
      parentId: base,
      enableSystemSampling,
    });
    if (res.ok) {
      seedRows.push(res);
      const m = res.metricValue !== null ? `${metricName}=${res.metricValue}` : "metric=?";
      console.log(`  → ${seedId} status=${res.status} ${m}`);
    } else {
      console.log(`  → ${seedId} skipped (${res.status})`);
    }
  }
  const values = seedRows
    .map((r) => r.metricValue)
    .filter((v) => Number.isFinite(v));
  let mean = null;
  let std = null;
  let minV = null;
  let maxV = null;
  if (values.length > 0) {
    mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    std = Math.sqrt(variance);
    minV = Math.min(...values);
    maxV = Math.max(...values);
  }
  const aggRow = {
    id: base,
    timestamp: new Date().toISOString(),
    status: values.length === seeds ? "complete" : (values.length > 0 ? "complete_partial" : "complete_no_metric"),
    agent: "autoresearch run --seeds",
    command: cmdText,
    metrics: mean !== null
      ? { [metricName]: Number(mean.toFixed(6)), [`${metricName}_std`]: Number(std.toFixed(6)) }
      : {},
    seeds: {
      n: seeds,
      values,
      mean: mean !== null ? Number(mean.toFixed(6)) : null,
      std: std !== null ? Number(std.toFixed(6)) : null,
      min: minV,
      max: maxV,
      direction,
      child_run_ids: seedRows.map((r) => r.id),
    },
    notes: "Aggregator row for seed sweep.",
    tags: ["seed-aggregate"],
  };
  appendRunRow(cwd, aggRow);
  console.log("---");
  console.log(`runs: ${seedRows.length}/${seeds}`);
  if (mean !== null) {
    console.log(`${metricName}: mean=${mean.toFixed(6)} std=${std.toFixed(6)} min=${minV} max=${maxV}`);
  } else {
    console.log(`${metricName}: not parsed across any seed`);
  }
  console.log(`recorded: ${base}`);
  if (values.length === 0) {
    process.exitCode = 1;
  }
}

async function cmdReplay() {
  const cwd = targetDir();
  const runId = String(option("--id", positionalText(["--id", "--metric", "--regex", "--timeout", "--tolerance", "--n", "--replay-id", "--dir"]))).trim();
  if (!runId) {
    console.error("No run id provided.");
    console.error("Usage: autoresearch replay <run-id> [--n 1] [--tolerance 0.01]");
    process.exitCode = 1;
    return;
  }

  const source = readRunRowById(cwd, runId);
  if (!source) {
    console.error(`No run found for id: ${runId}`);
    process.exitCode = 1;
    return;
  }
  if (!source.command) {
    console.error(`Run ${runId} has no recorded command — cannot replay.`);
    process.exitCode = 1;
    return;
  }

  const currentEnv = captureEnv(cwd);
  const metricKeys = source.metrics ? Object.keys(source.metrics).filter((k) => !k.endsWith("_std")) : [];
  const metricName = String(option("--metric", metricKeys[0] || "val_loss")).trim();
  const expectedValue = source.metrics ? metricNumber(source.metrics[metricName]) : Number.NaN;
  if (!Number.isFinite(expectedValue)) {
    console.error(`Run ${runId} has no finite ${metricName} metric; cannot replay against a tolerance.`);
    console.error("Run eval first or choose a metric that exists on the source row.");
    process.exitCode = 1;
    return;
  }
  const toleranceRaw = String(option("--tolerance", "0.01"));
  const tolerance = Number(toleranceRaw);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    console.error("replay: --tolerance must be a non-negative number");
    process.exitCode = 1;
    return;
  }
  const replayCountRaw = Number(String(option("--n", "1")));
  if (!Number.isInteger(replayCountRaw) || replayCountRaw < 1 || replayCountRaw > 20) {
    console.error("replay: --n must be an integer from 1 to 20");
    process.exitCode = 1;
    return;
  }
  const replayCount = replayCountRaw;
  const timeoutSec = Number(option("--timeout", 600));
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error("replay: --timeout must be a positive number of seconds");
    process.exitCode = 1;
    return;
  }
  const allowUnsafe = hasFlag("--allow-unsafe");
  const regexSource = option("--regex", null);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const replayIdBase = String(option("--replay-id", `replay-${runId}-${stamp}`));

  console.log(`replay: ${runId}`);
  console.log(`command: ${source.command}`);
  console.log(`metric: ${metricName}`);
  console.log(`tolerance: ${tolerance}`);
  console.log(`n: ${replayCount}`);

  if (!source.env) {
    console.error("WARNING: replay source run has no env capture.");
  } else {
    const mismatches = envMismatches(source.env, currentEnv);
    for (const mismatch of mismatches) {
      console.error(
        `WARNING: replay env mismatch ${mismatch.field}: stored=${formatEnvValue(mismatch.expected)} current=${formatEnvValue(mismatch.current)}`
      );
    }
  }

  console.log("---");
  console.log("| replay_id | status | metric | expected | actual | delta | within_tolerance |");
  console.log("| --- | --- | --- | --- | --- | --- | --- |");

  let failed = false;
  for (let i = 0; i < replayCount; i += 1) {
    const replayId = replayCount === 1 ? replayIdBase : `${replayIdBase}-${i + 1}`;
    const res = await executeRun({
      cwd,
      cmdText: source.command,
      metricName,
      regexSource: typeof regexSource === "string" ? regexSource : null,
      timeoutSec,
      allowUnsafe,
      isBaseline: false,
      idOverride: replayId,
      extraConfig: { replay_of: runId, replay_index: i + 1, expected_metric: { [metricName]: expectedValue } },
      suppressExitCode: true,
      quiet: true,
      tags: ["replay"],
      parentId: runId,
    });
    if (!res.ok) {
      console.log(`| ${replayId} | ${res.status} | ${metricName} | ${Number.isFinite(expectedValue) ? expectedValue : "null"} | null | null | no |`);
      failed = true;
      continue;
    }
    updateRunRow(cwd, replayId, (row) => {
      row.replay_of = runId;
      row.replay_index = i + 1;
      return row;
    });
    const actual = res.metricValue;
    const delta = Number.isFinite(actual) && Number.isFinite(expectedValue) ? actual - expectedValue : null;
    const within = delta !== null && Math.abs(delta) <= tolerance;
    const statusBad = res.status === "failed" || res.status === "timeout" || res.status === "spawn_error" || res.status === "killed_by_safety" || res.status === "killed_by_rule";
    if (!within || statusBad) failed = true;
    console.log(`| ${replayId} | ${res.status} | ${metricName} | ${Number.isFinite(expectedValue) ? expectedValue : "null"} | ${Number.isFinite(actual) ? actual : "null"} | ${delta === null ? "null" : delta.toFixed(6)} | ${within ? "yes" : "no"} |`);
  }

  if (failed) {
    console.log("replay: drifted");
    process.exitCode = 1;
  } else {
    console.log("replay: reproduced");
  }
  if (source.env) {
    const mismatches = envMismatches(source.env, currentEnv);
    console.log(`env: ${mismatches.length ? "mismatch(" + mismatches.length + ")" : "match"}`);
  } else {
    console.log("env: unknown");
  }
  console.log(`recorded: ${replayIdBase}${replayCount > 1 ? `..${replayCount}` : ""}`);
}

// Rewrite a row in runs.jsonl in place. We never delete from the ledger;
// `promote` just flips status + appends gate_reasons so the audit trail stays.
function updateRunRow(cwd, runId, mutator) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) return false;
  const raw = fs.readFileSync(ledger, "utf8");
  const lines = raw.split("\n");
  let updated = false;
  const next = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const obj = JSON.parse(line);
      if (obj.id === runId) {
        const mutated = mutator(obj);
        updated = true;
        return JSON.stringify(mutated);
      }
      return line;
    } catch {
      return line;
    }
  });
  if (updated) fs.writeFileSync(ledger, next.join("\n"));
  return updated;
}

function copyFileIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

// G19 minimal: run programmatic checks against a row + its artifact bundle.
// Returns { pass, checks: [{name, pass, detail}] } — pass is true iff every
// non-warn check passed. Used by both `autoresearch review` and `promote`
// (unless --skip-review is set).
function runReviewChecks(cwd, row) {
  const checks = [];
  const runId = row?.id || "(unknown)";
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", runId);
  const push = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });

  // 1. Status is healthy.
  const okStatuses = new Set(["complete", "promoted", "kept"]);
  push(
    "status_ok",
    okStatuses.has(row.status),
    `status=${row.status}`,
  );

  // 2. Final primary metric is present and finite.
  const metricNames = Object.keys(row.metrics || {});
  const primary = metricNames[0] || null;
  const primaryValue = primary ? metricNumber(row.metrics[primary]) : NaN;
  push(
    "metric_finite",
    primary !== null && Number.isFinite(primaryValue),
    primary ? `${primary}=${row.metrics[primary]}` : "no metric on row",
  );

  // 3. Env captured (G14) and working tree was clean.
  const env = row.env || {};
  push(
    "env_captured",
    !!env && (env.git_sha || env.python || env.os),
    env.git_sha ? `git_sha=${env.git_sha}` : "no git_sha",
  );
  // Pass when the working tree is clean (git_dirty: false) OR when there's
  // no git context at all (git_dirty: null/undefined). Only an explicit
  // dirty tree (git_dirty: true) fails the check.
  push(
    "git_clean",
    env.git_dirty !== true,
    `git_dirty=${env.git_dirty}`,
  );

  // 4. Streamed metric series is non-trivial.
  const history = row.metric_history && primary ? row.metric_history[primary] : null;
  const historyLen = Array.isArray(history) ? history.length : 0;
  push(
    "curve_present",
    historyLen >= 1,
    `samples=${historyLen}`,
  );

  // 5. Per-run artifact bundle is intact.
  const requiredFiles = ["env.json", "config.json", "MANIFEST.json"];
  const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(runDir, f)));
  push(
    "artifacts_present",
    missing.length === 0,
    missing.length === 0 ? "ok" : `missing: ${missing.join(", ")}`,
  );

  // overfit_clean: warn (not block) if the run started overfitting before
  // its end. Uses the row.overfit block written by executeRun, falling back
  // to a fresh analyzeOverfit on the artifact dir.
  const overfit = row.overfit || (function () {
    try { return analyzeOverfit(cwd, runId); } catch { return null; }
  })();
  if (overfit && !overfit.error) {
    const wasted = overfit.wasted_fraction || 0;
    const diverged = overfit.diverge_step !== null && overfit.diverge_step !== undefined;
    // Only fails when > 25% of compute was post-val-min AND we saw real divergence.
    const overfitFail = diverged && wasted > 0.25;
    push(
      "overfit_clean",
      !overfitFail,
      diverged
        ? `divergence at step ${overfit.diverge_step}; ${(wasted * 100).toFixed(1)}% wasted after val min`
        : "no divergence detected",
    );
  }

  // mfu_reasonable: warn (not block) if compute utilization < 10% — that's
  // dataloader / kernel bottleneck territory and a promoted result built on
  // it likely indicates a hidden inefficiency, not a meaningful win.
  try {
    const mfu = computeMfuForRow(row, {});
    if (mfu && mfu.mfu !== null) {
      const ok = mfu.mfu >= 0.10;
      push(
        "mfu_reasonable",
        ok,
        `MFU = ${(mfu.mfu * 100).toFixed(1)}% (${(mfu.achievedFlopsPerSec / 1e12).toFixed(1)} TFLOP/s vs ${(mfu.peakTflopsSingle * mfu.worldSize).toFixed(0)} TFLOPS peak)`,
      );
    }
  } catch { /* MFU is opt-in; never block when fields are missing */ }

  const pass = checks.every((c) => c.pass);
  return { pass, checks, run_id: runId, primary_metric: primary, primary_value: Number.isFinite(primaryValue) ? primaryValue : null };
}

function renderReviewMarkdown(review) {
  const lines = [];
  lines.push(`# Review: ${review.run_id}`);
  lines.push("");
  lines.push(`- result: ${review.pass ? "**PASS**" : "**FAIL**"}`);
  if (review.primary_metric) {
    lines.push(`- ${review.primary_metric}: ${review.primary_value ?? "null"}`);
  }
  lines.push(`- generated_at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("| Check | Result | Detail |");
  lines.push("| --- | --- | --- |");
  for (const c of review.checks) {
    lines.push(`| ${c.name} | ${c.pass ? "pass" : "FAIL"} | ${c.detail.replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n") + "\n";
}

function cmdReview() {
  const cwd = targetDir();
  const runId = String(option("--id", positionalText(["--id", "--format", "--dir", "--out"]))).trim();
  if (!runId) {
    console.error("autoresearch review: missing --id <run-id>");
    process.exitCode = 1;
    return;
  }
  const row = readRunRowById(cwd, runId);
  if (!row) {
    console.error(`autoresearch review: no run found for id: ${runId}`);
    process.exitCode = 1;
    return;
  }
  const review = runReviewChecks(cwd, row);
  const format = String(option("--format", "text")).toLowerCase();
  if (format === "json") {
    console.log(JSON.stringify(review, null, 2));
  } else if (format === "markdown") {
    console.log(renderReviewMarkdown(review));
  } else {
    console.log(`review: ${review.run_id}`);
    console.log(`result: ${review.pass ? "pass" : "FAIL"}`);
    for (const c of review.checks) {
      console.log(`  ${c.pass ? "ok" : "FAIL"}  ${c.name.padEnd(20)} ${c.detail}`);
    }
  }
  const outPath = option("--out", null);
  if (outPath && typeof outPath === "string") {
    fs.writeFileSync(path.resolve(cwd, outPath), renderReviewMarkdown(review));
    console.log(`wrote: ${outPath}`);
  }
  if (!review.pass) process.exitCode = 1;
}

function cmdPromote() {
  const cwd = targetDir();
  const runId = String(option("--id", positionalText(["--id", "--note", "--dir", "--force", "--skip-review"]))).trim();
  if (!runId) {
    console.error("autoresearch promote: missing --id <run-id>");
    process.exitCode = 1;
    return;
  }
  const note = String(option("--note", "")).trim();
  const force = hasFlag("--force");
  const skipReview = hasFlag("--skip-review");

  const row = readRunRowById(cwd, runId);
  if (!row) {
    console.error(`autoresearch promote: no run found for id: ${runId}`);
    process.exitCode = 1;
    return;
  }

  // Refuse to promote a clearly bad run unless --force.
  const badStatuses = new Set([
    "failed", "timeout", "spawn_error", "killed_by_safety", "killed_by_rule", "discarded",
  ]);
  if (badStatuses.has(row.status) && !force) {
    console.error(`autoresearch promote: run status is "${row.status}". Use --force to promote anyway.`);
    process.exitCode = 1;
    return;
  }

  // G19: run the auto-review unless explicitly skipped. Failed checks block
  // promotion; --force can override but emits a loud warning. --skip-review
  // bypasses the review entirely (also loud).
  let review = null;
  if (skipReview) {
    console.error("WARNING: --skip-review bypasses automated checks. The promoted winner is not vetted.");
  } else {
    review = runReviewChecks(cwd, row);
    if (!review.pass && !force) {
      console.error(`autoresearch promote: review failed for ${runId}. Use --force to promote anyway, or --skip-review to bypass review entirely.`);
      for (const c of review.checks) {
        if (!c.pass) console.error(`  FAIL ${c.name}: ${c.detail}`);
      }
      process.exitCode = 1;
      return;
    }
    if (!review.pass && force) {
      console.error("WARNING: review failed but --force was set; promoting anyway.");
    }
  }

  const winnersDir = path.join(cwd, ".researchloop", "winners", runId);
  ensureDir(winnersDir);
  if (review) {
    fs.writeFileSync(path.join(winnersDir, "review.md"), renderReviewMarkdown(review));
  }

  // Copy the per-run artifact bundle.
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", runId);
  const copied = [];
  for (const name of ["env.json", "code.diff", "config.json", "metrics.jsonl", "system.jsonl", "MANIFEST.json", "log.txt"]) {
    if (copyFileIfExists(path.join(runDir, name), path.join(winnersDir, name))) {
      copied.push(name);
    }
  }

  // Snapshot goal.md and command.
  const goalSrc = path.join(cwd, ".researchloop", "goal.md");
  if (fs.existsSync(goalSrc)) {
    fs.copyFileSync(goalSrc, path.join(winnersDir, "goal.md"));
    copied.push("goal.md");
  }
  fs.writeFileSync(path.join(winnersDir, "command.txt"), `${row.command || ""}\n`);
  copied.push("command.txt");

  // Persist the row.
  const rowFile = path.join(winnersDir, "row.json");
  fs.writeFileSync(rowFile, `${JSON.stringify(row, null, 2)}\n`);
  copied.push("row.json");

  // Append a small README-like marker so the directory is self-describing.
  const promotedAt = new Date().toISOString();
  const summaryLines = [
    `# Winner: ${runId}`,
    "",
    `- promoted_at: ${promotedAt}`,
    `- status_before_promote: ${row.status || "unknown"}`,
    `- command: ${row.command || "(none)"}`,
  ];
  const primaryMetric = row.metrics && Object.keys(row.metrics)[0];
  if (primaryMetric) {
    summaryLines.push(`- ${primaryMetric}: ${row.metrics[primaryMetric]}`);
  }
  if (note) summaryLines.push("", `Note:`, "", note);
  fs.writeFileSync(path.join(winnersDir, "PROMOTION.md"), summaryLines.join("\n") + "\n");
  copied.push("PROMOTION.md");

  // Flip the row status to "promoted" and append a gate_reason about manual promotion.
  const flipped = updateRunRow(cwd, runId, (existing) => {
    const before = existing.status;
    existing.status = "promoted";
    existing.promoted_at = promotedAt;
    if (note) existing.promotion_note = note;
    const reasons = Array.isArray(existing.gate_reasons) ? existing.gate_reasons : [];
    reasons.push(`promoted manually (was: ${before})`);
    existing.gate_reasons = reasons;
    return existing;
  });

  console.log(`promoted: ${runId}`);
  console.log(`winners_dir: ${path.relative(cwd, winnersDir)}`);
  console.log(`files: ${copied.length}`);
  if (!flipped) {
    console.error("WARNING: could not update ledger row status (ledger missing or row not parseable).");
  }
}

async function cmdVerify() {
  const cwd = targetDir();
  const runId = String(option("--id", positionalText())).trim();
  if (!runId) {
    console.error("autoresearch verify: --id <run-id> required");
    process.exitCode = 1;
    return;
  }
  const source = readRunRowById(cwd, runId);
  if (!source) {
    console.error(`No run found for id: ${runId}`);
    process.exitCode = 1;
    return;
  }
  if (!source.command) {
    console.error(`Run ${runId} has no recorded command — cannot verify.`);
    process.exitCode = 1;
    return;
  }
  const metricKeys = source.metrics ? Object.keys(source.metrics).filter((k) => !k.endsWith("_std")) : [];
  const metricName = String(option("--metric", metricKeys[0] || "val_loss")).trim();
  const expectedValue = source.metrics ? metricNumber(source.metrics[metricName]) : Number.NaN;
  if (!Number.isFinite(expectedValue)) {
    console.error(`Run ${runId} has no finite ${metricName} metric; cannot verify against a tolerance.`);
    console.error("Run eval first or choose a metric that exists on the source row.");
    process.exitCode = 1;
    return;
  }
  const tolRaw = option("--tolerance", "0.001");
  const tolerance = Number(String(tolRaw));
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    console.error("verify: --tolerance must be a non-negative number");
    process.exitCode = 1;
    return;
  }
  const allowUnsafe = hasFlag("--allow-unsafe");
  const timeoutSec = Number(option("--timeout", 600));
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    console.error("verify: --timeout must be a positive number of seconds");
    process.exitCode = 1;
    return;
  }
  const regexSource = option("--regex", null);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const verifyId = String(option("--verify-id", `verify-${runId}-${stamp}`));

  console.log(`autoresearch verify`);
  console.log(`source: ${runId}`);
  console.log(`command: ${source.command}`);
  console.log(`expected ${metricName}: ${expectedValue} (tolerance=±${tolerance})`);
  console.log("---");

  const currentEnv = captureEnv(cwd);
  const envWarnings = source.env ? envMismatches(source.env, currentEnv) : [];
  for (const m of envWarnings) {
    console.error(`WARNING: env mismatch ${m.field}: stored=${formatEnvValue(m.expected)} current=${formatEnvValue(m.current)}`);
  }

  const res = await executeRun({
    cwd,
    cmdText: source.command,
    metricName,
    regexSource: typeof regexSource === "string" ? regexSource : null,
    timeoutSec,
    allowUnsafe,
    isBaseline: false,
    idOverride: verifyId,
    extraConfig: { verify_of: runId, expected_metric: { [metricName]: expectedValue } },
    suppressExitCode: true,
    quiet: true,
    tags: ["verify"],
    parentId: runId,
  });

  if (!res.ok) {
    console.log(`status: ${res.status}`);
    process.exitCode = 1;
    return;
  }
  const newValue = res.metricValue;
  const newStatus = res.status;
  console.log(`new ${metricName}: ${newValue === null ? "not parsed" : newValue}`);
  console.log(`new status: ${newStatus}`);
  let determinism = "unknown";
  let delta = null;
  if (Number.isFinite(newValue) && Number.isFinite(expectedValue)) {
    delta = newValue - expectedValue;
    if (Math.abs(delta) <= tolerance) {
      determinism = "deterministic";
    } else {
      determinism = "drifted";
    }
    console.log(`delta: ${delta.toFixed(6)}`);
  }
  console.log(`determinism: ${determinism}`);
  console.log(`env: ${envWarnings.length ? "mismatch(" + envWarnings.length + ")" : "match"}`);
  console.log(`recorded: ${verifyId}`);

  if (determinism === "drifted") {
    process.exitCode = 1;
  }
  if (newStatus === "failed" || newStatus === "timeout" || newStatus === "spawn_error") {
    process.exitCode = 1;
  }
}

function findLatestResumableRun(cwd) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) return null;
  const rows = fs
    .readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const resumable = rows.filter((r) =>
    r && r.command &&
    (r.status === "failed" || r.status === "timeout" || r.status === "killed_by_safety" || r.status === "spawn_error"),
  );
  if (!resumable.length) return null;
  resumable.sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
  return resumable[0];
}

async function cmdResume() {
  const cwd = targetDir();
  const idOpt = option("--id", null);
  const valueFlags = new Set(["--dir", "--id", "--command", "--metric", "--regex", "--timeout", "--resume-id"]);
  let positionalId = null;
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    positionalId = arg;
    break;
  }
  const explicitId = typeof idOpt === "string" ? idOpt : positionalId;
  let source;
  if (explicitId && typeof explicitId === "string") {
    source = readRunRowById(cwd, explicitId);
    if (!source) {
      console.error(`autoresearch resume: no run found for id: ${explicitId}`);
      process.exitCode = 1;
      return;
    }
  } else {
    source = findLatestResumableRun(cwd);
    if (!source) {
      console.error("autoresearch resume: no failed/timeout runs found in the ledger.");
      console.error("Pass --id <run-id> to resume a specific run.");
      process.exitCode = 1;
      return;
    }
  }
  if (!source.command) {
    console.error(`autoresearch resume: source run ${source.id} has no recorded command.`);
    process.exitCode = 1;
    return;
  }

  const sourceRunDir = path.join(cwd, ".researchloop", "scratchpad", "runs", source.id);
  const sourceDirAbs = path.resolve(sourceRunDir);
  const hasSourceDir = fs.existsSync(sourceRunDir);

  const metricKeys = source.metrics ? Object.keys(source.metrics).filter((k) => !k.endsWith("_std")) : [];
  const metricName = String(option("--metric", metricKeys[0] || "val_loss")).trim();
  const regexSource = option("--regex", null);
  const timeoutSec = Number(option("--timeout", 600));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const dryRun = hasFlag("--dry-run");
  const cmdOverride = option("--command", null);
  const evalConfig = loadEvalConfig(cwd);
  const checkpointRequired = Boolean(evalConfig.checkpointGlob || source.last_checkpoint);
  let checkpoint = existingCheckpointFromRow(cwd, source);
  if (!checkpoint && evalConfig.checkpointGlob) {
    checkpoint = findNewestCheckpoint(cwd, evalConfig.checkpointGlob);
  }
  if (checkpointRequired && !checkpoint) {
    console.error(`autoresearch resume: no checkpoint found for run ${source.id}.`);
    if (evalConfig.checkpointGlob) {
      console.error(`checkpoint_glob: ${evalConfig.checkpointGlob}`);
    } else if (source.last_checkpoint) {
      console.error(`last_checkpoint: ${source.last_checkpoint}`);
    }
    process.exitCode = 1;
    return;
  }

  const baseCmdText = cmdOverride && typeof cmdOverride === "string" ? cmdOverride : source.command;
  const cmdText = checkpoint && !(cmdOverride && typeof cmdOverride === "string")
    ? applyResumeFlagTemplate(baseCmdText, evalConfig.resumeFlagTemplate, checkpoint.relative)
    : baseCmdText;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resumeId = String(option("--resume-id", `resume-${source.id}-${stamp}`));

  console.log(`autoresearch resume`);
  console.log(`source: ${source.id} (status=${source.status})`);
  console.log(`command: ${cmdText}`);
  console.log(`resume_dir: ${hasSourceDir ? path.relative(cwd, sourceRunDir) : "(missing — env vars set anyway)"}`);
  if (checkpoint) {
    console.log(`checkpoint: ${checkpoint.relative}`);
  }
  console.log(`metric: ${metricName}`);
  if (dryRun) {
    console.log("dry_run: true");
  }
  console.log("---");

  if (!hasSourceDir) {
    console.error("WARNING: prior run dir not found; resume env vars will point to a missing path.");
  }

  if (dryRun) {
    return;
  }

  const resumeEnv = {
    RESEARCHLOOP_RESUME: "1",
    RESEARCHLOOP_RESUME_FROM: source.id,
    RESEARCHLOOP_RESUME_DIR: sourceDirAbs,
  };
  if (checkpoint) {
    resumeEnv.RESEARCHLOOP_RESUME_CHECKPOINT = checkpoint.absolute;
    resumeEnv.RESEARCHLOOP_RESUME_CHECKPOINT_REL = checkpoint.relative;
  }

  const res = await executeRun({
    cwd,
    cmdText,
    metricName,
    regexSource: typeof regexSource === "string" ? regexSource : null,
    timeoutSec,
    allowUnsafe,
    isBaseline: false,
    idOverride: resumeId,
    extraConfig: {
      resume_of: source.id,
      resume_dir: sourceDirAbs,
      resume_checkpoint: checkpoint ? checkpoint.relative : null,
      resume_command: cmdText,
      source_status: source.status,
    },
    extraEnv: resumeEnv,
    suppressExitCode: true,
    quiet: true,
    tags: ["resume"],
    parentId: source.id,
  });

  if (!res.ok) {
    console.log(`status: ${res.status}`);
    process.exitCode = 1;
    return;
  }

  console.log(`new ${metricName}: ${res.metricValue === null ? "not parsed" : res.metricValue}`);
  console.log(`status: ${res.status}`);
  console.log(`recorded: ${resumeId}`);

  if (res.status === "failed" || res.status === "timeout" || res.status === "spawn_error" || res.status === "killed_by_safety") {
    process.exitCode = 1;
  }
}

function cmdPreflight() {
  const cwd = targetDir();
  const goalFields = readGoalFields(cwd);
  const cmdRaw = option("--command", null);
  let cmdText = cmdRaw && typeof cmdRaw === "string" ? cmdRaw : "";
  if (!cmdText) cmdText = goalFields.evaluation || goalFields.baseline || "";
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const checks = [];
  const addCheck = (name, status, message, extra = {}) => {
    checks.push({ name, status, message, ...extra });
  };

  if (!cmdText || cmdText.toLowerCase() === "unknown") {
    addCheck("command", "fail", "no command (pass --command CMD or set baseline/evaluation in goal.md)");
  } else {
    addCheck("command", "pass", cmdText);
    const safetyPolicy = loadSafetyPolicy(cwd);
    const safetyCheck = evaluateCommandSafety(cmdText, safetyPolicy);
    if (safetyCheck.allowed) {
      addCheck("safety", "pass", "command allowed by safety policy");
    } else {
      addCheck("safety", "fail", `${safetyCheck.rule}: ${safetyCheck.message}`);
    }
    const firstToken = cmdText.trim().split(/\s+/)[0] || "";
    const interpreter = firstToken.replace(/^["']|["']$/g, "");
    if (interpreter && !interpreter.startsWith("./") && !interpreter.includes("/")) {
      const whichRes = runCapture(`command -v ${interpreter} 2>/dev/null`, cwd);
      if (whichRes.ok && whichRes.output.trim()) {
        addCheck("interpreter", "pass", `${interpreter} -> ${whichRes.output.trim()}`);
      } else {
        addCheck("interpreter", "warn", `${interpreter} not found on PATH`);
      }
    }
  }

  if (goalFields.metric) {
    addCheck("metric", "pass", goalFields.metric);
  } else {
    addCheck("metric", "warn", "no metric set in goal.md (--metric val_loss assumed by run)");
  }

  const dataGlobs = goalFields.data_globs || [];
  const fingerprint = computeDataFingerprint(cwd, dataGlobs);
  if (fingerprint) {
    addCheck("data_fingerprint", "pass", fingerprint, { data_globs: dataGlobs });
  } else {
    addCheck("data_fingerprint", "warn", "no data_globs in goal.md — fingerprint skipped");
  }

  const freeBytes = (() => {
    try {
      const out = execSync(`df -k "${cwd}" | tail -1`, { encoding: "utf8", timeout: 1500 });
      const parts = out.trim().split(/\s+/);
      const availKb = Number(parts[3]);
      return Number.isFinite(availKb) ? availKb * 1024 : null;
    } catch {
      return null;
    }
  })();
  const minDiskGb = Number(option("--min-disk-gb", 5));
  if (freeBytes !== null) {
    const freeGb = freeBytes / 1024 / 1024 / 1024;
    if (freeGb < minDiskGb) {
      addCheck("disk", "fail", `${freeGb.toFixed(1)}GB free < ${minDiskGb}GB required`);
    } else {
      addCheck("disk", "pass", `${freeGb.toFixed(1)}GB free`);
    }
  } else {
    addCheck("disk", "warn", "df failed; could not probe free disk");
  }

  const totalMemGb = os.totalmem() / 1024 / 1024 / 1024;
  const freeMemGb = os.freemem() / 1024 / 1024 / 1024;
  // os.freemem reports only purely-free pages; macOS/Linux page cache makes
  // this consistently low. Default threshold is 0 — pass --min-mem-gb for
  // real workloads.
  const minMemGb = Number(option("--min-mem-gb", 0));
  if (freeMemGb < minMemGb) {
    addCheck("memory", "fail", `${freeMemGb.toFixed(1)}GB free RAM < ${minMemGb}GB required (total ${totalMemGb.toFixed(1)}GB)`);
  } else {
    addCheck("memory", "pass", `${freeMemGb.toFixed(1)}GB free / ${totalMemGb.toFixed(1)}GB total`);
  }

  const requireGpu = hasFlag("--require-gpu");
  const gpus = probeGpuStats();
  if (gpus && gpus.length) {
    addCheck("gpu", "pass", `${gpus.length} GPU(s) detected (peak mem ${Math.max(...gpus.map((g) => g.mem_total_mb || 0))}MB)`);
  } else if (requireGpu) {
    addCheck("gpu", "fail", "nvidia-smi failed/absent and --require-gpu was set");
  } else {
    addCheck("gpu", "info", "no GPU detected (nvidia-smi unavailable)");
  }

  const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
  if (fs.existsSync(lockFile)) {
    const drift = checkBaselineDrift();
    if (drift && drift.length) {
      addCheck("baseline", "warn", `baseline drifted: ${drift.join("; ")}`);
    } else {
      addCheck("baseline", "pass", "baseline locked, no drift");
    }
  } else {
    addCheck("baseline", "info", "no baseline lock");
  }

  // Optional VRAM fit check — fires when the user passes arch hints OR they
  // live in the repo profile. Catches OOM before a 20-minute boot.
  const profile = (() => {
    const pf = path.join(cwd, ".researchloop", "repo-profile.json");
    if (!fs.existsSync(pf)) return {};
    try { return JSON.parse(fs.readFileSync(pf, "utf8")) || {}; } catch { return {}; }
  })();
  const arch = profile.model || {};
  const vramOpts = {
    params: option("--params", arch.params || null),
    layers: option("--layers", arch.layers || null),
    dModel: option("--d-model", arch.d_model || arch.hidden_size || null),
    dFf: option("--d-ff", arch.d_ff || arch.ffn_dim || null),
    vocab: option("--vocab", arch.vocab_size || arch.vocab || 32000),
    batch: option("--batch", arch.batch_size || 1),
    seq: option("--seq", arch.seq_len || arch.context_length || 2048),
    dtype: option("--dtype", arch.dtype || "bf16"),
    optimizer: option("--optimizer", arch.optimizer || "adamw"),
    gradCheckpoint: hasFlag("--grad-checkpoint") || !!arch.grad_checkpoint,
    tp: option("--tp", 1), dp: option("--dp", 1), zero: option("--zero", 0),
  };
  if (vramOpts.params || (vramOpts.layers && vramOpts.dModel)) {
    const vram = analyzeVram(vramOpts);
    if (!vram.error) {
      const totalGb = vram.total_per_gpu_bytes / 1e9;
      const gpuName = String(option("--gpu", "")).toLowerCase().trim();
      const localGpuMaxGb = gpus && gpus.length ? Math.max(...gpus.map((g) => (g.mem_total_mb || 0) / 1024)) : null;
      const targetGpu = gpuName
        ? vram.gpu_fits.find((g) => g.name.toLowerCase() === gpuName)
        : null;
      const fitsLocal = localGpuMaxGb ? totalGb + 2 <= localGpuMaxGb : null;
      let msg = `per-GPU ~${totalGb.toFixed(1)} GB`;
      let status = "info";
      if (targetGpu) {
        msg += ` — ${targetGpu.fits_solo ? "✓ fits solo" : targetGpu.fits_dp2 ? "needs DP=2" : targetGpu.fits_dp4 ? "needs DP=4" : "needs DP=8+"} on ${targetGpu.name} (${targetGpu.vram_gb} GB)`;
        status = targetGpu.fits_solo ? "pass" : "warn";
      } else if (fitsLocal !== null) {
        msg += ` — ${fitsLocal ? "✓ fits" : "✗ does NOT fit"} on local GPU (${localGpuMaxGb.toFixed(1)} GB)`;
        status = fitsLocal ? "pass" : "fail";
      } else {
        msg += ` (pass --gpu H100 or similar for a fit verdict)`;
      }
      if (hasFlag("--require-fit") && status !== "pass") status = "fail";
      addCheck("vram_fit", status, msg, { total_per_gpu_gb: totalGb });
    }
  }

  const fail = checks.some((c) => c.status === "fail");
  const summary = { ok: !fail, checks };
  if (formatJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`autoresearch preflight`);
    console.log("---");
    for (const c of checks) {
      const sym = c.status === "pass" ? "✓" : c.status === "fail" ? "✗" : c.status === "warn" ? "!" : "·";
      console.log(`${sym} ${c.name}: ${c.message}`);
    }
    console.log("---");
    console.log(fail ? "preflight: FAIL" : "preflight: OK");
  }
  if (fail) process.exitCode = 1;
}

const ARXIV_API_URL = "http://export.arxiv.org/api/query";

function arxivCacheDir() {
  return path.join(os.homedir(), ".cache", packageName, "arxiv");
}

function arxivCacheKey(query, limit, since) {
  return createHash("sha1")
    .update(`${query}|${limit}|${since || ""}`)
    .digest("hex")
    .slice(0, 16);
}

async function fetchArxivXml({ query, limit, since, cacheDir, offline }) {
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
  const res = await fetch(url, { headers: { "User-Agent": `${packageName}/${packageVersion()}` } });
  if (!res.ok) {
    throw new Error(`arxiv fetch failed: HTTP ${res.status}`);
  }
  const xml = await res.text();
  fs.writeFileSync(cacheFile, xml);
  return xml;
}

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractXmlTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function parseArxivEntries(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const idUrl = extractXmlTag(block, "id");
    const arxivId = idUrl.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
    const authorBlocks = block.match(/<author>[\s\S]*?<\/author>/g) || [];
    const authors = authorBlocks
      .map((blk) => extractXmlTag(blk, "name"))
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

function filterArxivBySince(entries, since) {
  if (!since) return entries;
  const sinceDate = new Date(since.length === 7 ? `${since}-01` : since);
  if (Number.isNaN(sinceDate.getTime())) return entries;
  return entries.filter((entry) => {
    const date = new Date(entry.published);
    return !Number.isNaN(date.getTime()) && date >= sinceDate;
  });
}

function buildDefaultArxivQuery(goalFields, profile) {
  const parts = [];
  if (goalFields.goal) parts.push(goalFields.goal);
  if (goalFields.metric) parts.push(goalFields.metric);
  const adapters = (profile && profile.adapters) || [];
  if (adapters.includes("huggingface")) parts.push("transformer");
  if (adapters.includes("pytorch")) parts.push("deep learning");
  const joined = parts.filter(Boolean).join(" ").slice(0, 200).trim();
  return joined ? `all:${joined}` : "all:deep learning";
}

function renderPaperMarkdown(entry) {
  const pubDate = entry.published ? entry.published.slice(0, 10) : "";
  return [
    `# ${entry.title || entry.arxivId}`,
    "",
    `arXiv: ${entry.arxivId}`,
    `Published: ${pubDate}`,
    `Authors: ${entry.authors.join(", ")}`,
    `Link: ${entry.idUrl}`,
    "",
    "## Abstract",
    "",
    entry.summary,
    "",
    "## How to port this",
    "",
    "TODO. Fill in when the paper is read.",
    "",
  ].join("\n");
}

async function cmdScanPapers() {
  const cwd = targetDir();
  const goalFields = readGoalFields(cwd);
  const profile = loadRepoProfile(cwd);
  const explicitQuery = option("--query", null);
  const query = explicitQuery && typeof explicitQuery === "string"
    ? explicitQuery
    : buildDefaultArxivQuery(goalFields, profile);
  const limitRaw = Number(option("--limit", 10));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.floor(limitRaw)) : 10;
  const sinceOpt = option("--since", null);
  const since = sinceOpt && typeof sinceOpt === "string" ? sinceOpt : null;
  const offline = hasFlag("--offline");
  const cacheDirOpt = option("--cache-dir", null);
  const cacheDir = cacheDirOpt && typeof cacheDirOpt === "string" ? cacheDirOpt : arxivCacheDir();

  console.log("autoresearch scan-papers");
  console.log(`query: ${query}`);
  console.log(`limit: ${limit}`);
  if (since) console.log(`since: ${since}`);
  console.log(`cache: ${cacheDir}`);

  let xml;
  try {
    xml = await fetchArxivXml({ query, limit, since, cacheDir, offline });
  } catch (err) {
    console.error(`scan-papers failed: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  let entries = parseArxivEntries(xml);
  entries = filterArxivBySince(entries, since);

  const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
  ensureDir(papersDir);
  for (const entry of entries) {
    const safeId = entry.arxivId.replace(/[/\\]/g, "_");
    const file = path.join(papersDir, `${safeId}.md`);
    fs.writeFileSync(file, renderPaperMarkdown(entry));
  }

  const thread = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  ensureDir(path.dirname(thread));
  fs.appendFileSync(
    thread,
    `- ${new Date().toISOString()} scan-papers query="${query.slice(0, 100)}" found=${entries.length}\n`
  );

  console.log("---");
  console.log(`found: ${entries.length}`);
  for (const entry of entries) {
    const title = entry.title.length > 80 ? `${entry.title.slice(0, 77)}...` : entry.title;
    console.log(`- ${entry.arxivId} ${title}`);
  }
  console.log(`papers written to: ${path.relative(cwd, papersDir)}`);
}

function cmdTeam() {
  const cwd = targetDir();
  const force = hasFlag("--force");
  const researchDir = path.join(cwd, ".researchloop");
  ensureDir(researchDir);
  const teamDir = path.join(researchDir, "team");
  if (fs.existsSync(teamDir) && !force) {
    let existing = [];
    try {
      existing = fs.readdirSync(teamDir);
    } catch {
      existing = [];
    }
    if (existing.length > 0) {
      console.error(`team: ${path.relative(cwd, teamDir)} already exists with ${existing.length} entries.`);
      console.error("Re-run with --force to overwrite (this removes any user edits in that folder).");
      process.exitCode = 1;
      return;
    }
  }
  const workersRaw = Number(option("--workers", 8));
  const workerCount = Number.isFinite(workersRaw) && workersRaw > 0 ? Math.floor(workersRaw) : 8;
  const goalText =
    option("--goal", "") ||
    readGoalSummary(path.join(researchDir, "goal.md")) ||
    "Build the smallest useful multi-agent development loop for AutoResearch-AI.";
  const plan = buildTeamPlan(cwd, goalText, workerCount);
  const templateDir = path.join(templatesRoot, "team");

  fs.rmSync(teamDir, { recursive: true, force: true });
  ensureDir(teamDir);
  ensureDir(path.join(teamDir, "workers"));

  const boardRows = plan.workers
    .map((worker) => {
      const files = worker.files.join(", ");
      return `| ${String(worker.index).padStart(2, "0")} | ${worker.title} | ${worker.branch} | ${worker.scope} | ${files} | pending |`;
    })
    .join("\n");
  const setupCommands = plan.workers
    .map((worker) => `git worktree add -b ${worker.branch} ${worker.worktree} HEAD`)
    .join("\n");

  const sharedValues = {
    GOAL: plan.goalText,
    WORKER_COUNT: String(plan.workers.length),
    BOARD_ROWS: boardRows,
    SETUP_COMMANDS: setupCommands,
  };

  for (const name of ["README.md", "orchestrator.md", "reviewer.md", "board.md", "setup.sh"]) {
    const template = readTextIfExists(path.join(templateDir, name));
    if (template) {
      writeFileSafe(path.join(teamDir, name), renderTemplate(template, sharedValues), true);
    }
  }
  const setupFile = path.join(teamDir, "setup.sh");
  if (fs.existsSync(setupFile)) {
    fs.chmodSync(setupFile, 0o755);
  }

  const workerTemplate = readTextIfExists(path.join(templateDir, "worker.md"));
  for (const worker of plan.workers) {
    const file = path.join(teamDir, "workers", `${String(worker.index).padStart(2, "0")}-${worker.slug}.md`);
    const rendered = renderTemplate(workerTemplate, {
      ...sharedValues,
      INDEX: String(worker.index).padStart(2, "0"),
      TITLE: worker.title,
      SLUG: worker.slug,
      BRANCH: worker.branch,
      WORKTREE: worker.worktree,
      SCOPE: worker.scope,
      FILES: worker.files.map((file) => `- ${file}`).join("\n"),
      DONE: worker.done,
    });
    writeFileSafe(file, rendered, true);
  }

  const summaryFile = path.join(teamDir, "summary.md");
  const summary = [
    "# AutoResearch-AI Development Team",
    "",
    `Goal: ${plan.goalText}`,
    `Workers: ${plan.workers.length}`,
    "",
    "Roles:",
    "- human: release direction and final merge gate",
    "- orchestrator: decomposition and assignment",
    "- reviewer: merge safety and test gate",
    "- workers: one lane each",
    "",
    "Suggested next step:",
    "Create one worktree or branch per worker, then let the orchestrator assign the first round.",
    "",
    "Branches:",
    ...plan.workers.map((worker) => `- ${worker.branch}`),
    "",
  ].join("\n");
  writeFileSafe(summaryFile, summary, true);

  console.log(`AutoResearch-AI development team written to ${path.relative(cwd, teamDir)}`);
  console.log(`workers: ${plan.workers.length}`);
  console.log(`goal: ${plan.goalText}`);
  for (const worker of plan.workers) {
    console.log(`- ${String(worker.index).padStart(2, "0")} ${worker.title} -> ${worker.branch}`);
  }
  console.log("Next: create branches or worktrees, then hand each lane to a separate agent.");
}

function loadFailurePatterns(cwd) {
  const patternFile = path.join(cwd, ".researchloop", "failure-patterns.yaml");
  if (!fs.existsSync(patternFile)) return [];
  try {
    const raw = fs.readFileSync(patternFile, "utf8");
    const patterns = [];
    for (const line of raw.split("\n")) {
      const km = line.match(/^\s+-\s+key:\s*["']?([^"'\n]+)["']?\s*$/);
      const sm = line.match(/^\s+suggestion:\s*(.+)\s*$/);
      if (km) patterns.push({ key: km[1], suggestion: "" });
      else if (sm && patterns.length) patterns[patterns.length-1].suggestion = sm[1];
    }
    return patterns;
  } catch { return []; }
}

function cmdFailures() {
  const cwd = targetDir();
  const topN = Math.max(1, Math.min(100, Number(option("--top", 10)) || 10));
  const asJson = hasFlag("--format") && option("--format") === "json";
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const patterns = loadFailurePatterns(cwd);

  if (!fs.existsSync(ledger)) {
    process.stdout.write(asJson ? "[]\n" : "No runs recorded.\n");
    return;
  }

  const rows = [];
  for (const line of fs.readFileSync(ledger, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }

  const failed = rows.filter((r) => r.status === "failed" || r.status === "killed_by_rule" || r.status === "killed_by_safety");
  if (!failed.length) {
    process.stdout.write(asJson ? "[]\n" : "No failed runs found.\n");
    return;
  }

  const clusters = {};
  for (const run of failed) {
    const kr = run.kill_reason || "";
    const lower = kr.toLowerCase();
    let clusterKey = kr || "unknown";
    for (const p of patterns) {
      if (lower.includes(p.key.toLowerCase())) { clusterKey = p.key; break; }
    }
    if (!clusters[clusterKey]) {
      const pat = patterns.find((p) => p.key.toLowerCase() === clusterKey.toLowerCase());
      clusters[clusterKey] = { key: clusterKey, count: 0, runIds: [], suggestion: pat ? pat.suggestion : "Inspect stderr for the actual error." };
    }
    clusters[clusterKey].count++;
    clusters[clusterKey].runIds.push(run.id);
  }

  const sorted = Object.values(clusters).sort((a, b) => b.count - a.count);
  const top = sorted.slice(0, topN);

  if (asJson) {
    process.stdout.write(JSON.stringify({ clusters: top, total: failed.length }, null, 2) + "\n");
  } else {
    console.log("=== Failure Clusters ===");
    console.log("Total failures: " + failed.length);
    console.log("Clusters: " + sorted.length);
    console.log("");
    for (const c of top) {
      console.log("## " + c.key + " (" + c.count + " runs)");
      console.log("  Suggestion: " + c.suggestion);
      console.log("  Examples: " + c.runIds.slice(0, 3).join(", "));
      console.log("");
    }
  }
}

function cmdBaselineLock() {
  const cwd = targetDir();
  const doUnlock = hasFlag("--unlock");
  const baselineDir = path.join(cwd, ".researchloop");
  const baselineMd = path.join(baselineDir, "baseline.md");
  const lockFile = path.join(baselineDir, "baseline.lock");

  if (doUnlock) {
    try {
      fs.unlinkSync(lockFile);
      console.log("Baseline lock removed.");
    } catch {
      console.error("No baseline lock to remove.");
      process.exitCode = 1;
    }
    return;
  }

  if (!fs.existsSync(baselineMd)) {
    console.error("No baseline.md found. Run `autoresearch baseline-status` first.");
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(baselineMd, "utf8");
  const whatToRecord = extractSection(raw, "What To Record");
  const metric = extractValue(whatToRecord, "Metric");
  const direction = extractValue(whatToRecord, "Direction");
  const command = extractValue(whatToRecord, "Command or config");

  // Get current git SHA
  let gitSha = "unknown";
  let gitDirty = false;
  try {
    const gitDir = path.join(cwd, ".git");
    if (fs.existsSync(gitDir)) {
      const sha = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      if (sha.startsWith("ref: ")) {
        const ref = sha.slice(5);
        const refPath = path.join(gitDir, ref);
        if (fs.existsSync(refPath)) {
          gitSha = fs.readFileSync(refPath, "utf8").trim().slice(0, 8);
        }
      } else {
        gitSha = sha.slice(0, 8);
      }
      const status = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
      // Check for uncommitted changes
      const indexFile = path.join(gitDir, "index");
      if (fs.existsSync(indexFile)) {
        // Simple heuristic: if index exists and is not empty, dirty
        const stat = fs.statSync(indexFile);
        gitDirty = stat.size > 0;
      }
    }
  } catch { /* ignore */ }

  // Get env hash from G14 env capture (if available)
  let envHash = null;
  try {
    const envJsonPath = path.join(baselineDir, "scratchpad", "runs.jsonl");
    if (fs.existsSync(envJsonPath)) {
      const lines = fs.readFileSync(envJsonPath, "utf8").split("\n").filter(l => l.trim());
      if (lines.length > 0) {
        const lastRow = JSON.parse(lines[lines.length - 1]);
        if (lastRow.env && lastRow.env.env_hash) {
          envHash = lastRow.env.env_hash;
        }
      }
    }
  } catch { /* ignore */ }

  // Get the best completed run's metric value from runs.jsonl
  let baselineValue = null;
  try {
    const runsPath = path.join(baselineDir, "scratchpad", "runs.jsonl");
    if (fs.existsSync(runsPath)) {
      const lines = fs.readFileSync(runsPath, "utf8").split("\n").filter(l => l.trim());
      for (const line of lines.reverse()) {
        const row = JSON.parse(line);
        if (row.status === "completed" && row.value != null) {
          baselineValue = row.value;
          break;
        }
      }
    }
  } catch { /* ignore */ }

  const lockData = {
    locked_at: new Date().toISOString(),
    metric,
    direction,
    command,
    git_sha: gitSha,
    git_dirty: gitDirty,
    env_hash: envHash,
    baseline_value: baselineValue,
  };

  fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2) + "\n");
  console.log("Baseline locked.");
  console.log("  Metric: " + metric + " (" + direction + ")");
  console.log("  Value: " + (baselineValue !== null ? baselineValue : "(not set)"));
  console.log("  Git: " + gitSha + (gitDirty ? " (dirty)" : ""));
}

// Check if baseline is drifted (called by run/compare/promote)
function checkBaselineDrift() {
  const cwd = targetDir();
  const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
  if (!fs.existsSync(lockFile)) return null; // no lock, no drift check

  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));

  // Check git SHA drift
  let currentSha = "unknown";
  try {
    const gitDir = path.join(cwd, ".git");
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const ref = head.slice(5);
      const refPath = path.join(gitDir, ref);
      if (fs.existsSync(refPath)) {
        currentSha = fs.readFileSync(refPath, "utf8").trim().slice(0, 8);
      }
    } else {
      currentSha = head.slice(0, 8);
    }
  } catch { /* ignore */ }

  const warnings = [];
  if (currentSha !== lock.git_sha) {
    warnings.push("Git SHA drift: locked " + lock.git_sha + ", now " + currentSha);
  }

  // Check baseline metric drift using runs.jsonl
  if (lock.baseline_value !== null) {
    try {
      const runsPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
      if (fs.existsSync(runsPath)) {
        const lines = fs.readFileSync(runsPath, "utf8").split("\n").filter(l => l.trim());
        let bestValue = null;
        for (const line of lines) {
          const row = JSON.parse(line);
          if (row.status === "completed" && row.value != null) {
            if (bestValue === null) bestValue = row.value;
            else if (lock.direction === "higher") bestValue = Math.max(bestValue, row.value);
            else bestValue = Math.min(bestValue, row.value);
          }
        }
        if (bestValue !== null && bestValue !== lock.baseline_value) {
          const pct = Math.abs((bestValue - lock.baseline_value) / lock.baseline_value * 100).toFixed(1);
          warnings.push("Baseline metric drift: locked " + lock.baseline_value + ", best now " + bestValue + " (" + pct + "%)");
        }
      }
    } catch { /* ignore */ }
  }

  return warnings.length > 0 ? warnings : null;
}

function cmdBaselineStatus() {
  const cwd = targetDir();
  const asJson = hasFlag("--format") && option("--format") === "json";
  const baselineFile = path.join(cwd, ".researchloop", "baseline.md");

  if (!fs.existsSync(baselineFile)) {
    const msg = "Baseline not found. Run `autoresearch baseline` or create .researchloop/baseline.md";
    if (asJson) {
      process.stdout.write(JSON.stringify({ status: "missing", message: msg }, null, 2) + "\n");
    } else {
      console.log("Error: " + msg);
    }
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(baselineFile, "utf8");

  // Parse the two sections
  const whatToRecord = extractSection(raw, "What To Record");
  const frozenSurfaces = extractSection(raw, "Frozen Surfaces");
  const notes = extractSection(raw, "Notes");

  const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
  const optionalWhatToRecord = ["Model/data/training budget", "System or accelerator", "Known limitations"];
  const requiredFrozen = ["Dataset", "Model size", "Seed"];
  const optionalFrozen = ["Token budget or eval budget", "Optimizer", "Architecture"];

  const allRequired = [...requiredWhatToRecord, ...requiredFrozen];
  const missing = [];

  for (const key of requiredWhatToRecord) {
    if (!sectionHasValue(whatToRecord, key)) missing.push(key);
  }
  for (const key of requiredFrozen) {
    if (!sectionHasValue(frozenSurfaces, key)) missing.push(key);
  }

  if (missing.length) {
    if (asJson) {
      process.stdout.write(JSON.stringify({ status: "incomplete", missing_fields: missing, message: "Baseline is missing required fields" }, null, 2) + "\n");
    } else {
      console.log("Baseline is incomplete. Missing fields:");
      for (const m of missing) console.log("  - " + m);
    }
    process.exitCode = 1;
    return;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({
      status: "complete",
      metric: extractValue(whatToRecord, "Metric"),
      direction: extractValue(whatToRecord, "Direction"),
      command: extractValue(whatToRecord, "Command or config"),
      baseline_artifact: extractValue(whatToRecord, "Baseline artifact"),
      frozen_variables: {
        dataset: extractValue(frozenSurfaces, "Dataset"),
        model_size: extractValue(frozenSurfaces, "Model size"),
        seed: extractValue(frozenSurfaces, "Seed"),
        optimizer: extractValue(frozenSurfaces, "Optimizer") || null,
        architecture: extractValue(frozenSurfaces, "Architecture") || null,
      },
      caveats: extractValue(whatToRecord, "Known limitations") || null,
    }, null, 2) + "\n");
  } else {
    console.log("Baseline is complete.");
    console.log("");
    console.log("Metric: " + extractValue(whatToRecord, "Metric") + " (" + extractValue(whatToRecord, "Direction") + ")");
    console.log("Command: " + extractValue(whatToRecord, "Command or config"));
    console.log("Artifact: " + extractValue(whatToRecord, "Baseline artifact"));
    console.log("");
    console.log("Frozen surfaces:");
    console.log("  Dataset: " + extractValue(frozenSurfaces, "Dataset"));
    console.log("  Model size: " + extractValue(frozenSurfaces, "Model size"));
    console.log("  Seed: " + extractValue(frozenSurfaces, "Seed"));
    const opt = extractValue(frozenSurfaces, "Optimizer");
    const arch = extractValue(frozenSurfaces, "Architecture");
    if (opt) console.log("  Optimizer: " + opt);
    if (arch) console.log("  Architecture: " + arch);
    const caveats = extractValue(whatToRecord, "Known limitations");
    if (caveats) {
      console.log("");
      console.log("Caveats: " + caveats);
    }
  }
}

function extractSection(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[]\\]/g, "\\$&");
  const match = text.match(new RegExp(`^## ${escaped}\\n+([\\s\\S]*?)(?=\\n## )`, "mi"));
  return match ? match[1] : "";
}

function sectionHasValue(section, key) {
  const pattern = `^\\s*[-*]?\\s*${key.replace(/[.*+?^${}()|[]\\]/g, "\\$&")}\\s*[:\\-]\\s*(.+)\\n`;
  const re = new RegExp(pattern, "mi");
  return re.test(section);
}

function extractValue(section, key) {
  const pattern = `^\\s*[-*]?\\s*${key.replace(/[.*+?^${}()|[]\\]/g, "\\$&")}\\s*[:\\-]\\s*(.+)\\n`;
  const re = new RegExp(pattern, "mi");
  const m = section.match(re);
  return m ? m[1].trim() : "";
}

function cmdTag() {
  const cwd = targetDir();
  const runId = String(option("--id", ""));
  const addTag = option("--add", null);
  const removeTag = option("--remove", null);
  const listTags = hasFlag("--list");
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  if (!runId && !listTags) {
    console.error("Usage: autoresearch tag --id <run-id> [--add TAG] [--remove TAG] [--list] [--dir PATH]");
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found.");
    process.exitCode = 1;
    return;
  }

  const rows = parseRunsLedger(ledger);
  if (listTags) {
    // List all unique tags across all runs
    const tagSet = new Set();
    for (const row of rows) {
      if (row && !row.parse_error && row.tags) {
        for (const t of row.tags) tagSet.add(t);
      }
    }
    const tags = Array.from(tagSet).sort();
    if (tags.length === 0) {
      console.log("No tags recorded yet.");
    } else {
      console.log("Tags: " + tags.join(", "));
    }
    return;
  }

  if (!runId) {
    console.error("--id required for tag operations.");
    process.exitCode = 1;
    return;
  }

  const rowIdx = rows.findIndex((r) => r && !r.parse_error && String(r.id) === String(runId));
  if (rowIdx === -1) {
    console.error("Run not found: " + runId);
    process.exitCode = 1;
    return;
  }

  const row = rows[rowIdx];
  if (!row.tags) row.tags = [];

  if (addTag) {
    const tagStr = String(addTag).trim();
    if (!tagStr) {
      console.error("Tag cannot be empty.");
      process.exitCode = 1;
      return;
    }
    if (!row.tags.includes(tagStr)) {
      row.tags.push(tagStr);
      console.log("Tag added: " + tagStr);
    } else {
      console.log("Tag already exists: " + tagStr);
    }
  }

  if (removeTag) {
    const tagStr = String(removeTag).trim();
    const idx = row.tags.indexOf(tagStr);
    if (idx !== -1) {
      row.tags.splice(idx, 1);
      console.log("Tag removed: " + tagStr);
    } else {
      console.log("Tag not found: " + tagStr);
    }
  }

  if (addTag || removeTag) {
    rows[rowIdx] = row;
    const tmpLedger = ledger + ".tag_tmp";
    fs.writeFileSync(tmpLedger, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    fs.renameSync(tmpLedger, ledger);
  }

  // Show current tags for this run
  if (row.tags && row.tags.length) {
    console.log("Tags for " + runId + ": " + row.tags.join(", "));
  } else {
    console.log("No tags for " + runId + ".");
  }
}

function cmdDigest() {
  const sinceStr = option("--since", "24h");
  const format = option("--format", "markdown");
  const cwd = targetDir();
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  // Parse --since duration
  const sinceMatch = sinceStr.match(/^(\d+)([hdm])?$/);
  let sinceMs = 24 * 60 * 60 * 1000; // default: 24h in ms
  if (sinceMatch) {
    const val = parseInt(sinceMatch[1], 10);
    const unit = sinceMatch[2] || "h";
    if (unit === "h") sinceMs = val * 60 * 60 * 1000;
    else if (unit === "d") sinceMs = val * 24 * 60 * 60 * 1000;
    else if (unit === "m") sinceMs = val * 60 * 1000;
  }
  const nowFlag = option("--now");
  const nowMs = nowFlag ? Date.parse(String(nowFlag)) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`autoresearch digest: invalid --now value: ${nowFlag}`);
    process.exitCode = 1;
    return;
  }
  const cutoff = nowMs - sinceMs;

  let runs = [];
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        runs.push(JSON.parse(trimmed));
      } catch { /* skip */ }
    }
  } catch {
    runs = [];
  }

  // Filter by timestamp
  const recent = runs.filter((r) => {
    if (!r.timestamp) return false;
    const ts = new Date(r.timestamp).getTime();
    return ts >= cutoff;
  });

  if (recent.length === 0) {
    console.log("No runs in the last " + sinceStr + ".");
    return;
  }

  const completed = recent.filter((r) => r.status === "completed" || r.status === "promoted");
  const failed = recent.filter((r) => r.status === "failed" || r.status === "killed");

  const metrics = recent
    .map((r) => r.metrics?.value ?? r.value)
    .filter((v) => v != null && Number.isFinite(v));

  const best = metrics.length ? Math.max(...metrics) : null;
  const worst = metrics.length ? Math.min(...metrics) : null;

  const wallSecs = recent.reduce((s, r) => s + (r.wall_seconds || 0), 0);
  const cost = recent.reduce((s, r) => s + (r.est_cost_usd || 0), 0);

  if (format === "json") {
    const out = {
      period: sinceStr,
      totalRuns: recent.length,
      completed: completed.length,
      failed: failed.length,
      bestMetric: best,
      worstMetric: worst,
      totalWallSeconds: wallSecs,
      totalEstimatedCost: cost > 0 ? cost : null,
    };
    console.log(JSON.stringify(out, null, 2));
  } else {
    // Markdown
    const lines = [
      "# Experiment Digest — last " + sinceStr,
      "",
      "| Metric | Value |",
      "| --- | --- |",
      "| Runs total | " + recent.length + " |",
      "| Completed | " + completed.length + " |",
      "| Failed | " + failed.length + " |",
      "| Best metric | " + (best != null ? best.toFixed(4) : "—") + " |",
      "| Worst metric | " + (worst != null ? worst.toFixed(4) : "—") + " |",
      "| Total wall time | " + wallSecs.toFixed(0) + "s |",
      "| Total est. cost | " + (cost > 0 ? "$" + cost.toFixed(2) : "—") + " |",
    ];
    console.log(lines.join("\n"));
  }
}

function cmdParamImportance() {
  const metric = option("--metric", "value");
  const format = option("--format", "table");
  const cwd = targetDir();
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  let runs = [];
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        runs.push(JSON.parse(trimmed));
      } catch { /* skip */ }
    }
  } catch {
    runs = [];
  }

  // Filter to runs with the target metric
  const valid = runs.filter((r) => {
    const val = r.metrics?.[metric] ?? r.value;
    return r.status === "completed" || r.status === "promoted";
  });

  if (valid.length < 5) {
    console.log("Insufficient data (" + valid.length + " runs, need at least 5).");
    return;
  }

  // Collect all param keys
  const paramKeys = new Set();
  for (const r of valid) {
    if (r.params && typeof r.params === "object") {
      for (const k of Object.keys(r.params)) {
        paramKeys.add(k);
      }
    }
  }

  // Separate numeric and categorical params
  const numericParams = [];
  const categoricalParams = [];
  for (const key of paramKeys) {
    const vals = valid.map((r) => r.params?.[key]);
    const isNumeric = vals.every((v) => v == null || typeof v === "number");
    if (isNumeric) numericParams.push(key);
    else categoricalParams.push(key);
  }

  // Pearson correlation for numeric params
  function pearsonr(xs, ys) {
    const n = xs.length;
    if (n === 0) return 0;
    const xMean = xs.reduce((s, v) => s + v, 0) / n;
    const yMean = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xMean;
      const dy = ys[i] - yMean;
      num += dx * dy;
      denX += dx * dx;
      denY += dy * dy;
    }
    const den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  }

  // ANOVA-style for categorical params
  function anovaSummary(key) {
    const buckets = {};
    for (const r of valid) {
      const cat = String(r.params?.[key] ?? "null");
      if (!buckets[cat]) buckets[cat] = [];
      const val = r.metrics?.[metric] ?? r.value;
      if (val != null) buckets[cat].push(val);
    }
    return Object.entries(buckets).map(([cat, vals]) => {
      const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      const spread = vals.length > 1
        ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length)
        : 0;
      return { category: cat, count: vals.length, mean, spread };
    });
  }

  const metricVals = valid.map((r) => r.metrics?.[metric] ?? r.value);
  const numericResults = numericParams.map((key) => {
    const xs = valid.map((r) => r.params?.[key] ?? 0);
    const r = pearsonr(xs, metricVals);
    return { param: key, correlation: r, type: "numeric" };
  });

  const categoricalResults = categoricalParams.map((key) => {
    const summary = anovaSummary(key);
    const grandMean = metricVals.filter((v) => v != null).reduce((s, v) => s + v, 0)
      / metricVals.filter((v) => v != null).length;
    const betweenVar = summary.reduce((s, { mean, count }) => {
      if (mean == null) return s;
      return s + count * (mean - grandMean) ** 2;
    }, 0) / valid.length;
    const totalVar = metricVals.filter((v) => v != null).reduce((s, v) => s + (v - grandMean) ** 2, 0)
      / metricVals.filter((v) => v != null).length;
    const etaSq = totalVar === 0 ? 0 : betweenVar / totalVar;
    return { param: key, etaSquared: etaSq, type: "categorical", summary };
  });

  // Sort numeric by |correlation| desc
  numericResults.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  if (format === "json") {
    const out = { metric, nRuns: valid.length, numeric: numericResults, categorical: categoricalResults };
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  // Table output
  const lines = ["# Parameter Importance — " + metric, ""];
  lines.push("**Runs analyzed:** " + valid.length + " | **Metric:** " + metric + "");
  lines.push("");

  if (numericParams.length) {
    lines.push("## Numeric Parameters (Pearson r)");
    lines.push("");
    lines.push("| Parameter | r | |r| |");
    lines.push("| --- | ---: | ---: |");
    for (const { param, correlation } of numericResults) {
      lines.push("| " + param + " | " + correlation.toFixed(4) + " | " + Math.abs(correlation).toFixed(4) + " |");
    }
    lines.push("");
  }

  if (categoricalParams.length) {
    lines.push("## Categorical Parameters (eta^2)");
    lines.push("");
    lines.push("| Parameter | eta^2 | Categories |");
    lines.push("| --- | ---: | --- |");
    for (const { param, etaSquared, summary } of categoricalResults) {
      const cats = summary.map((s) => s.category + " (" + s.count + ")").join(", ");
      lines.push("| " + param + " | " + etaSquared.toFixed(4) + " | " + cats + " |");
    }
    lines.push("");
    for (const { param, summary } of categoricalResults) {
      lines.push("### " + param + "");
      lines.push("");
      lines.push("| Category | Count | Mean " + metric + " | Spread |");
      lines.push("| --- | ---: | ---: | ---: |");
      for (const { category, count, mean, spread } of summary) {
        lines.push("| " + category + " | " + count + " | " + (mean != null ? mean.toFixed(4) : "—") + " | " + (spread != null ? spread.toFixed(4) : "—") + " |");
      }
      lines.push("");
    }
  }

  if (numericParams.length === 0 && categoricalParams.length === 0) {
    lines.push("No parameter fields found in completed runs.");
  }

  console.log(lines.join("\n"));
}

function cmdSuggest() {
  const metric = option("--metric", "value");
  const direction = option("--direction", "higher");
  const n = parseInt(option("--n", "3"), 10);
  const fmt = option("--format", "text");
  const cwd = targetDir();
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  let runs = [];
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        runs.push(JSON.parse(trimmed));
      } catch { /* skip */ }
    }
  } catch {
    runs = [];
  }

  const valid = runs.filter((r) => {
    const val = r.metrics?.[metric] ?? r.value;
    return (r.status === "completed" || r.status === "promoted") && val != null && Number.isFinite(val);
  });

  if (valid.length < 3) {
    console.log("Not enough data to suggest experiments (need at least 3 runs).");
    return;
  }

  const paramKeys = new Set();
  for (const r of valid) {
    if (r.params && typeof r.params === "object") {
      for (const k of Object.keys(r.params)) paramKeys.add(k);
    }
  }

  const isLower = direction === "lower";
  const dirFactor = isLower ? 1 : -1;
  valid.sort((a, b) => {
    const aV = a.metrics?.[metric] ?? a.value;
    const bV = b.metrics?.[metric] ?? b.value;
    return (aV - bV) * dirFactor;
  });
  const bestRun = valid[0];
  const bestVal = bestRun.metrics?.[metric] ?? bestRun.value;

  const numericKeys = [];
  const catKeys = [];
  for (const k of paramKeys) {
    const vals = valid.map((r) => r.params?.[k]);
    if (vals.every((v) => v == null || typeof v === "number")) numericKeys.push(k);
    else catKeys.push(k);
  }

  const suggestions = [];

  for (const key of numericKeys) {
    const xs = valid.map((r) => r.params?.[key] ?? 0);
    const ys = valid.map((r) => r.metrics?.[metric] ?? r.value);

    const sortedYs = [...ys].sort((a, b) => (a - b) * dirFactor);
    const cutoff = sortedYs[Math.min(Math.ceil(xs.length * 0.3), sortedYs.length - 1)];
    let num = 0, den = 0;
    for (let i = 0; i < xs.length; i++) {
      const w = ys[i] <= cutoff ? 1 : 0.1;
      num += xs[i] * w;
      den += w;
    }
    const weightedCenter = den > 0 ? num / den : xs.reduce((s, v) => s + v, 0) / xs.length;

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const xRange = xMax - xMin;

    const step = xRange > 0 ? (weightedCenter - (xMin + xMax) / 2) * 0.5 : weightedCenter * 0.2;
    const suggested = Math.max(xMin, Math.min(xMax, weightedCenter + step));
    const confidence = xRange > 0 ? Math.min(0.95, 1 - Math.abs(step) / (xRange + 1e-10)) : 0.3;

    suggestions.push({
      param: key,
      suggested,
      testedRange: [xMin, xMax],
      confidence: Math.max(0.1, confidence),
      reason: "weighted center of top 30% runs is " + weightedCenter.toFixed(4) + ", suggest exploring toward " + suggested.toFixed(4),
    });
  }

  for (const key of catKeys) {
    const seen = new Set(valid.map((r) => String(r.params?.[key] ?? "null")));
    const goalFile = path.join(cwd, ".researchloop", "goal.md");
    let candidates = [];
    try {
      const goalRaw = fs.readFileSync(goalFile, "utf8");
      const sweepMatch = goalRaw.match(/params:[\s\S]*?(?=^\w|\n#|$)/mi);
      if (sweepMatch) {
        const lines = sweepMatch[0].split("\n");
        for (const line of lines) {
          const m = line.match(/^-\s*(\w+):\s*\[/);
          if (m) candidates.push(m[1]);
        }
      }
    } catch { /* no goal.yaml */ }

    if (candidates.length === 0) candidates = Array.from(seen);
    for (const cand of candidates) {
      if (!seen.has(cand)) {
        suggestions.push({
          param: key,
          suggested: cand,
          testedRange: null,
          confidence: 0.4,
          reason: "categorical '" + key + "' has no run with value '" + cand + "' yet",
        });
      }
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence);
  const top = suggestions.slice(0, n);

  if (fmt === "json") {
    console.log(JSON.stringify({ metric, direction, bestRun: bestRun.id, bestValue: bestVal, suggestions: top }, null, 2));
    return;
  }

  const lines = [
    "# Auto-Suggest — " + metric + " (" + direction + ")",
    "",
    "**Best run:** " + bestRun.id + " | **" + metric + ":** " + (bestVal != null ? bestVal.toFixed(4) : "—"),
    "",
    "| # | Parameter | Suggested | Confidence | Reason |",
    "| ---: | --- | ---: | ---: | --- |",
  ];

  top.forEach((s, i) => {
    const suggested = s.testedRange != null ? Number(s.suggested).toFixed(6) : s.suggested;
    lines.push("| " + (i + 1) + " | " + s.param + " | " + suggested + " | " + (s.confidence * 100).toFixed(0) + "% | " + s.reason + " |");
  });

  if (top.length === 0) {
    lines.push("| | | | | |");
    lines.push("No specific suggestions yet. Try running more experiments first.");
  }

  console.log(lines.join("\n"));
}

function cmdApprovals() {
  const sub = positionalText(["list", "approve", "reject"]);
  const cwd = targetDir();
  const approvalsPath = path.join(cwd, ".researchloop", "approvals.jsonl");

  if (!sub || sub === "list") {
    let items = [];
    try {
      if (fs.existsSync(approvalsPath)) {
        const raw = fs.readFileSync(approvalsPath, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { items.push(JSON.parse(trimmed)); } catch { /* skip */ }
        }
      }
    } catch { items = []; }

    const pending = items.filter(i => i.status === "pending");
    const approved = items.filter(i => i.status === "approved");
    const rejected = items.filter(i => i.status === "rejected");

    if (!items.length) {
      console.log("No approval items.");
      return;
    }
    console.log(`Pending: ${pending.length}  |  Approved: ${approved.length}  |  Rejected: ${rejected.length}\n`);
    for (const item of pending) {
      const age = item.timestamp ? new Date(item.timestamp).toLocaleString() : "unknown";
      console.log(`[${item.id}] ${item.type} — ${item.description}`);
      console.log(`  command: ${item.proposedCommand}`);
      console.log(`  reasoning: ${item.reasoning}`);
      console.log(`  added: ${age}\n`);
    }
    return;
  }

  if (sub === "approve" || sub === "reject") {
    const targetId = option(sub, "");
    if (!targetId) {
      console.error(`Usage: autoresearch approvals ${sub} <id>`);
      process.exitCode = 1;
      return;
    }
    let items = [];
    try {
      if (fs.existsSync(approvalsPath)) {
        const raw = fs.readFileSync(approvalsPath, "utf8");
        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try { items.push(JSON.parse(trimmed)); } catch { /* skip */ }
        }
      }
    } catch { items = []; }

    const idx = items.findIndex(i => i.id === targetId && i.status === "pending");
    if (idx === -1) {
      console.error(`Approval ${targetId} not found or already resolved.`);
      process.exitCode = 1;
      return;
    }
    items[idx].status = sub === "approve" ? "approved" : "rejected";
    items[idx].resolvedAt = new Date().toISOString();
    fs.writeFileSync(approvalsPath, items.map(i => JSON.stringify(i)).join("\n") + "\n");
    console.log(`${sub === "approve" ? "Approved" : "Rejected"}: ${targetId}`);
    return;
  }

  console.error(`Unknown subcommand: ${sub}`);
  console.error("Usage: autoresearch approvals [list|approve <id>|reject <id>]");
  process.exitCode = 1;
}

function cmdQuery() {
  const rawExpr = positionalText();
  const fmt = option("--format", "table");
  const cwd = targetDir();
  const ledgerPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");

  let runs = [];
  try {
    const raw = fs.readFileSync(ledgerPath, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        runs.push(JSON.parse(trimmed));
      } catch { /* skip */ }
    }
  } catch {
    runs = [];
  }

  if (!rawExpr) {
    console.error('Usage: autoresearch query "<expression>" [--format jsonl|table] [--dir PATH]');
    process.exitCode = 1;
    return;
  }

  function getNestedValue(obj, path) {
    return path.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : null), obj);
  }

  function evaluatePredicate(lhs, op, rhs) {
    if (lhs === null || lhs === undefined) return false;
    switch (op) {
      case "=": return String(lhs) === String(rhs);
      case "!=": return String(lhs) !== String(rhs);
      case "<": return Number(lhs) < Number(rhs);
      case "<=": return Number(lhs) <= Number(rhs);
      case ">": return Number(lhs) > Number(rhs);
      case ">=": return Number(lhs) >= Number(rhs);
      case "contains": return String(lhs).toLowerCase().includes(String(rhs).toLowerCase());
      case "between": {
        const m = String(rhs).match(/^(.+)\.\.(.+)$/);
        if (!m) return false;
        const v = Number(lhs);
        return v >= Number(m[1]) && v <= Number(m[2]);
      }
      default: return false;
    }
  }

  const predicates = [];
  let sortField = null;
  let sortDir = "asc";
  let limitCount = 100;

  const tokens = rawExpr.trim().split(/\s+/);
  let i = 0;

  if (tokens[i] === "where") {
    i++;
    while (i < tokens.length) {
      if (tokens[i] === "sort-by") {
        i++;
        if (i >= tokens.length) { console.error("query: sort-by requires a field"); process.exitCode = 1; return; }
        sortField = tokens[i];
        i++;
        if (i < tokens.length && (tokens[i] === "asc" || tokens[i] === "desc")) {
          sortDir = tokens[i]; i++;
        }
        continue;
      } else if (tokens[i] === "limit") {
        i++;
        if (i >= tokens.length) { console.error("query: limit requires a number"); process.exitCode = 1; return; }
        limitCount = parseInt(tokens[i], 10);
        i++;
        continue;
      }
      if (i + 2 >= tokens.length) { console.error("query: predicate requires field, operator, value"); process.exitCode = 1; return; }
      const field = tokens[i]; i++;
      const op = tokens[i]; i++;
      const value = tokens[i]; i++;
      const validOps = ["=", "!=", "<", "<=", ">", ">=", "contains", "between"];
      if (!validOps.includes(op)) { console.error("query: unknown operator " + op); process.exitCode = 1; return; }
      predicates.push({ field, op, value });
      if (tokens[i] === "and") { i++; continue; }
    }
  } else {
    console.error("query: expression must start with \"where\"");
    process.exitCode = 1;
    return;
  }

  let result = runs.filter((row) => {
    return predicates.every(({ field, op, value }) => {
      const v = getNestedValue(row, field);
      return evaluatePredicate(v, op, value);
    });
  });

  if (sortField) {
    result.sort((a, b) => {
      const aV = getNestedValue(a, sortField);
      const bV = getNestedValue(b, sortField);
      const aN = Number(aV), bN = Number(bV);
      const cmp = isNaN(aN) || isNaN(bN) ? String(aV).localeCompare(String(bV)) : aN - bN;
      return sortDir === "desc" ? -cmp : cmp;
    });
  }

  result = result.slice(0, limitCount);

  if (fmt === "jsonl") {
    for (const row of result) {
      process.stdout.write(JSON.stringify(row) + "\n");
    }
    return;
  }

  const allKeys = new Set(["id", "status", "timestamp", "value"]);
  for (const row of (result.length ? result : runs)) {
    if (row.metrics) for (const k of Object.keys(row.metrics)) allKeys.add("metrics." + k);
    if (row.params) for (const k of Object.keys(row.params)) allKeys.add("params." + k);
  }
  for (const { field } of predicates) allKeys.add(field);
  if (sortField) allKeys.add(sortField);
  const cols = Array.from(allKeys);

  const lines = [];
  lines.push("| " + cols.join(" | ") + " |");
  lines.push("| " + cols.map(() => "---").join(" | ") + " |");
  for (const row of result) {
    lines.push("| " + cols.map((c) => {
      const v = c === "id" ? row.id : c === "status" ? row.status : c === "timestamp" ? (row.timestamp || "") : getNestedValue(row, c);
      return v != null ? String(v) : "";
    }).join(" | ") + " |");
  }
  console.log(lines.join("\n"));
}

function cmdTopic() {
  const cwd = targetDir();
  const mode = option("--mode", "propose");
  const doWrite = hasFlag("--write");
  const positional = positionalText();

  const topicText = positional || option("--topic", "");
  if (!topicText && !hasFlag("--topic")) {
    console.error("Usage: autoresearch topic "<text>" [--mode propose|novel|autonomous] [--dir PATH] [--write]");
    process.exitCode = 1;
    return;
  }

  // Autonomy mode requires locked baseline
  if (mode === "autonomous") {
    const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
    if (!fs.existsSync(lockFile)) {
      console.error("topic: --mode autonomous requires a locked baseline. Run `autoresearch baseline --lock` first.");
      process.exitCode = 1;
      return;
    }
  }

  const { output, slug, baselineState } = buildTopicNote({ cwd, topicText, mode });

  if (doWrite) {
    const topicsDir = path.join(cwd, ".researchloop", "scratchpad", "topics");
    if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });
    const outPath = path.join(topicsDir, slug + ".md");
    fs.writeFileSync(outPath, `${output}\n`);
    console.log("Topic note written to: " + outPath);
    if (mode === "autonomous" && baselineState !== "complete") {
      console.log("WARNING: baseline is " + baselineState + " — autonomous mode may not behave correctly.");
    }
  } else {
    process.stdout.write(`${output}\n`);
  }
}

async function cmdPropose() {
  return cmdProposeEngine({ option, hasFlag, targetDir });
}

function cmdRank() {
  return cmdRankEngine({ option, hasFlag, targetDir });
}

function cmdPriors() {
  return cmdPriorsEngine({ option, hasFlag, targetDir });
}

async function cmdEval() {
  return cmdEvalEngine({ option, hasFlag, targetDir });
}

function splitInlineList(text) {
  const out = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    if (ch === "]" || ch === "}") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function parseYamlScalar(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineList(inner).map(parseYamlScalar);
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^(null|none)$/i.test(text)) return null;
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

function stripYamlComment(line) {
  let quote = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote && line[i - 1] !== "\\") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseSimpleYaml(text) {
  const lines = String(text || "")
    .replace(/\t/g, "  ")
    .split(/\r?\n/)
    .map((line) => {
      const stripped = stripYamlComment(line).replace(/\s+$/, "");
      return {
        indent: stripped.match(/^ */)?.[0].length || 0,
        text: stripped.trim(),
      };
    })
    .filter((line) => line.text);

  function splitKeyValue(textValue) {
    const idx = textValue.indexOf(":");
    if (idx === -1) return [textValue.trim(), ""];
    return [textValue.slice(0, idx).trim(), textValue.slice(idx + 1).trim()];
  }

  function parseBlock(start, indent) {
    if (start >= lines.length) return [{}, start];
    const asList = lines[start].indent === indent && lines[start].text.startsWith("- ");
    if (asList) {
      const arr = [];
      let i = start;
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        const itemText = lines[i].text.slice(2).trim();
        if (!itemText) {
          const [child, next] = parseBlock(i + 1, indent + 2);
          arr.push(child);
          i = next;
          continue;
        }
        if (itemText.includes(":") && !itemText.startsWith('"') && !itemText.startsWith("'")) {
          const [key, value] = splitKeyValue(itemText);
          const item = {};
          item[key] = value ? parseYamlScalar(value) : {};
          i += 1;
          while (i < lines.length && lines[i].indent > indent) {
            const [child, next] = parseBlock(i, lines[i].indent);
            if (child && typeof child === "object" && !Array.isArray(child)) {
              Object.assign(item, child);
            }
            i = next;
          }
          arr.push(item);
        } else {
          arr.push(parseYamlScalar(itemText));
          i += 1;
        }
      }
      return [arr, i];
    }

    const obj = {};
    let i = start;
    while (i < lines.length && lines[i].indent >= indent) {
      if (lines[i].indent > indent) break;
      if (lines[i].text.startsWith("- ")) break;
      const [key, value] = splitKeyValue(lines[i].text);
      if (!key) {
        i += 1;
        continue;
      }
      if (value) {
        obj[key] = parseYamlScalar(value);
        i += 1;
      } else {
        const [child, next] = parseBlock(i + 1, indent + 2);
        obj[key] = child;
        i = next;
      }
    }
    return [obj, i];
  }

  const [parsed] = parseBlock(0, lines[0]?.indent || 0);
  return parsed;
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quote = false;
  const source = `${String(text || "").replace(/\r\n/g, "\n")}\n`;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quote = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quote = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  return rows;
}

function coerceCsvValue(value) {
  const text = String(value || "").trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  return text;
}

function parseCsvSweepSpec(text, overrides = {}) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) {
    throw new Error("CSV sweep spec must include a header row and at least one data row");
  }
  const headers = rows[0].map((h) => String(h || "").trim()).filter(Boolean);
  if (!headers.length) throw new Error("CSV sweep spec header is empty");
  const variants = rows.slice(1).map((values, index) => {
    const params = {};
    let id = "";
    headers.forEach((header, col) => {
      const value = coerceCsvValue(values[col]);
      if (header === "id") id = String(value || "").trim();
      else params[header] = value;
    });
    return id ? { id, params } : { id: `row-${index + 1}`, params };
  });
  return {
    version: 1,
    name: overrides.name || "csv-sweep",
    metric: overrides.metric || "val_loss",
    direction: overrides.direction || "lower",
    command_template: overrides.command_template || overrides.commandTemplate || "",
    variants,
  };
}

function parseSweepSpec(text, overrides = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("sweep spec is empty");
  }
  let parsed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`sweep spec must be valid JSON (parse error: ${err.message})`);
    }
  } else if (/^[^\n,]+,[^\n]+(?:\n|$)/.test(trimmed) && !/^\s*(version|name|metric|grid|variants|command_template)\s*:/m.test(trimmed)) {
    parsed = parseCsvSweepSpec(trimmed, overrides);
  } else {
    parsed = parseSimpleYaml(trimmed);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sweep spec must be an object");
  }
  return parsed;
}

function sanitizeIdPart(value, fallback = "item") {
  const cleaned = String(value || fallback).trim().replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  return cleaned || fallback;
}

function extractPlaceholders(template) {
  const names = new Set();
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match;
  while ((match = re.exec(String(template || ""))) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

function normalizeSweepVariant(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { id: "", params: { value: raw }, index };
  }
  if (raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)) {
    return { id: raw.id ? sanitizeIdPart(raw.id) : "", params: { ...raw.params }, index };
  }
  const params = { ...raw };
  const id = params.id ? sanitizeIdPart(params.id) : "";
  delete params.id;
  return { id, params, index };
}

function expandSweepVariants(spec) {
  if (Array.isArray(spec.variants) && spec.variants.length) {
    return spec.variants.map((v, i) => normalizeSweepVariant(v, i));
  }
  if (spec.grid && typeof spec.grid === "object" && !Array.isArray(spec.grid)) {
    const axes = Object.entries(spec.grid);
    if (!axes.length) return [];
    let combos = [{}];
    for (const [key, values] of axes) {
      if (!Array.isArray(values)) {
        throw new Error(`sweep grid axis "${key}" must be a list`);
      }
      const next = [];
      for (const combo of combos) {
        for (const v of values) {
          next.push({ ...combo, [key]: v });
        }
      }
      combos = next;
    }
    return combos.map((params, index) => ({ id: "", params, index }));
  }
  throw new Error("sweep spec must define either `variants` (list) or `grid` (object)");
}

function renderSweepCommand(template, params) {
  let out = String(template || "");
  for (const [key, value] of Object.entries(params || {})) {
    const re = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
    out = out.replace(re, String(value));
  }
  return out;
}

function normalizeQueueMaxParallel(value, fallback = 1) {
  const parsed = Math.floor(Number(value ?? fallback));
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : Math.floor(Number(fallback) || 1);
  return Math.max(1, Math.min(256, safe));
}

function booleanFromInput(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "y", "on", "enabled"].includes(text)) return true;
  if (["0", "false", "no", "n", "off", "disabled"].includes(text)) return false;
  return Boolean(fallback);
}

function normalizeQueueStabilityConfig(raw = {}, opts = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const hasEnabled = hasOwn(source, "enabled") || hasOwn(source, "auto");
  const enabled = booleanFromInput(
    source.enabled ?? source.auto ?? opts.enabled,
    Boolean(opts.defaultEnabled && (source.top_k || source.topK || source.repeats || opts.topK || opts.repeats))
  );
  const topK = Math.max(1, Math.min(50, Math.floor(Number(source.top_k ?? source.topK ?? opts.topK ?? 5) || 5)));
  const repeats = Math.max(1, Math.min(25, Math.floor(Number(source.repeats ?? source.repeat ?? opts.repeats ?? 3) || 3)));
  const aggregate = String(source.aggregate || opts.aggregate || "median").trim().toLowerCase();
  const retestParallel = normalizeQueueMaxParallel(source.retest_parallel ?? source.retestParallel ?? opts.retestParallel ?? 1);
  return {
    enabled,
    top_k: topK,
    repeats,
    aggregate: aggregate === "mean" ? "mean" : "median",
    retest_parallel: retestParallel,
  };
}

function bytesToGiB(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / (1024 ** 3);
}

function projectLooksLikeMlx(context = {}) {
  const haystack = [
    context.benchmarkCommand,
    context.commandTemplate,
    context.sweepName,
    context.buildSystem,
    ...(Array.isArray(context.languages) ? context.languages : []),
    ...(Array.isArray(context.markers) ? context.markers : []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\bmlx\b|mps|apple gpu|run_m1_safe_ops|mlx[_-]?benchmark/.test(haystack);
}

function recommendedQueueParallelism(system = {}, context = {}) {
  const cpuCount = Math.max(1, Math.floor(Number(system.cpu?.count) || os.cpus()?.length || 1));
  const cpuUsagePct = clampPct(system.cpu?.usagePct ?? 0);
  const totalMemGiB = bytesToGiB(system.memory?.totalBytes ?? os.totalmem());
  const memUsagePct = clampPct(system.memory?.usagePct ?? 0);
  const freeMemGiB = bytesToGiB(system.memory?.freeBytes ?? os.freemem());
  const gpu = system.gpu || {};
  const languages = Array.isArray(context.languages) ? context.languages.map((item) => String(item).toLowerCase()) : [];
  const devicePool = normalizeQueueDevicePool(context.devicePool || context.cudaVisibleDevices || "");
  const isCudaProject = languages.includes("cuda") || languages.includes("triton") || /\bcuda\b|triton/i.test(String(context.commandTemplate || context.benchmarkCommand || ""));
  const isMlxProject = projectLooksLikeMlx(context) || (process.platform === "darwin" && gpu.present && String(system.compute?.effective || "") === "mps");

  const cpuSlots = normalizeQueueMaxParallel(Math.max(1, Math.floor(cpuCount * 0.75) - (cpuCount >= 8 ? 1 : 0)));
  let memorySlots = 1;
  if (totalMemGiB >= 64) memorySlots = 16;
  else if (totalMemGiB >= 32) memorySlots = 8;
  else if (totalMemGiB >= 16) memorySlots = 4;
  else if (totalMemGiB >= 8) memorySlots = 2;

  const pressureHigh = cpuUsagePct >= 90 || memUsagePct >= 96 || (freeMemGiB > 0 && freeMemGiB < 0.5);
  let maxParallel = 1;
  let mode = "cpu";
  let reason = "CPU and memory capacity";
  let gpuSlots = 0;

  if (gpu.present && gpu.source === "nvidia-smi") {
    gpuSlots = Math.max(1, devicePool.length || Math.floor(Number(gpu.count) || 1));
    maxParallel = gpuSlots;
    mode = "nvidia_gpu";
    reason = "one worker per visible NVIDIA GPU";
  } else if (isMlxProject || (process.platform === "darwin" && gpu.present)) {
    gpuSlots = 1;
    maxParallel = Math.max(1, Math.min(cpuSlots, memorySlots));
    mode = "apple_unified";
    reason = "Apple unified-memory GPU shares CPU and RAM capacity";
  } else if (isCudaProject && !gpu.present) {
    maxParallel = 1;
    mode = "cuda_unavailable";
    reason = "CUDA-like project but no local NVIDIA GPU was detected";
  } else {
    maxParallel = Math.max(1, Math.min(cpuSlots, memorySlots, 8));
  }

  if (pressureHigh && maxParallel > 1) {
    maxParallel = Math.max(1, Math.floor(maxParallel / 2));
    reason = `${reason}; reduced because current CPU or memory pressure is high`;
  }

  return {
    max_parallel: normalizeQueueMaxParallel(maxParallel),
    mode,
    reason,
    cpu_slots: cpuSlots,
    memory_slots: memorySlots,
    gpu_slots: gpuSlots,
    cpu_count: cpuCount,
    cpu_usage_pct: cpuUsagePct,
    memory_total_gib: Number(totalMemGiB.toFixed(1)),
    memory_free_gib: Number(freeMemGiB.toFixed(1)),
    memory_usage_pct: memUsagePct,
  };
}

function normalizeQueueDevicePool(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item).trim()).filter(Boolean);
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  return text.split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean);
}

function sweepQueueRoot(cwd) {
  return path.join(cwd, ".researchloop", "scratchpad", "queues");
}

function sweepQueueArchiveRoot(cwd) {
  return path.join(cwd, ".researchloop", "scratchpad", "queues-archive");
}

function sweepQueueDir(cwd, queueId) {
  return path.join(sweepQueueRoot(cwd), sanitizeIdPart(queueId, "queue"));
}

function sweepQueueStatePath(cwd, queueId) {
  return path.join(sweepQueueDir(cwd, queueId), "state.json");
}

function sweepReportDir(cwd, queueId) {
  return path.join(cwd, ".researchloop", "scratchpad", "sweeps", sanitizeIdPart(queueId, "queue"));
}

function sweepReportArchiveRoot(cwd) {
  return path.join(cwd, ".researchloop", "scratchpad", "sweeps-archive");
}

function uniqueArchivePath(root, queueId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${sanitizeIdPart(queueId, "queue")}-${stamp}`;
  let candidate = path.join(root, base);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    suffix += 1;
    candidate = path.join(root, `${base}-${suffix}`);
  }
  return candidate;
}

function archiveDirectoryIfExists(cwd, sourceDir, archiveRoot, queueId) {
  if (!fs.existsSync(sourceDir)) return null;
  ensureDir(archiveRoot);
  const archivedDir = uniqueArchivePath(archiveRoot, queueId);
  fs.renameSync(sourceDir, archivedDir);
  return path.relative(cwd, archivedDir);
}

function appendQueueEvent(cwd, queueId, event, fields = {}) {
  const dir = sweepQueueDir(cwd, queueId);
  ensureDir(dir);
  const row = { ts: new Date().toISOString(), event, queue_id: queueId, ...fields };
  fs.appendFileSync(path.join(dir, "events.jsonl"), `${JSON.stringify(row)}\n`);
  return row;
}

function terminalQueueTrialStatus(status) {
  return ["complete", "complete_no_metric", "failed", "timeout", "skipped", "cancelled", "blocked", "spawn_error", "killed_by_safety", "no_command"].includes(String(status || ""));
}

function queueCounts(trials) {
  const counts = {
    total: Array.isArray(trials) ? trials.length : 0,
    pending: 0,
    running: 0,
    complete: 0,
    failed: 0,
    timeout: 0,
    skipped: 0,
    cancelled: 0,
    retrying: 0,
    complete_no_metric: 0,
  };
  for (const trial of trials || []) {
    const status = String(trial.status || "pending");
    if (hasOwn(counts, status)) counts[status] += 1;
    else if (status === "spawn_error" || status === "blocked" || status === "killed_by_safety" || status === "no_command") counts.failed += 1;
  }
  return counts;
}

function queueBest(trials, metric, direction) {
  const preferHigher = String(direction || "").toLowerCase() === "higher";
  const scored = (trials || [])
    .filter((trial) => String(trial.status || "") === "complete" && isNumericMetric(trial.metrics?.[metric]))
    .map((trial) => ({ run_id: trial.run_id, metric, value: Number(trial.metrics[metric]), params: trial.params || {} }))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  return scored[0] || null;
}

function stableBestFromState(state) {
  const stable = state?.stability?.stable_best;
  if (!stable?.run_id || !isNumericMetric(stable.value)) return null;
  return {
    run_id: stable.run_id,
    metric: stable.metric || state.metric,
    value: Number(stable.value),
    params: stable.params || {},
    source: "stability_median",
    original_value: stable.original_value ?? null,
    repeats: stable.repeats ?? null,
    retest_run_ids: stable.retest_run_ids || [],
  };
}

function refreshQueueStateShape(state) {
  const trials = Array.isArray(state.trials) ? state.trials : [];
  const reportedCounts = state.reported_counts && typeof state.reported_counts === "object" && !Array.isArray(state.reported_counts)
    ? state.reported_counts
    : null;
  const reportedBest = state.reported_best && typeof state.reported_best === "object" && !Array.isArray(state.reported_best)
    ? state.reported_best
    : null;
  const next = {
    ...state,
    trials,
    counts: reportedCounts || queueCounts(trials),
    best: reportedBest || stableBestFromState(state) || queueBest(trials, state.metric, state.direction),
    updated_at: new Date().toISOString(),
  };
  return next;
}

function compactQueueForDashboard(state, limit = 20) {
  const trials = Array.isArray(state?.trials) ? state.trials : [];
  if (trials.length <= limit) return state;
  return {
    ...state,
    trials: trials.slice(0, limit),
    preview_count: limit,
    total_trials: state.counts?.total || trials.length,
  };
}

function writeQueueState(cwd, state) {
  const queueId = sanitizeIdPart(state.queue_id, "queue");
  const dir = sweepQueueDir(cwd, queueId);
  ensureDir(dir);
  const next = refreshQueueStateShape({ ...state, queue_id: queueId });
  fs.writeFileSync(path.join(dir, "state.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function readQueueState(cwd, queueId) {
  const file = sweepQueueStatePath(cwd, queueId);
  if (!fs.existsSync(file)) {
    throw new Error(`queue not found: ${queueId}`);
  }
  return refreshQueueStateShape(JSON.parse(fs.readFileSync(file, "utf8")));
}

function listSweepQueues(cwd, limit = 10) {
  const root = sweepQueueRoot(cwd);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = path.join(root, entry.name, "state.json");
      try {
        const stat = fs.statSync(file);
        return { state: refreshQueueStateShape(JSON.parse(fs.readFileSync(file, "utf8"))), mtimeMs: stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((entry) => compactQueueForDashboard(entry.state));
}

function archiveSweepQueue(cwd, queueId) {
  const safeQueueId = sanitizeIdPart(queueId, "queue");
  const activeDir = sweepQueueDir(cwd, safeQueueId);
  const stateFile = path.join(activeDir, "state.json");
  if (!fs.existsSync(stateFile)) {
    throw new Error(`queue not found: ${queueId}`);
  }

  let cancelledState = null;
  try {
    cancelledState = writeQueueState(cwd, { ...readQueueState(cwd, safeQueueId), status: "cancelled" });
    appendQueueEvent(cwd, safeQueueId, "queue_delete_requested");
    writeQueueSummary(cwd, cancelledState);
  } catch {
    appendQueueEvent(cwd, safeQueueId, "queue_delete_requested");
  }

  const archivedQueue = archiveDirectoryIfExists(cwd, activeDir, sweepQueueArchiveRoot(cwd), safeQueueId);
  const archivedReport = archiveDirectoryIfExists(cwd, sweepReportDir(cwd, safeQueueId), sweepReportArchiveRoot(cwd), safeQueueId);
  const thread = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  ensureDir(path.dirname(thread));
  fs.appendFileSync(thread, `- ${new Date().toISOString()} archived sweep queue ${safeQueueId}${archivedQueue ? ` queue=${archivedQueue}` : ""}${archivedReport ? ` report=${archivedReport}` : ""}\n`);
  return {
    queueId: safeQueueId,
    archivedQueue,
    archivedReport,
    queue: cancelledState,
  };
}

function buildSweepSpecFromDashboardBody(body, cwd = process.cwd()) {
  const specText = String(body.specText || body.sweepSpec || "").trim();
  const overrides = {
    name: String(body.sweepName || body.name || "").trim(),
    metric: String(body.metric || "").trim(),
    direction: String(body.direction || "").trim(),
    command_template: String(body.commandTemplate || body.sweepTemplate || "").trim(),
  };
  let spec = specText ? parseSweepSpec(specText, overrides) : {};
  spec = { ...spec };
  if (overrides.name) spec.name = overrides.name;
  if (overrides.metric) spec.metric = overrides.metric;
  if (overrides.direction) spec.direction = overrides.direction;
  if (overrides.command_template) spec.command_template = overrides.command_template;
  if (!specText && body.sweepGrid) {
    const parsed = parseSweepSpec(JSON.stringify({ grid: JSON.parse(String(body.sweepGrid)) }), overrides);
    spec = { ...spec, ...parsed };
  }
  if (!specText && body.paramGrid) {
    let grid;
    try {
      grid = JSON.parse(String(body.paramGrid));
    } catch (err) {
      throw new Error(`参数网格 JSON 无法解析：${err.message}`);
    }
    const maxRuns = Math.max(1, Number(body.maxRuns || body.batchMaxRuns || 24) || 24);
    const expanded = expandSweepVariants({ grid }).slice(0, maxRuns);
    spec = {
      ...spec,
      variants: expanded.map((variant, index) => ({
        id: variant.id || `v${String(index + 1).padStart(3, "0")}`,
        params: variant.params,
      })),
    };
  }
  if (body.maxRuns) {
    spec.budget = { ...(spec.budget || {}), max_runs: Number(body.maxRuns) };
  }
  const maxParallel = body.maxParallel || body.batchMaxParallel || "";
  if (maxParallel) {
    spec.max_parallel = Number(maxParallel);
  }
  const devicePool = String(body.devicePool || body.batchDevicePool || body.cudaVisibleDevices || spec.cuda_visible_devices || "").trim();
  if (devicePool) {
    spec.cuda_visible_devices = devicePool;
  }
  const wantsAutoMaxParallel = String(body.autoMaxParallel || body.batchAutoMaxParallel || "").toLowerCase() === "true";
  const hasSpecMaxParallel = spec.max_parallel != null || spec.maxParallel != null;
  if (!maxParallel && (!hasSpecMaxParallel || wantsAutoMaxParallel)) {
    const system = readSystemMetrics(cwd);
    const parallelism = recommendedQueueParallelism(system, {
      commandTemplate: spec.command_template || spec.command || overrides.command_template,
      sweepName: spec.name || overrides.name,
      devicePool,
      cudaVisibleDevices: devicePool,
    });
    spec.max_parallel = parallelism.max_parallel;
  }
  if (body.maxRetries) {
    spec.retry = { ...(spec.retry || {}), max_retries: Number(body.maxRetries) };
  }
  const stabilityEnabledInput = body.stabilityEnabled ?? body.batchStabilityEnabled ?? body.retestEnabled ?? body.batchRetestEnabled;
  const stabilityTopKInput = body.stabilityTopK ?? body.batchStabilityTopK ?? body.retestTopK ?? body.batchRetestTopK;
  const stabilityRepeatsInput = body.stabilityRepeats ?? body.batchStabilityRepeats ?? body.retestRepeats ?? body.batchRetestRepeats;
  const hasStabilityBody = stabilityEnabledInput != null || stabilityTopKInput != null || stabilityRepeatsInput != null;
  if (hasStabilityBody || spec.stability) {
    spec.stability = normalizeQueueStabilityConfig(spec.stability || {}, {
      enabled: stabilityEnabledInput,
      topK: stabilityTopKInput,
      repeats: stabilityRepeatsInput,
      aggregate: body.stabilityAggregate || body.batchStabilityAggregate || "median",
      defaultEnabled: hasStabilityBody,
    });
  }
  return spec;
}

function validateSweepSpec(spec, cwd, opts = {}) {
  const errors = [];
  const warnings = [];
  const name = sanitizeIdPart(spec.name || opts.name || "sweep", "sweep");
  const metric = String(spec.metric || opts.metric || "val_loss").trim();
  const directionRaw = String(spec.direction || opts.direction || "lower").trim().toLowerCase();
  const direction = directionRaw === "higher" || directionRaw === "max" || directionRaw === "maximize" ? "higher" : "lower";
  const commandTemplate = String(spec.command_template || spec.command || opts.command_template || "").trim();
  if (!name) errors.push("`name` is required");
  if (!metric) errors.push("`metric` is required");
  if (!["lower", "higher", "min", "max", "minimize", "maximize"].includes(directionRaw || "lower")) {
    errors.push("`direction` must be lower or higher");
  }
  if (!commandTemplate) errors.push("`command_template` is required");

  let variants = [];
  try {
    variants = expandSweepVariants(spec);
  } catch (err) {
    errors.push(err.message);
  }
  if (!variants.length) errors.push("sweep spec produced 0 variants");

  const maxRuns = Number(spec.budget?.max_runs ?? spec.max_runs ?? opts.maxRuns ?? 500);
  if (Number.isFinite(maxRuns) && variants.length > maxRuns) {
    errors.push(`expanded variants ${variants.length} exceeds max_runs ${maxRuns}`);
  }

  const placeholders = extractPlaceholders(commandTemplate);
  const duplicateIds = new Set();
  const seenIds = new Set();
  const preview = [];
  const safetyPolicy = loadSafetyPolicy(cwd);
  for (const variant of variants) {
    const params = variant.params || {};
    const missing = placeholders.filter((namePart) => !hasOwn(params, namePart));
    if (missing.length) {
      errors.push(`variant ${variant.index + 1} missing placeholder params: ${missing.join(", ")}`);
    }
    const runSuffix = variant.id || `v${String(variant.index + 1).padStart(3, "0")}`;
    const runId = `${name}-${runSuffix}`;
    if (seenIds.has(runId)) duplicateIds.add(runId);
    seenIds.add(runId);
    const commandText = renderSweepCommand(commandTemplate, params);
    const safety = evaluateCommandSafety(commandText, safetyPolicy);
    if (!opts.allowUnsafe && !safety.allowed) {
      errors.push(`variant ${variant.index + 1} command blocked by safety rule ${safety.rule}: ${safety.message}`);
    }
    if (/[;&|`$<>]/.test(commandText)) {
      warnings.push(`variant ${variant.index + 1} command contains shell metacharacters; review before running`);
    }
    preview.push({ index: variant.index, id: variant.id || "", run_id: runId, params, command: commandText, status: "pending" });
  }
  if (duplicateIds.size) {
    errors.push(`duplicate run id(s): ${[...duplicateIds].join(", ")}`);
  }

  const maxParallel = normalizeQueueMaxParallel(spec.max_parallel ?? spec.maxParallel ?? opts.maxParallel ?? 1);
  const devicePool = normalizeQueueDevicePool(
    spec.cuda_visible_devices ?? spec.device_pool ?? spec.gpu_devices ?? spec.devices ?? opts.cudaVisibleDevices ?? opts.devicePool ?? ""
  );
  const stability = normalizeQueueStabilityConfig(spec.stability || {}, {
    enabled: opts.stabilityEnabled,
    topK: opts.stabilityTopK,
    repeats: opts.stabilityRepeats,
    aggregate: opts.stabilityAggregate || "median",
    defaultEnabled: false,
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings: [...new Set(warnings)],
    spec: {
      ...spec,
      name,
      metric,
      direction,
      command_template: commandTemplate,
      max_parallel: maxParallel,
      ...(devicePool.length ? { cuda_visible_devices: devicePool.join(","), device_pool: devicePool } : {}),
      timeout_seconds: Number(spec.timeout_seconds || spec.timeout || opts.timeout || 600) || 600,
      stability,
    },
    variants: preview,
    count: preview.length,
    placeholders,
  };
}

function createSweepQueue(cwd, spec, opts = {}) {
  const validation = validateSweepSpec(spec, cwd, opts);
  if (!validation.ok) {
    const err = new Error(validation.errors.join("; "));
    err.validation = validation;
    throw err;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const queueId = sanitizeIdPart(opts.queueId || `${validation.spec.name}-${stamp}`, "queue");
  const dir = sweepQueueDir(cwd, queueId);
  ensureDir(dir);
  const now = new Date().toISOString();
  const trials = validation.variants.map((variant, idx) => ({
    run_id: variant.run_id.replace(new RegExp(`^${validation.spec.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-`), `${queueId}-`),
    queue_id: queueId,
    index: idx + 1,
    variant_id: variant.id || "",
    status: "pending",
    params: variant.params,
    command: variant.command,
    metrics: {},
    log: null,
    started_at: null,
    finished_at: null,
    retry_count: 0,
  }));
  const state = writeQueueState(cwd, {
    queue_id: queueId,
    name: validation.spec.name,
    description: String(validation.spec.description || ""),
    status: "pending",
    metric: validation.spec.metric,
    direction: validation.spec.direction,
    command_template: validation.spec.command_template,
    created_at: now,
    updated_at: now,
    max_parallel: validation.spec.max_parallel,
    cuda_visible_devices: validation.spec.cuda_visible_devices || "",
    device_pool: validation.spec.device_pool || [],
    timeout_seconds: validation.spec.timeout_seconds,
    retry: validation.spec.retry || { max_retries: 0 },
    stability: {
      ...(validation.spec.stability || normalizeQueueStabilityConfig()),
      status: validation.spec.stability?.enabled ? "pending" : "disabled",
      candidates: [],
      stable_best: null,
    },
    budget: validation.spec.budget || {},
    runner: validation.spec.runner || null,
    tags: Array.isArray(validation.spec.tags) ? validation.spec.tags : [],
    spec: validation.spec,
    warnings: validation.warnings,
    trials,
  });
  fs.writeFileSync(path.join(dir, "queue.yaml"), `${JSON.stringify(validation.spec, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, "queue.json"), `${JSON.stringify(validation.spec, null, 2)}\n`);
  appendQueueEvent(cwd, queueId, "queue_created", { total: trials.length });
  writeQueueSummary(cwd, state);
  return { queueId, dir, state, validation };
}

function updateQueueTrial(state, runId, patch) {
  return {
    ...state,
    trials: (state.trials || []).map((trial) => trial.run_id === runId ? { ...trial, ...patch } : trial),
  };
}

function retryableTrialStatus(status) {
  return ["failed", "timeout", "spawn_error", "killed_by_safety", "blocked", "no_command", "complete_no_metric"].includes(String(status || ""));
}

function metricStats(values) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return null;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  const variance = finite.reduce((a, b) => a + (b - mean) ** 2, 0) / finite.length;
  const mid = Math.floor(finite.length / 2);
  const median = finite.length % 2 ? finite[mid] : (finite[mid - 1] + finite[mid]) / 2;
  return {
    min: finite[0],
    max: finite[finite.length - 1],
    mean: Number(mean.toFixed(6)),
    median: Number(median.toFixed(6)),
    std: Number(Math.sqrt(variance).toFixed(6)),
  };
}

function paramsWithoutSeed(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (String(key).toLowerCase() !== "seed") out[key] = value;
  }
  return out;
}

function sweepSafeName(value, fallback = "sweep") {
  const out = String(value || fallback)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || fallback;
}

function sweepStableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sweepStableValue(item));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sweepStableValue(value[key]);
    }
    return out;
  }
  return value;
}

function sweepStableJson(value) {
  return JSON.stringify(sweepStableValue(value));
}

function sweepHash(value, length = 10) {
  return createHash("sha256").update(sweepStableJson(value)).digest("hex").slice(0, length);
}

function splitSweepParts(text, separator = ",") {
  const parts = [];
  let current = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "{" || ch === "[") depth += 1;
    if (ch === "}" || ch === "]") depth -= 1;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseSweepScalar(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
    return Number(text);
  }
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (/^\[.*\]$/.test(text)) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return splitSweepParts(inner, ",").map((part) => parseSweepScalar(part));
  }
  if (/^\{.*\}$/.test(text)) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return {};
    const obj = {};
    for (const part of splitSweepParts(inner, ",")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const key = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
      const value = part.slice(idx + 1).trim();
      obj[key] = parseSweepScalar(value);
    }
    return obj;
  }
  return text;
}

function parseSweepYaml(text) {
  const out = {};
  let section = null;
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(rawLine)) {
      const top = rawLine.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (!top) continue;
      const key = top[1];
      const rest = top[2].trim();
      if (rest) {
        out[key] = parseSweepScalar(rest);
        section = null;
      } else {
        section = key;
        if (key === "variants") out[key] = [];
        else if (key === "params" || key === "grid") out[key] = {};
        else out[key] = {};
      }
      continue;
    }
    if (section === "params" || section === "grid") {
      const entry = rawLine.match(/^\s{2,}([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (entry) {
        out[section][entry[1]] = parseSweepScalar(entry[2]);
      }
      continue;
    }
    if (section === "variants") {
      const entry = rawLine.match(/^\s*-\s*(.*)$/);
      if (entry) {
        out.variants.push(parseSweepScalar(entry[1]));
      }
    }
  }
  return out;
}

function analyzeSeedGroups(trials, metric) {
  const groups = new Map();
  for (const trial of trials || []) {
    if (!isNumericMetric(trial.metrics?.[metric])) continue;
    const key = JSON.stringify(paramsWithoutSeed(trial.params || {}));
    if (!groups.has(key)) groups.set(key, { params: paramsWithoutSeed(trial.params || {}), values: [], run_ids: [] });
    const group = groups.get(key);
    group.values.push(Number(trial.metrics[metric]));
    group.run_ids.push(trial.run_id);
  }
  return [...groups.values()]
    .filter((group) => group.values.length > 1)
    .map((group) => ({ ...group, stats: metricStats(group.values) }));
}

function estimateParamImportance(trials, metric, direction) {
  const preferHigher = String(direction || "").toLowerCase() === "higher";
  const completed = (trials || []).filter((trial) => isNumericMetric(trial.metrics?.[metric]));
  const keys = new Set(completed.flatMap((trial) => Object.keys(trial.params || {})));
  const rows = [];
  for (const key of keys) {
    const buckets = new Map();
    for (const trial of completed) {
      const valueKey = JSON.stringify(trial.params?.[key]);
      if (!buckets.has(valueKey)) buckets.set(valueKey, []);
      buckets.get(valueKey).push(Number(trial.metrics[metric]));
    }
    if (buckets.size < 2) continue;
    const bucketRows = [...buckets.entries()].map(([value, values]) => ({
      value: JSON.parse(value),
      mean: values.reduce((a, b) => a + b, 0) / values.length,
      n: values.length,
    }));
    const means = bucketRows.map((row) => row.mean);
    const spread = Math.max(...means) - Math.min(...means);
    bucketRows.sort((a, b) => preferHigher ? b.mean - a.mean : a.mean - b.mean);
    rows.push({
      param: key,
      spread: Number(spread.toFixed(6)),
      best_value: bucketRows[0]?.value,
      worst_value: bucketRows[bucketRows.length - 1]?.value,
      buckets: bucketRows.map((row) => ({ ...row, mean: Number(row.mean.toFixed(6)) })),
    });
  }
  return rows.sort((a, b) => b.spread - a.spread);
}

function analyzeSweepQueue(state) {
  const metric = state.metric || "val_loss";
  const preferHigher = String(state.direction || "").toLowerCase() === "higher";
  const scored = (state.trials || [])
    .filter((trial) => isNumericMetric(trial.metrics?.[metric]))
    .map((trial) => ({ run_id: trial.run_id, status: trial.status, value: Number(trial.metrics[metric]), params: trial.params || {}, wall_seconds: Number(trial.wall_seconds || 0) }))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  const failures = (state.trials || []).filter((trial) => retryableTrialStatus(trial.status) || trial.status === "complete_no_metric");
  const failureCounts = {};
  for (const trial of failures) {
    const key = String(trial.status || "failed");
    failureCounts[key] = (failureCounts[key] || 0) + 1;
  }
  const wallSeconds = (state.trials || []).reduce((sum, trial) => sum + (Number(trial.wall_seconds) || 0), 0);
  const failedWallSeconds = failures.reduce((sum, trial) => sum + (Number(trial.wall_seconds) || 0), 0);
  return {
    queue_id: state.queue_id,
    name: state.name,
    metric,
    direction: preferHigher ? "higher" : "lower",
    counts: state.counts,
    best: stableBestFromState(state) || scored[0] || null,
    single_run_best: scored[0] || null,
    stability: state.stability || null,
    top: scored.slice(0, 5),
    metric_stats: metricStats(scored.map((row) => row.value)),
    failures,
    failure_counts: failureCounts,
    seed_groups: analyzeSeedGroups(state.trials, metric),
    param_importance: estimateParamImportance(state.trials, metric, state.direction),
    budget: {
      wall_seconds: wallSeconds,
      avg_wall_seconds: state.trials?.length ? Number((wallSeconds / state.trials.length).toFixed(3)) : 0,
      failed_wall_seconds: failedWallSeconds,
    },
  };
}

function csvEscape(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeSweepReport(cwd, queueId) {
  const state = readQueueState(cwd, queueId);
  const analysis = analyzeSweepQueue(state);
  const sweepDir = path.join(cwd, ".researchloop", "scratchpad", "sweeps", state.queue_id);
  ensureDir(sweepDir);
  const summaryPath = path.join(sweepDir, "summary.json");
  const csvPath = path.join(sweepDir, "results.csv");
  const reportPath = path.join(sweepDir, "sweep-report.md");

  fs.writeFileSync(summaryPath, `${JSON.stringify({ ...analysis, state }, null, 2)}\n`);
  const csvHeaders = ["run_id", "status", state.metric, "wall_seconds", "retry_count", "params", "command", "log"];
  const csvRows = [csvHeaders.join(",")];
  for (const trial of state.trials || []) {
    csvRows.push([
      trial.run_id,
      trial.status,
      trial.metrics?.[state.metric] ?? "",
      trial.wall_seconds ?? "",
      trial.retry_count ?? 0,
      trial.params || {},
      trial.command || "",
      trial.log || "",
    ].map(csvEscape).join(","));
  }
  fs.writeFileSync(csvPath, `${csvRows.join("\n")}\n`);

  const lines = [
    "# Sweep Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Queue: \`${state.queue_id}\``,
    `Metric: \`${state.metric}\` (${analysis.direction === "higher" ? "higher is better" : "lower is better"})`,
    "",
    "## 1. 实验目标",
    "",
    state.description || `Run ${state.name} across ${state.counts.total} trial(s).`,
    "",
    "## 2. Sweep 配置",
    "",
    `- Command template: \`${state.command_template}\``,
    `- Max parallel: ${state.max_parallel || 1}`,
    `- Device pool: ${(state.device_pool || []).join(", ") || state.cuda_visible_devices || "not pinned"}`,
    `- Timeout seconds: ${state.timeout_seconds || "default"}`,
    `- Tags: ${(state.tags || []).join(", ") || "none"}`,
    "",
    "## 3. 实验矩阵",
    "",
    `Total variants: ${state.counts.total}`,
    "",
    "## 4. 执行摘要",
    "",
    markdownTable(["Status", "Count"], Object.entries(state.counts || {}).map(([key, value]) => [key, value])),
    "",
    "## 5. 最佳结果",
    "",
    analysis.best ? `Best run: \`${analysis.best.run_id}\` ${state.metric}=${analysis.best.value} params=\`${JSON.stringify(analysis.best.params)}\`${analysis.best.source === "stability_median" ? " (stable median)" : ""}` : "No scored run yet.",
    "",
    "## 6. 稳定复测",
    "",
    analysis.stability?.status === "complete" && Array.isArray(analysis.stability.candidates) && analysis.stability.candidates.length
      ? markdownTable(
        ["Source run", "Original", "Median", "Mean", "Std", "Repeats", "Retest runs"],
        analysis.stability.candidates.map((row) => [
          row.source_run_id,
          row.source_value,
          row.stats?.median ?? row.aggregate_value ?? "",
          row.stats?.mean ?? "",
          row.stats?.std ?? "",
          row.repeats || row.values?.length || 0,
          (row.retest_run_ids || []).join(" "),
        ])
      )
      : (analysis.stability?.enabled ? `Stability retest status: ${analysis.stability.status || "pending"}` : "Stability retest disabled."),
    "",
    "## 7. Top K",
    "",
    analysis.top.length
      ? markdownTable(["Run", state.metric, "Status", "Params"], analysis.top.map((row) => [row.run_id, row.value, row.status, `\`${JSON.stringify(row.params)}\``]))
      : "No scored runs yet.",
    "",
    "## 8. 参数影响分析",
    "",
    analysis.param_importance.length
      ? markdownTable(["Param", "Spread", "Best value", "Worst value"], analysis.param_importance.slice(0, 10).map((row) => [row.param, row.spread, JSON.stringify(row.best_value), JSON.stringify(row.worst_value)]))
      : "Not enough completed numeric results for parameter importance.",
    "",
    "## 9. 失败和异常",
    "",
    analysis.failures.length
      ? markdownTable(["Run", "Status", "Retries", "Log"], analysis.failures.map((trial) => [trial.run_id, trial.status, trial.retry_count || 0, trial.log || ""]))
      : "No failed trials recorded.",
    "",
    "## 10. 结论",
    "",
    analysis.best
      ? `Current best configuration is \`${JSON.stringify(analysis.best.params)}\`${analysis.best.source === "stability_median" ? " based on stability retest median." : "."}`
      : "Run the queue or fix metric parsing before drawing a conclusion.",
    "",
    "## 11. 下一步建议",
    "",
    analysis.failures.length
      ? "- Inspect failed logs, then use retry-failed after fixing the command or environment."
      : "- Narrow the next sweep around the best parameter region and keep the same metric contract.",
    analysis.seed_groups.length ? "- Seed groups are available; compare mean and std before promoting a setting." : "- Add a `seed` axis when variance matters.",
    "",
  ];
  fs.writeFileSync(reportPath, `${lines.join("\n")}\n`);
  return {
    report: path.relative(cwd, reportPath),
    summary: path.relative(cwd, summaryPath),
    results: path.relative(cwd, csvPath),
    analysis,
  };
}

function writeQueueSummary(cwd, state) {
  const dir = sweepQueueDir(cwd, state.queue_id);
  ensureDir(dir);
  const analysis = analyzeSweepQueue(state);
  const lines = [
    `# Queue ${state.queue_id}`,
    "",
    `Status: ${state.status}`,
    `Metric: ${state.metric} (${state.direction})`,
    `Total: ${state.counts.total}`,
    `Complete: ${state.counts.complete}`,
    `Failed: ${state.counts.failed}`,
    `Pending: ${state.counts.pending}`,
    "",
    analysis.best ? `Best: ${analysis.best.run_id} ${state.metric}=${analysis.best.value}${analysis.best.source === "stability_median" ? " (stable median)" : ""}` : "Best: not available yet",
    "",
  ];
  fs.writeFileSync(path.join(dir, "summary.md"), `${lines.join("\n")}\n`);
}

function resetFailedTrialsForRetry(cwd, queueId) {
  let state = readQueueState(cwd, queueId);
  let changed = 0;
  state = {
    ...state,
    status: "pending",
    trials: (state.trials || []).map((trial) => {
      if (!retryableTrialStatus(trial.status)) return trial;
      changed += 1;
      return {
        ...trial,
        status: "pending",
        metrics: {},
        started_at: null,
        finished_at: null,
        exit_code: null,
        wall_seconds: null,
      };
    }),
  };
  state = writeQueueState(cwd, state);
  appendQueueEvent(cwd, queueId, "queue_retry_failed", { changed });
  writeQueueSummary(cwd, state);
  return { changed, state };
}

function setQueueStatus(cwd, queueId, status, event) {
  const state = writeQueueState(cwd, { ...readQueueState(cwd, queueId), status });
  appendQueueEvent(cwd, queueId, event || `queue_${status}`);
  writeQueueSummary(cwd, state);
  return state;
}

function queueSchedulerLockPath(cwd, queueId) {
  return path.join(sweepQueueDir(cwd, queueId), "scheduler.lock");
}

function isProcessAlive(pid) {
  const parsed = Number(pid);
  if (!Number.isFinite(parsed) || parsed <= 0) return false;
  try {
    process.kill(parsed, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

function acquireQueueSchedulerLock(cwd, queueId) {
  const lockFile = queueSchedulerLockPath(cwd, queueId);
  ensureDir(path.dirname(lockFile));
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeSync(fd, `${JSON.stringify({ pid: process.pid, token, started_at: new Date().toISOString() })}\n`);
      } finally {
        fs.closeSync(fd);
      }
      return {
        acquired: true,
        release() {
          try {
            const current = JSON.parse(fs.readFileSync(lockFile, "utf8"));
            if (current.token === token) fs.unlinkSync(lockFile);
          } catch {
            // Best effort cleanup. A stale lock is handled on the next start.
          }
        },
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let current = null;
      try {
        current = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      } catch {
        current = null;
      }
      if (current?.pid && isProcessAlive(current.pid)) {
        return { acquired: false, lock: current, release() {} };
      }
      try {
        fs.unlinkSync(lockFile);
      } catch {
        // Another starter may have removed it.
      }
    }
  }
  return { acquired: false, lock: null, release() {} };
}

function queueDevicePool(state, opts = {}) {
  return normalizeQueueDevicePool(
    opts.cudaVisibleDevices ?? opts.devicePool ?? state.cuda_visible_devices ?? state.device_pool ?? state.spec?.cuda_visible_devices ?? state.spec?.device_pool ?? state.spec?.gpu_devices ?? state.spec?.devices ?? ""
  );
}

function queueWorkerEnv(workerId, workerSlot, cudaVisibleDevices) {
  const env = {
    RESEARCHLOOP_QUEUE_WORKER: String(workerId),
    RESEARCHLOOP_QUEUE_SLOT: String(workerSlot),
  };
  if (cudaVisibleDevices) {
    env.CUDA_VISIBLE_DEVICES = String(cudaVisibleDevices);
    env.RESEARCHLOOP_CUDA_VISIBLE_DEVICES = String(cudaVisibleDevices);
    env.RESEARCHLOOP_DEVICE = "cuda";
    env.RESEARCHLOOP_ACCELERATOR = "cuda";
  }
  return env;
}

function queueStabilityEnv(candidateRank, repeatIndex, cudaVisibleDevices) {
  return {
    ...queueWorkerEnv("stability", 1, cudaVisibleDevices),
    RESEARCHLOOP_QUEUE_STABILITY: "1",
    RESEARCHLOOP_STABILITY_CANDIDATE_RANK: String(candidateRank),
    RESEARCHLOOP_STABILITY_REPEAT: String(repeatIndex),
  };
}

function sortQueueTrialsByMetric(trials, metric, direction) {
  const preferHigher = String(direction || "").toLowerCase() === "higher";
  return (trials || [])
    .filter((trial) => String(trial.status || "") === "complete" && isNumericMetric(trial.metrics?.[metric]))
    .map((trial) => ({ trial, value: Number(trial.metrics[metric]) }))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
}

function queueStabilityCandidates(state, topK) {
  const seen = new Set();
  const candidates = [];
  for (const entry of sortQueueTrialsByMetric(state.trials || [], state.metric, state.direction)) {
    const key = JSON.stringify(entry.trial.params || {});
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      source_run_id: entry.trial.run_id,
      source_value: entry.value,
      params: entry.trial.params || {},
      command: entry.trial.command,
      cuda_visible_devices: entry.trial.cuda_visible_devices || null,
    });
    if (candidates.length >= topK) break;
  }
  return candidates;
}

function shouldRunQueueStability(state) {
  const stability = normalizeQueueStabilityConfig(state.stability || state.spec?.stability || {});
  if (!stability.enabled) return false;
  if (state.stability?.status === "complete") return false;
  if (state.stability?.status === "disabled") return false;
  if (state.status === "cancelled") return false;
  return Boolean(queueStabilityCandidates(state, stability.top_k).length);
}

function stableBestFromCandidates(state, candidates) {
  const metric = state.metric || "val_loss";
  const preferHigher = String(state.direction || "").toLowerCase() === "higher";
  const scored = (candidates || [])
    .filter((candidate) => isNumericMetric(candidate.aggregate_value))
    .map((candidate) => ({
      run_id: candidate.source_run_id,
      metric,
      value: Number(candidate.aggregate_value),
      params: candidate.params || {},
      source: "stability_median",
      original_value: candidate.source_value,
      repeats: candidate.repeats || 0,
      retest_run_ids: candidate.retest_run_ids || [],
      stats: candidate.stats || null,
    }))
    .sort((a, b) => preferHigher ? b.value - a.value : a.value - b.value);
  return scored[0] || null;
}

async function runQueueStabilityRetests(cwd, queueId, opts = {}) {
  let state = readQueueState(cwd, queueId);
  const stabilityConfig = normalizeQueueStabilityConfig(state.stability || state.spec?.stability || {});
  if (!stabilityConfig.enabled) {
    return writeQueueState(cwd, {
      ...state,
      stability: { ...stabilityConfig, status: "disabled", candidates: [], stable_best: null },
    });
  }
  const candidates = queueStabilityCandidates(state, stabilityConfig.top_k);
  if (!candidates.length) {
    return writeQueueState(cwd, {
      ...state,
      stability: { ...stabilityConfig, status: "skipped", reason: "no_numeric_top_candidates", candidates: [], stable_best: null },
    });
  }

  const metricName = state.metric || "val_loss";
  const timeoutSec = Number(state.timeout_seconds || 600) || 600;
  const allowUnsafe = opts.allowUnsafe || hasFlag("--allow-unsafe");
  const regexSource = state.spec?.regex || null;
  const devices = queueDevicePool(state, opts);
  const startedAt = new Date().toISOString();
  state = writeQueueState(cwd, {
    ...state,
    status: "stabilizing",
    stability: {
      ...stabilityConfig,
      status: "running",
      started_at: startedAt,
      candidates: candidates.map((candidate, index) => ({
        rank: index + 1,
        source_run_id: candidate.source_run_id,
        source_value: candidate.source_value,
        params: candidate.params,
        retest_run_ids: [],
        values: [],
        status: "pending",
      })),
      stable_best: null,
    },
  });
  appendQueueEvent(cwd, queueId, "stability_started", {
    top_k: stabilityConfig.top_k,
    repeats: stabilityConfig.repeats,
    aggregate: stabilityConfig.aggregate,
  });

  const completedCandidates = [];
  for (let rankIndex = 0; rankIndex < candidates.length; rankIndex += 1) {
    const candidate = candidates[rankIndex];
    const rank = rankIndex + 1;
    const retestRunIds = [];
    const values = [];
    let latestLog = null;
    for (let repeat = 1; repeat <= stabilityConfig.repeats; repeat += 1) {
      const current = readQueueState(cwd, queueId);
      if (current.status === "cancelled") return current;
      if (current.status === "pausing" || current.status === "paused") {
        const paused = writeQueueState(cwd, { ...current, status: "paused", stability: { ...(current.stability || {}), status: "paused" } });
        appendQueueEvent(cwd, queueId, "stability_paused", { rank, repeat });
        return paused;
      }
      const cudaVisibleDevices = candidate.cuda_visible_devices || (devices.length ? devices[(rankIndex + repeat - 1) % devices.length] : null);
      const runId = `${queueId}-stable-${String(rank).padStart(2, "0")}-r${String(repeat).padStart(2, "0")}`;
      appendQueueEvent(cwd, queueId, "stability_trial_started", {
        run_id: runId,
        source_run_id: candidate.source_run_id,
        rank,
        repeat,
        cuda_visible_devices: cudaVisibleDevices || null,
      });
      let res;
      try {
        res = await executeRun({
          cwd,
          cmdText: candidate.command,
          metricName,
          regexSource,
          timeoutSec,
          allowUnsafe,
          isBaseline: false,
          idOverride: runId,
          extraEnv: queueStabilityEnv(rank, repeat, cudaVisibleDevices),
          extraConfig: {
            sweep: state.name,
            sweep_params: candidate.params,
            queue_id: state.queue_id,
            stability_retest: true,
            stability_source_run_id: candidate.source_run_id,
            stability_candidate_rank: rank,
            stability_repeat: repeat,
            cuda_visible_devices: cudaVisibleDevices || null,
          },
          suppressExitCode: true,
          quiet: true,
          tags: ["sweep", `sweep:${state.name}`, "stability-retest", ...(state.tags || [])],
          parentId: state.queue_id,
        });
      } catch (err) {
        res = {
          status: "failed",
          metricValue: null,
          row: {
            metrics: {},
            log: `stability exception: ${err.message}`,
            exit_code: null,
            wall_seconds: null,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
          },
        };
      }
      retestRunIds.push(runId);
      if (isNumericMetric(res.row?.metrics?.[metricName])) values.push(Number(res.row.metrics[metricName]));
      else if (isNumericMetric(res.metricValue)) values.push(Number(res.metricValue));
      latestLog = res.row?.log || latestLog;
      state = readQueueState(cwd, queueId);
      const nextCandidates = (state.stability?.candidates || []).map((row) => row.rank === rank
        ? {
          ...row,
          status: "running",
          retest_run_ids: [...retestRunIds],
          values: [...values],
          latest_log: latestLog,
        }
        : row);
      state = writeQueueState(cwd, { ...state, stability: { ...(state.stability || stabilityConfig), status: "running", candidates: nextCandidates } });
      appendQueueEvent(cwd, queueId, "stability_trial_finished", {
        run_id: runId,
        source_run_id: candidate.source_run_id,
        rank,
        repeat,
        status: res.status || "failed",
        [metricName]: isNumericMetric(values[values.length - 1]) ? values[values.length - 1] : null,
      });
    }
    const stats = metricStats(values);
    const aggregateValue = stats
      ? (stabilityConfig.aggregate === "mean" ? stats.mean : stats.median)
      : null;
    completedCandidates.push({
      rank,
      source_run_id: candidate.source_run_id,
      source_value: candidate.source_value,
      params: candidate.params,
      retest_run_ids: retestRunIds,
      values,
      repeats: values.length,
      status: values.length ? "complete" : "complete_no_metric",
      stats,
      aggregate_value: aggregateValue,
      aggregate: stabilityConfig.aggregate,
      latest_log: latestLog,
    });
    state = readQueueState(cwd, queueId);
    state = writeQueueState(cwd, {
      ...state,
      stability: {
        ...(state.stability || stabilityConfig),
        status: "running",
        candidates: (state.stability?.candidates || []).map((row) => row.rank === rank ? completedCandidates[completedCandidates.length - 1] : row),
      },
    });
  }

  state = readQueueState(cwd, queueId);
  const stableBest = stableBestFromCandidates(state, completedCandidates);
  const finishedAt = new Date().toISOString();
  state = writeQueueState(cwd, {
    ...state,
    status: "running",
    reported_best: stableBest || null,
    stability: {
      ...stabilityConfig,
      status: stableBest ? "complete" : "complete_no_metric",
      started_at: startedAt,
      finished_at: finishedAt,
      candidates: completedCandidates,
      stable_best: stableBest,
    },
  });
  appendQueueEvent(cwd, queueId, "stability_completed", {
    stable_best_run_id: stableBest?.run_id || null,
    stable_best_value: stableBest?.value ?? null,
    candidates: completedCandidates.length,
  });
  return state;
}

function recoverInterruptedQueueTrials(state) {
  let recovered = 0;
  const trials = (state.trials || []).map((trial) => {
    if (trial.status !== "running" && trial.status !== "retrying") return trial;
    recovered += 1;
    return {
      ...trial,
      status: "pending",
      recovered_from_status: trial.status,
      worker_id: null,
      worker_slot: null,
    };
  });
  return { state: { ...state, trials }, recovered };
}

function claimNextPendingTrial(cwd, queueId, workerId, workerSlot, cudaVisibleDevices) {
  let state = readQueueState(cwd, queueId);
  if (state.status === "cancelled") return { stop: true, reason: "cancelled" };
  if (state.status === "pausing" || state.status === "paused") {
    if (state.status === "pausing") {
      state = writeQueueState(cwd, { ...state, status: "paused" });
      appendQueueEvent(cwd, queueId, "queue_paused");
    }
    return { stop: true, reason: "paused" };
  }
  const trial = (state.trials || []).find((row) => row.status === "pending");
  if (!trial) return { drained: true };
  const startedAt = new Date().toISOString();
  const runningStatus = Number(trial.retry_count || 0) > 0 ? "retrying" : "running";
  const patch = {
    status: runningStatus,
    started_at: startedAt,
    worker_id: workerId,
    worker_slot: workerSlot,
    cuda_visible_devices: cudaVisibleDevices || null,
  };
  state = writeQueueState(cwd, updateQueueTrial({ ...state, status: "running" }, trial.run_id, patch));
  appendQueueEvent(cwd, queueId, "trial_started", {
    run_id: trial.run_id,
    retry_count: trial.retry_count || 0,
    worker_id: workerId,
    worker_slot: workerSlot,
    cuda_visible_devices: cudaVisibleDevices || null,
  });
  return { trial: { ...trial, ...patch }, state };
}

async function startSweepQueue(cwd, queueId, opts = {}) {
  let state = readQueueState(cwd, queueId);
  if (state.status === "cancelled") return state;
  const lock = acquireQueueSchedulerLock(cwd, queueId);
  if (!lock.acquired) {
    appendQueueEvent(cwd, queueId, "queue_start_ignored", {
      reason: "scheduler_lock_active",
      pid: lock.lock?.pid || null,
    });
    return readQueueState(cwd, queueId);
  }
  try {
    state = readQueueState(cwd, queueId);
    const recovered = recoverInterruptedQueueTrials(state);
    state = recovered.state;
    const maxParallel = normalizeQueueMaxParallel(opts.maxParallel ?? state.max_parallel ?? state.spec?.max_parallel ?? 1);
    const devices = queueDevicePool(state, opts);
    state = writeQueueState(cwd, {
      ...state,
      status: "running",
      started_at: state.started_at || new Date().toISOString(),
      max_parallel: maxParallel,
      cuda_visible_devices: devices.join(","),
      device_pool: devices,
      scheduler: {
        mode: "parallel",
        pid: process.pid,
        max_parallel: maxParallel,
        device_pool: devices,
        started_at: new Date().toISOString(),
      },
    });
    appendQueueEvent(cwd, queueId, "queue_started", {
      max_parallel: maxParallel,
      device_pool: devices,
      recovered_running_trials: recovered.recovered,
    });
    const metricName = state.metric || "val_loss";
    const timeoutSec = Number(state.timeout_seconds || 600) || 600;
    const allowUnsafe = opts.allowUnsafe || hasFlag("--allow-unsafe");
    const regexSource = state.spec?.regex || null;
    const maxRetries = Math.max(0, Number(state.retry?.max_retries ?? 0) || 0);

    async function runWorker(workerSlot) {
      const workerId = `worker-${String(workerSlot).padStart(2, "0")}`;
      const cudaVisibleDevices = devices.length ? devices[(workerSlot - 1) % devices.length] : null;
      for (;;) {
        const claim = claimNextPendingTrial(cwd, queueId, workerId, workerSlot, cudaVisibleDevices);
        if (claim.stop || claim.drained) return claim.reason || "drained";
        let trial = claim.trial;
        let res;
        try {
          res = await executeRun({
            cwd,
            cmdText: trial.command,
            metricName,
            regexSource,
            timeoutSec,
            allowUnsafe,
            isBaseline: false,
            idOverride: trial.run_id,
            extraEnv: queueWorkerEnv(workerId, workerSlot, cudaVisibleDevices),
            extraConfig: {
              sweep: state.name,
              sweep_index: trial.index,
              sweep_params: trial.params,
              queue_id: state.queue_id,
              queue_worker_id: workerId,
              queue_worker_slot: workerSlot,
              cuda_visible_devices: cudaVisibleDevices || null,
            },
            suppressExitCode: true,
            quiet: true,
            tags: ["sweep", `sweep:${state.name}`, ...(state.tags || [])],
            parentId: state.queue_id,
          });
        } catch (err) {
          res = {
            status: "failed",
            metricValue: null,
            row: {
              metrics: {},
              log: `scheduler exception: ${err.message}`,
              exit_code: null,
              wall_seconds: null,
              started_at: trial.started_at,
              ended_at: new Date().toISOString(),
            },
          };
        }
        const finalStatus = res.status || "failed";
        const patch = {
          status: finalStatus,
          metrics: res.row?.metrics || {},
          log: res.row?.log || res.safety?.message || null,
          exit_code: res.row?.exit_code ?? null,
          wall_seconds: res.row?.wall_seconds ?? null,
          started_at: res.row?.started_at || trial.started_at || new Date().toISOString(),
          finished_at: res.row?.ended_at || new Date().toISOString(),
          retry_count: trial.retry_count || 0,
          worker_id: workerId,
          worker_slot: workerSlot,
          cuda_visible_devices: cudaVisibleDevices || null,
        };
        state = writeQueueState(cwd, updateQueueTrial(readQueueState(cwd, queueId), trial.run_id, patch));
        appendQueueEvent(cwd, queueId, finalStatus === "complete" ? "trial_completed" : "trial_finished", {
          run_id: trial.run_id,
          status: finalStatus,
          [metricName]: res.metricValue,
          worker_id: workerId,
          worker_slot: workerSlot,
          cuda_visible_devices: cudaVisibleDevices || null,
        });
        const shouldRetry = retryableTrialStatus(finalStatus) && (trial.retry_count || 0) < maxRetries;
        if (shouldRetry) {
          trial = {
            ...trial,
            retry_count: (trial.retry_count || 0) + 1,
          };
          state = writeQueueState(cwd, updateQueueTrial(readQueueState(cwd, queueId), trial.run_id, {
            status: "pending",
            retry_count: trial.retry_count,
            worker_id: null,
            worker_slot: null,
          }));
          appendQueueEvent(cwd, queueId, "trial_retry_scheduled", {
            run_id: trial.run_id,
            retry_count: trial.retry_count,
            worker_id: workerId,
          });
        }
      }
    }

    await Promise.all(Array.from({ length: maxParallel }, (_, index) => runWorker(index + 1)));

    state = readQueueState(cwd, queueId);
    let remaining = (state.trials || []).some((trial) => trial.status === "pending" || trial.status === "running" || trial.status === "retrying");
    if (!remaining && state.status === "running" && shouldRunQueueStability(state)) {
      state = await runQueueStabilityRetests(cwd, queueId, {
        allowUnsafe,
        devicePool: devices,
        cudaVisibleDevices: devices.join(","),
      });
      state = readQueueState(cwd, queueId);
      remaining = (state.trials || []).some((trial) => trial.status === "pending" || trial.status === "running" || trial.status === "retrying");
    }
    let finalQueueStatus = state.status;
    if (state.status === "running") {
      finalQueueStatus = remaining ? "paused" : "complete";
    } else if (state.status === "stabilizing") {
      finalQueueStatus = "complete";
    } else if (state.status === "pausing") {
      finalQueueStatus = "paused";
    }
    state = writeQueueState(cwd, {
      ...state,
      status: finalQueueStatus,
      scheduler: { ...(state.scheduler || {}), finished_at: new Date().toISOString() },
      finished_at: remaining ? state.finished_at : new Date().toISOString(),
    });
    appendQueueEvent(cwd, queueId, finalQueueStatus === "complete" ? "queue_completed" : `queue_${finalQueueStatus}`);
    writeQueueSummary(cwd, state);
    if (finalQueueStatus === "complete") {
      writeSweepReport(cwd, queueId);
    }
    return state;
  } finally {
    lock.release();
  }
}

function parseSweepSpecText(text, sourcePath = "") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("sweep spec is empty");
  }
  if (sourcePath && path.extname(sourcePath).toLowerCase() === ".json") {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("sweep spec must be a JSON object");
    }
    return parsed;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("sweep spec must be a JSON object");
    }
    return parsed;
  } catch {
    const parsed = parseSweepYaml(trimmed);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("sweep spec must be a YAML object");
    }
    return parsed;
  }
}

function parseSweepSpecFile(file) {
  return parseSweepSpecText(fs.readFileSync(file, "utf8"), file);
}

function sweepRoot(cwd) {
  return path.join(cwd, ".researchloop", "sweeps");
}

function sweepSpecCandidates(cwd, sweepName) {
  const base = sweepSafeName(sweepName, "sweep");
  const root = sweepRoot(cwd);
  return [
    path.join(root, `${base}.yaml`),
    path.join(root, `${base}.yml`),
    path.join(root, `${base}.json`),
  ];
}

function resolveSweepSpecFile(cwd, sweepNameOrPath) {
  if (!sweepNameOrPath) return null;
  const direct = path.isAbsolute(sweepNameOrPath) ? sweepNameOrPath : path.join(cwd, sweepNameOrPath);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  for (const candidate of sweepSpecCandidates(cwd, sweepNameOrPath)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function sweepNameFromSpecPath(file) {
  return sweepSafeName(path.basename(file).replace(/\.(yaml|yml|json)$/i, ""), "sweep");
}

function sweepQueuePath(cwd, sweepName) {
  return path.join(sweepRoot(cwd), `${sweepSafeName(sweepName, "sweep")}.queue.jsonl`);
}

function sweepLockRoot(cwd, sweepName) {
  return path.join(sweepRoot(cwd), `${sweepSafeName(sweepName, "sweep")}.lock`);
}

function sweepQueueLockPath(cwd, sweepName) {
  return path.join(sweepLockRoot(cwd, sweepName), "claim.lock");
}

function sweepRowLockPath(cwd, sweepName, rowId) {
  return path.join(sweepLockRoot(cwd, sweepName), `${rowId}.json`);
}

function sweepReadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
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

function sweepWriteJsonl(file, rows) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`);
}

function sweepPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

function sweepReadLockMeta(file) {
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

function sweepRecoverStaleLock(file, maxAgeMinutes = 120) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  const meta = sweepReadLockMeta(file);
  const pid = meta && Number.isFinite(meta.pid) ? meta.pid : null;
  const alive = pid !== null ? sweepPidAlive(pid) : null;
  const stale = alive === false || (pid === null && (Date.now() - stat.mtimeMs) / 60000 > maxAgeMinutes);
  if (!stale) return false;
  try {
    fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function sweepAcquireExclusiveFile(file, payload) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
}

function sweepReleaseExclusiveFile(file) {
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function sweepSpecBaseCommand(spec) {
  return String(spec?.base_command || spec?.command_template || spec?.command || "").trim();
}

function sweepNormalizeParamSpec(value) {
  if (Array.isArray(value)) {
    return { type: "choice", values: value.slice() };
  }
  if (!value || typeof value !== "object") {
    return { type: "fixed", value };
  }
  return value;
}

function sweepChoiceValues(def) {
  if (Array.isArray(def)) return def.slice();
  if (!def || typeof def !== "object") return [def];
  if (Array.isArray(def.values)) return def.values.slice();
  if (Array.isArray(def.choices)) return def.choices.slice();
  if (Array.isArray(def.options)) return def.options.slice();
  if (Object.prototype.hasOwnProperty.call(def, "value")) return [def.value];
  if (Object.prototype.hasOwnProperty.call(def, "default")) return [def.default];
  return [def];
}

function sweepSampleValue(def, rng) {
  const spec = sweepNormalizeParamSpec(def);
  const type = String(spec.type || (Array.isArray(spec.values) ? "choice" : "fixed")).toLowerCase();
  if (type === "choice" || type === "list") {
    const values = sweepChoiceValues(spec);
    if (!values.length) return null;
    return values[Math.floor(rng() * values.length) % values.length];
  }
  if (type === "uniform") {
    const min = Number(spec.min);
    const max = Number(spec.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error("random sweep uniform params require min and max");
    }
    return min + (max - min) * rng();
  }
  if (type === "log_uniform" || type === "log-uniform") {
    const min = Number(spec.min);
    const max = Number(spec.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
      throw new Error("random sweep log_uniform params require positive min and max");
    }
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    return Math.exp(logMin + (logMax - logMin) * rng());
  }
  if (type === "int" || type === "integer") {
    const min = Math.ceil(Number(spec.min));
    const max = Math.floor(Number(spec.max));
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new Error("random sweep int params require min and max");
    }
    return min + Math.floor(rng() * (max - min + 1));
  }
  if (type === "fixed") {
    if (Object.prototype.hasOwnProperty.call(spec, "value")) return spec.value;
    if (Object.prototype.hasOwnProperty.call(spec, "default")) return spec.default;
    return null;
  }
  if (Array.isArray(spec.values) || Array.isArray(spec.choices) || Array.isArray(spec.options)) {
    const values = sweepChoiceValues(spec);
    return values[Math.floor(rng() * values.length) % values.length];
  }
  return spec;
}

function sweepExpandGridVariants(spec) {
  const axesSource = spec.grid && typeof spec.grid === "object" ? spec.grid : spec.params;
  const axes = Object.entries(axesSource || {});
  if (!axes.length) return [];
  let combos = [{}];
  for (const [key, value] of axes) {
    const normalized = sweepNormalizeParamSpec(value);
    const values = sweepChoiceValues(normalized);
    if (!values.length) {
      throw new Error(`sweep grid axis "${key}" produced no values`);
    }
    if (!Array.isArray(values)) {
      throw new Error(`sweep grid axis "${key}" must be a list`);
    }
    const next = [];
    for (const combo of combos) {
      for (const entry of values) {
        next.push({ ...combo, [key]: entry });
      }
    }
    combos = next;
  }
  return combos.map((params, index) => ({ params, index }));
}

function sweepExpandListVariants(spec) {
  if (Array.isArray(spec.variants) && spec.variants.length) {
    return spec.variants.map((params, index) => ({ params, index }));
  }
  const source = spec.params && typeof spec.params === "object" ? spec.params : null;
  if (!source) return [];
  const entries = Object.entries(source);
  if (!entries.length) return [];
  const lengths = entries.map(([, value]) => Array.isArray(value) ? value.length : null);
  if (!lengths.every((value) => Number.isFinite(value))) {
    throw new Error("list sweep requires `variants:` or `params:` values that are equally sized lists");
  }
  const uniqueLengths = new Set(lengths);
  if (uniqueLengths.size !== 1) {
    throw new Error("list sweep params must all have the same length");
  }
  const count = lengths[0];
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const params = {};
    for (const [key, value] of entries) {
      params[key] = value[index];
    }
    rows.push({ params, index });
  }
  return rows;
}

function sweepExpandRandomVariants(spec) {
  const budget = Number(spec.budget ?? spec.random_budget ?? 0);
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("random sweep requires a positive `budget`");
  }
  const seedSource = spec.seed ?? spec.random_seed ?? spec.name ?? "sweep";
  const rng = (() => {
    const seed = createHash("sha256").update(String(seedSource)).digest().readUInt32LE(0);
    let state = seed || 0x9e3779b9;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const params = spec.params && typeof spec.params === "object" ? spec.params : {};
  const rows = [];
  for (let index = 0; index < budget; index += 1) {
    const sample = {};
    for (const [key, value] of Object.entries(params)) {
      sample[key] = sweepSampleValue(value, rng);
    }
    rows.push({ params: sample, index });
  }
  return rows;
}

function sweepExpandVariants(spec) {
  const strategy = String(spec.strategy || (spec.variants ? "list" : spec.grid ? "grid" : "grid")).toLowerCase();
  let variants = [];
  if (strategy === "random") {
    variants = sweepExpandRandomVariants(spec);
  } else if (strategy === "list") {
    variants = sweepExpandListVariants(spec);
  } else {
    variants = sweepExpandGridVariants(spec);
  }
  const budget = Number(spec.budget ?? 0);
  if (Number.isFinite(budget) && budget > 0 && variants.length > budget && strategy !== "random") {
    variants = variants.slice(0, budget);
  }
  return variants.map((variant, index) => ({
    params: variant.params || {},
    index,
  }));
}

function sweepVariantId(sweepName, index, params) {
  const hash = sweepHash({ sweepName, index, params }, 12);
  return `${sweepSafeName(sweepName, "sweep")}-${String(index).padStart(3, "0")}-${hash}`;
}

function sweepReadRuns(cwd) {
  return readRunRows(cwd);
}

function sweepReadQueue(cwd, sweepName) {
  return sweepReadJsonl(sweepQueuePath(cwd, sweepName));
}

function sweepWriteQueue(cwd, sweepName, rows) {
  ensureDir(path.dirname(sweepQueuePath(cwd, sweepName)));
  sweepWriteJsonl(sweepQueuePath(cwd, sweepName), rows);
}

function sweepRowQueueState(row, queueRows, runRows, cwd, sweepName) {
  const lockPath = sweepRowLockPath(cwd, sweepName, row.id);
  if (String(row.status) === "done") return "done";
  if (String(row.status) === "failed") return "failed";
  const runRow = runRows.find((entry) => String(entry.id) === String(row.id));
  const runStatus = String(runRow?.status || "").toLowerCase();
  if (["complete", "complete_no_metric", "complete_partial", "promoted", "kept", "discarded"].includes(runStatus)) {
    return "done";
  }
  if (["failed", "timeout", "spawn_error", "killed_by_safety", "killed_by_rule"].includes(runStatus)) {
    return "failed";
  }
  if (fs.existsSync(lockPath)) {
    return "running";
  }
  if (String(row.status) === "running") return "queued";
  return "queued";
}

function sweepBoard(cwd, sweepName) {
  const queueRows = sweepReadQueue(cwd, sweepName);
  const runRows = sweepReadRuns(cwd);
  const rows = queueRows.map((row) => ({
    ...row,
    state: sweepRowQueueState(row, queueRows, runRows, cwd, sweepName),
  }));
  const counts = rows.reduce((acc, row) => {
    acc[row.state] = (acc[row.state] || 0) + 1;
    return acc;
  }, { queued: 0, running: 0, done: 0, failed: 0 });
  return { rows, counts, queueRows, runRows };
}

function sweepLockSummaryRow(row) {
  const pieces = [`[${row.state}]`, row.id];
  if (row.index !== undefined && row.index !== null) pieces.push(`#${row.index}`);
  if (row.params && Object.keys(row.params).length) pieces.push(JSON.stringify(row.params));
  if (row.command) pieces.push(`-> ${row.command}`);
  return pieces.join(" ");
}

function sweepQueueSummary(board, sweepName, specPath, queuePath) {
  const lines = ["autoresearch sweep", "---"];
  lines.push(`sweep: ${sweepName}`);
  if (specPath) lines.push(`spec: ${specPath}`);
  lines.push(`queue: ${queuePath}`);
  lines.push(`queued: ${board.counts.queued} running: ${board.counts.running} done: ${board.counts.done} failed: ${board.counts.failed}`);
  if (!board.rows.length) {
    lines.push("(empty)");
    return `${lines.join("\n")}\n`;
  }
  lines.push("---");
  for (const row of board.rows) {
    lines.push(`- ${sweepLockSummaryRow(row)}`);
  }
  return `${lines.join("\n")}\n`;
}

function sweepQueueJson(board, sweepName, specPath, queuePath) {
  return `${JSON.stringify({
    sweep: sweepName,
    spec_path: specPath,
    queue_path: queuePath,
    counts: board.counts,
    rows: board.rows,
    generated_at: new Date().toISOString(),
  }, null, 2)}\n`;
}

function sweepSubcommandName(subcommand) {
  const subIndex = args.findIndex((arg, index) => index > 0 && !arg.startsWith("-") && arg === subcommand);
  if (subIndex === -1) return "";
  for (let i = subIndex + 1; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith("-")) continue;
    return token;
  }
  return "";
}

function sweepEnsureGenerated(cwd, sweepName) {
  const queuePath = sweepQueuePath(cwd, sweepName);
  if (fs.existsSync(queuePath)) {
    return queuePath;
  }
  const specFile = resolveSweepSpecFile(cwd, sweepName);
  if (!specFile) {
    throw new Error(`sweep spec not found for ${sweepName}`);
  }
  const spec = parseSweepSpecFile(specFile);
  const variants = sweepExpandVariants(spec);
  const existing = sweepReadQueue(cwd, sweepName);
  const priorById = new Map(existing.map((row) => [String(row.id), row]));
  const now = new Date().toISOString();
  const baseCommand = sweepSpecBaseCommand(spec);
  if (!baseCommand) {
    throw new Error("sweep spec must include `base_command` (or `command_template`)");
  }
  const rows = variants.map((variant, index) => {
    const id = sweepVariantId(sweepName, index, variant.params);
    const prior = priorById.get(String(id)) || {};
    const command = renderSweepCommand(baseCommand, variant.params || {});
    return {
      id,
      sweep: sweepName,
      strategy: String(spec.strategy || (spec.variants ? "list" : spec.grid ? "grid" : "grid")).toLowerCase(),
      spec_path: path.relative(cwd, specFile),
      spec_hash: sweepHash(spec, 16),
      command,
      params: variant.params || {},
      index,
      status: prior.status || "queued",
      created_at: prior.created_at || now,
      updated_at: prior.updated_at || now,
      claimed_at: prior.claimed_at || null,
      claimed_by: prior.claimed_by || null,
      lock_path: prior.lock_path || null,
      run_id: prior.run_id || null,
      run_status: prior.run_status || null,
      exit_code: prior.exit_code ?? null,
      metric_name: prior.metric_name || null,
      metric_value: prior.metric_value ?? null,
      completed_at: prior.completed_at || null,
      finished_at: prior.finished_at || null,
      failure_reason: prior.failure_reason || null,
    };
  });
  ensureDir(path.dirname(queuePath));
  sweepWriteQueue(cwd, sweepName, rows);
  return queuePath;
}

function sweepClaimRow(cwd, sweepName, agent, workerName) {
  const queuePath = sweepQueuePath(cwd, sweepName);
  if (!fs.existsSync(queuePath)) return { state: "missing", row: null };
  const claimLock = sweepQueueLockPath(cwd, sweepName);
  sweepRecoverStaleLock(claimLock);
  try {
    sweepAcquireExclusiveFile(claimLock, {
      scope: "sweeps",
      kind: "queue-claim",
      pid: process.pid,
      agent,
      worker: workerName,
      sweep: sweepName,
      acquired_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err && err.code === "EEXIST") {
      return { state: "busy", row: null };
    }
    throw err;
  }

  try {
    const queueRows = sweepReadQueue(cwd, sweepName);
    const runRows = sweepReadRuns(cwd);
    for (const row of queueRows) {
      const state = sweepRowQueueState(row, queueRows, runRows, cwd, sweepName);
      if (state !== "queued") continue;
      const rowLock = sweepRowLockPath(cwd, sweepName, row.id);
      sweepRecoverStaleLock(rowLock);
      if (fs.existsSync(rowLock)) continue;
      const now = new Date().toISOString();
      try {
        sweepAcquireExclusiveFile(rowLock, {
          scope: "sweeps",
          kind: "row-claim",
          pid: process.pid,
          agent,
          worker: workerName,
          sweep: sweepName,
          row_id: row.id,
          claimed_at: now,
        });
      } catch (err) {
        if (err && err.code === "EEXIST") {
          continue;
        }
        throw err;
      }

      row.status = "running";
      row.claimed_at = now;
      row.claimed_by = agent;
      row.worker = workerName;
      row.lock_path = path.relative(cwd, rowLock);
      row.updated_at = now;
      sweepWriteQueue(cwd, sweepName, queueRows);
      return { state: "claimed", row, lockPath: rowLock };
    }
    return { state: "no-row", row: null };
  } finally {
    sweepReleaseExclusiveFile(claimLock);
  }
}

function sweepUpdateRow(cwd, sweepName, rowId, updater) {
  const claimLock = sweepQueueLockPath(cwd, sweepName);
  sweepRecoverStaleLock(claimLock);
  try {
    sweepAcquireExclusiveFile(claimLock, {
      scope: "sweeps",
      kind: "queue-update",
      pid: process.pid,
      sweep: sweepName,
      row_id: rowId,
      acquired_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err && err.code === "EEXIST") {
      throw new Error(`sweep queue busy for ${sweepName}`);
    }
    throw err;
  }

  try {
    const queueRows = sweepReadQueue(cwd, sweepName);
    const index = queueRows.findIndex((row) => String(row.id) === String(rowId));
    if (index === -1) {
      throw new Error(`sweep row not found: ${rowId}`);
    }
    const next = updater({ ...queueRows[index] });
    queueRows[index] = {
      ...queueRows[index],
      ...next,
      updated_at: new Date().toISOString(),
    };
    sweepWriteQueue(cwd, sweepName, queueRows);
    return queueRows[index];
  } finally {
    sweepReleaseExclusiveFile(claimLock);
  }
}

async function sweepRunOne(cwd, sweepName, row, ctx, sweepRunId, metricsName, regexSource, timeoutSec, allowUnsafe, enableSystemSampling) {
  const res = await executeRun({
    cwd,
    cmdText: row.command,
    metricName: metricsName,
    regexSource,
    timeoutSec,
    allowUnsafe,
    isBaseline: false,
    idOverride: row.id,
    extraConfig: {
      sweep: sweepName,
      sweep_run_id: sweepRunId,
      sweep_index: row.index,
      sweep_params: row.params,
      sweep_queue: path.relative(cwd, sweepQueuePath(cwd, sweepName)),
    },
    suppressExitCode: true,
    quiet: true,
    tags: ["sweep", `sweep:${sweepName}`],
    parentId: sweepRunId,
    enableSystemSampling,
  });

  const metricValue = res.metricValue;
  const finishedAt = new Date().toISOString();
  let queueRow;
  try {
    queueRow = sweepUpdateRow(cwd, sweepName, row.id, (current) => ({
      ...current,
      status: res.status === "blocked" || res.status === "no_command" ? "failed" : (res.status === "failed" || res.status === "timeout" || res.status === "spawn_error" || res.status === "killed_by_safety" || res.status === "killed_by_rule" ? "failed" : "done"),
      run_id: res.id || current.run_id || row.id,
      run_status: res.status,
      exit_code: res.row ? res.row.exit_code : null,
      metric_name: metricValue !== null ? metricsName : current.metric_name,
      metric_value: metricValue !== null ? metricValue : current.metric_value,
      completed_at: finishedAt,
      finished_at: finishedAt,
      failure_reason: res.status === "blocked" ? res.safety?.message || "blocked by safety" : null,
    }));
  } finally {
    sweepReleaseExclusiveFile(sweepRowLockPath(cwd, sweepName, row.id));
  }

  return {
    ok: res.ok,
    status: res.status,
    metricValue,
    runId: res.id,
    queueRow,
    wallSeconds: res.wallSeconds,
  };
}

async function cmdSweepGenerate() {
  const cwd = targetDir();
  const sweepName = sweepSafeName(option("--name", sweepSubcommandName("generate")) || "sweep");
  const specFile = resolveSweepSpecFile(cwd, sweepName);
  if (!specFile) {
    console.error(`sweep spec not found for ${sweepName}`);
    process.exitCode = 1;
    return;
  }
  let spec;
  try {
    spec = parseSweepSpecFile(specFile);
  } catch (err) {
    console.error(`sweep spec error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const baseCommand = sweepSpecBaseCommand(spec);
  if (!baseCommand) {
    console.error("sweep spec must include `base_command` or `command_template`");
    process.exitCode = 1;
    return;
  }

  let variants;
  try {
    variants = sweepExpandVariants(spec);
  } catch (err) {
    console.error(`sweep spec error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (!variants.length) {
    console.error("sweep spec produced 0 variants");
    process.exitCode = 1;
    return;
  }

  const queuePath = sweepQueuePath(cwd, sweepName);
  const existing = sweepReadQueue(cwd, sweepName);
  const priorById = new Map(existing.map((row) => [String(row.id), row]));
  const generatedAt = new Date().toISOString();
  const rows = variants.map((variant, index) => {
    const id = sweepVariantId(sweepName, index, variant.params || {});
    const prior = priorById.get(String(id)) || {};
    return {
      id,
      sweep: sweepName,
      strategy: String(spec.strategy || (spec.variants ? "list" : spec.grid ? "grid" : "grid")).toLowerCase(),
      spec_path: path.relative(cwd, specFile),
      spec_hash: sweepHash(spec, 16),
      command: renderSweepCommand(baseCommand, variant.params || {}),
      params: variant.params || {},
      index,
      status: prior.status || "queued",
      created_at: prior.created_at || generatedAt,
      updated_at: prior.updated_at || generatedAt,
      claimed_at: prior.claimed_at || null,
      claimed_by: prior.claimed_by || null,
      lock_path: prior.lock_path || null,
      run_id: prior.run_id || null,
      run_status: prior.run_status || null,
      exit_code: prior.exit_code ?? null,
      metric_name: prior.metric_name || null,
      metric_value: prior.metric_value ?? null,
      completed_at: prior.completed_at || null,
      finished_at: prior.finished_at || null,
      failure_reason: prior.failure_reason || null,
    };
  });
  sweepWriteQueue(cwd, sweepName, rows);
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const board = sweepBoard(cwd, sweepName);
  if (formatJson) {
    console.log(sweepQueueJson(board, sweepName, path.relative(cwd, specFile), path.relative(cwd, queuePath)));
  } else {
    process.stdout.write(`autoresearch sweep generate\nsweep: ${sweepName}\nspec: ${path.relative(cwd, specFile)}\nqueue: ${path.relative(cwd, queuePath)}\nrows: ${rows.length}\n`);
  }
}

async function cmdSweepStatus() {
  const cwd = targetDir();
  const sweepName = sweepSafeName(option("--name", sweepSubcommandName("status")) || "sweep");
  const queuePath = sweepQueuePath(cwd, sweepName);
  if (!fs.existsSync(queuePath)) {
    console.error(`sweep queue not found: ${path.relative(cwd, queuePath)}`);
    process.exitCode = 1;
    return;
  }
  const specFile = resolveSweepSpecFile(cwd, sweepName);
  const board = sweepBoard(cwd, sweepName);
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  if (formatJson) {
    console.log(sweepQueueJson(board, sweepName, specFile ? path.relative(cwd, specFile) : null, path.relative(cwd, queuePath)));
  } else {
    process.stdout.write(sweepQueueSummary(board, sweepName, specFile ? path.relative(cwd, specFile) : null, path.relative(cwd, queuePath)));
  }
}

async function cmdSweepRunQueue() {
  const cwd = targetDir();
  const sweepName = sweepSafeName(option("--name", sweepSubcommandName("run")) || "sweep");
  const specFile = resolveSweepSpecFile(cwd, sweepName);
  if (!specFile) {
    console.error(`sweep spec not found: ${sweepName}`);
    process.exitCode = 1;
    return;
  }
  try {
    sweepEnsureGenerated(cwd, sweepName);
  } catch (err) {
    console.error(`sweep generate error: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const goalFields = readGoalFields(cwd);
  const spec = parseSweepSpecFile(specFile);
  const metricName = String(option("--metric", spec.metric || goalFields.metric || "val_loss")).trim() || "val_loss";
  const regexSource = option("--regex", spec.regex || null);
  const timeoutSec = Number(option("--timeout", spec.timeout || 600));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const direction = String(option("--direction", spec.direction || goalFields.direction || "lower")).toLowerCase();
  const workersRaw = Number(option("--workers", spec.workers || 1));
  const workerCount = Number.isFinite(workersRaw) && workersRaw > 0 ? Math.max(1, Math.floor(workersRaw)) : 1;
  const maxFailuresRaw = Number(option("--max-failures", spec.max_failures || spec.maxFailures || Infinity));
  const maxFailures = Number.isFinite(maxFailuresRaw) && maxFailuresRaw >= 0 ? maxFailuresRaw : Infinity;
  const enableSystemSampling = !hasFlag("--no-system-sampling");
  const sweepRunId = `${sweepSafeName(sweepName, "sweep")}-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  const board0 = sweepBoard(cwd, sweepName);
  const total = board0.rows.length;
  let completed = 0;
  let failures = 0;
  let stopRequested = false;

  const onSigint = () => {
    stopRequested = true;
    console.log("sweep: stopping after current row");
  };
  process.once("SIGINT", onSigint);

  console.log("autoresearch sweep run");
  console.log(`sweep: ${sweepName}`);
  console.log(`spec: ${path.relative(cwd, specFile)}`);
  console.log(`queue: ${path.relative(cwd, sweepQueuePath(cwd, sweepName))}`);
  console.log(`workers: ${workerCount}`);
  console.log(`metric: ${metricName} (${direction === "higher" || direction === "max" || direction === "maximize" ? "higher" : "lower"})`);
  if (maxFailures !== Infinity) console.log(`max_failures: ${maxFailures}`);
  console.log("---");

  async function workerLoop(workerIndex) {
    const workerName = `worker-${workerIndex}`;
    while (!stopRequested) {
      const claim = sweepClaimRow(cwd, sweepName, "autoresearch sweep", workerName);
      if (claim.state === "busy") {
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }
      if (claim.state !== "claimed" || !claim.row) {
        return;
      }
      const row = claim.row;
      const started = Date.now();
      try {
        const result = await sweepRunOne(cwd, sweepName, row, { workerName }, sweepRunId, metricName, regexSource, timeoutSec, allowUnsafe, enableSystemSampling);
        completed += 1;
        const rowFailed = String(result.queueRow?.status || "").toLowerCase() === "failed" || (!result.ok && !result.queueRow);
        if (rowFailed) {
          failures += 1;
          if (failures >= maxFailures) {
            stopRequested = true;
          }
        }
        const metricSuffix = Number.isFinite(result.metricValue) ? ` ${metricName}=${result.metricValue}` : "";
        const elapsed = Math.max(0, Math.round((Date.now() - started) / 1000));
        console.log(`[${completed}/${total}] ${row.id} ${row.command}${metricSuffix} (${elapsed}s)`);
      } catch (err) {
        failures += 1;
        stopRequested = true;
        sweepReleaseExclusiveFile(sweepRowLockPath(cwd, sweepName, row.id));
        try {
          sweepUpdateRow(cwd, sweepName, row.id, (current) => ({
            ...current,
            status: "failed",
            failure_reason: err.message,
            completed_at: new Date().toISOString(),
          }));
        } catch {
          // ignore update failure
        }
        console.error(`sweep row failed: ${row.id}: ${err.message}`);
      }
    }
  }

  const workerRuns = [];
  for (let i = 0; i < workerCount; i += 1) {
    workerRuns.push(workerLoop(i + 1));
  }
  try {
    await Promise.all(workerRuns);
  } finally {
    process.removeListener("SIGINT", onSigint);
  }

  const finalBoard = sweepBoard(cwd, sweepName);
  const scored = finalBoard.rows
    .map((row) => ({
      id: row.id,
      params: row.params,
      value: Number.isFinite(metricNumber(row.metric_value)) ? metricNumber(row.metric_value) : metricNumber(readRunRowById(cwd, row.id)?.metrics?.[metricName]),
    }))
    .filter((row) => Number.isFinite(row.value));
  scored.sort((a, b) => (direction === "higher" || direction === "max" || direction === "maximize") ? b.value - a.value : a.value - b.value);
  const sweepSummaryDir = path.join(cwd, ".researchloop", "scratchpad", "sweeps", sweepRunId);
  ensureDir(sweepSummaryDir);
  fs.writeFileSync(path.join(sweepSummaryDir, "summary.json"), `${JSON.stringify({
    sweep: sweepName,
    sweep_run_id: sweepRunId,
    spec_path: path.relative(cwd, specFile),
    queue_path: path.relative(cwd, sweepQueuePath(cwd, sweepName)),
    metric: metricName,
    direction: direction === "higher" || direction === "max" || direction === "maximize" ? "higher" : "lower",
    workers: workerCount,
    max_failures: Number.isFinite(maxFailures) ? maxFailures : null,
    rows_total: total,
    rows_done: finalBoard.counts.done,
    rows_failed: finalBoard.counts.failed,
    scored,
    best: scored[0] || null,
  }, null, 2)}\n`);

  console.log("---");
  console.log(`completed: ${finalBoard.counts.done + finalBoard.counts.failed}/${total}`);
  console.log(`done: ${finalBoard.counts.done}`);
  console.log(`failed: ${finalBoard.counts.failed}`);
  console.log(`queued: ${finalBoard.counts.queued}`);
  console.log(`running: ${finalBoard.counts.running}`);
  if (scored.length) {
    console.log(`best: ${scored[0].id} ${metricName}=${scored[0].value} params=${JSON.stringify(scored[0].params)}`);
  }
  console.log(`summary: ${path.relative(cwd, path.join(sweepSummaryDir, "summary.json"))}`);
}

async function cmdSweep() {
  const subcommands = new Set(["generate", "status", "run"]);
  const sub = args.find((arg, index) => index > 0 && !arg.startsWith("-") && subcommands.has(arg)) || null;
  if (sub === "generate") {
    await cmdSweepGenerate();
    return;
  }
  if (sub === "status") {
    await cmdSweepStatus();
    return;
  }
  if (sub === "run") {
    await cmdSweepRunQueue();
    return;
  }

  const cwd = targetDir();
  const subcommand = subcommandFor("sweep", ["validate", "preview", "create", "report"]);
  if (["validate", "preview", "create", "report"].includes(subcommand)) {
    if (subcommand === "report") {
      const queueId = String(option("--id", option("--queue-id", ""))).trim();
      if (!queueId) {
        console.error("autoresearch sweep report requires --id <queue-id>");
        process.exitCode = 1;
        return;
      }
      try {
        const written = writeSweepReport(cwd, queueId);
        if (String(option("--format", "text")) === "json") {
          console.log(JSON.stringify(written, null, 2));
        } else {
          console.log(`report: ${written.report}`);
          console.log(`summary: ${written.summary}`);
          console.log(`results: ${written.results}`);
        }
      } catch (err) {
        console.error(`sweep report error: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }
    const specPathForSub = option("--spec", null);
    if (!specPathForSub || typeof specPathForSub !== "string") {
      console.error(`autoresearch sweep ${subcommand} requires --spec <file.json|yaml|csv>`);
      process.exitCode = 1;
      return;
    }
    const absForSub = path.isAbsolute(specPathForSub) ? specPathForSub : path.join(cwd, specPathForSub);
    if (!fs.existsSync(absForSub)) {
      console.error(`sweep spec not found: ${absForSub}`);
      process.exitCode = 1;
      return;
    }
    let parsedForSub;
    try {
      parsedForSub = parseSweepSpec(fs.readFileSync(absForSub, "utf8"), {
        name: option("--name", ""),
        metric: option("--metric", ""),
        direction: option("--direction", ""),
        command_template: option("--command-template", ""),
      });
      if (option("--name", "")) parsedForSub.name = option("--name", "");
      if (option("--metric", "")) parsedForSub.metric = option("--metric", "");
      if (option("--direction", "")) parsedForSub.direction = option("--direction", "");
      if (option("--command-template", "")) parsedForSub.command_template = option("--command-template", "");
    } catch (err) {
      console.error(`sweep spec error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const validation = validateSweepSpec(parsedForSub, cwd, {
      allowUnsafe: hasFlag("--allow-unsafe"),
      maxRuns: option("--max-runs", null),
      timeout: option("--timeout", null),
    });
    if (subcommand === "validate") {
      if (String(option("--format", "text")) === "json") {
        console.log(JSON.stringify(validation, null, 2));
      } else {
        console.log(`ok: ${validation.ok}`);
        console.log(`variants: ${validation.count}`);
        for (const warning of validation.warnings) console.log(`warning: ${warning}`);
        for (const error of validation.errors) console.log(`error: ${error}`);
      }
      if (!validation.ok) process.exitCode = 1;
      return;
    }
    if (!validation.ok) {
      console.error(`sweep spec error: ${validation.errors.join("; ")}`);
      process.exitCode = 1;
      return;
    }
    if (subcommand === "preview") {
      if (String(option("--format", "text")) === "json") {
        console.log(JSON.stringify(validation, null, 2));
      } else {
        console.log(`sweep preview: ${validation.spec.name}`);
        console.log(`variants: ${validation.count}`);
        for (const variant of validation.variants.slice(0, 20)) {
          console.log(`[${variant.index + 1}] ${variant.run_id} ${JSON.stringify(variant.params)} -> ${variant.command}`);
        }
      }
      return;
    }
    if (subcommand === "create") {
      try {
        const created = createSweepQueue(cwd, parsedForSub, {
          allowUnsafe: hasFlag("--allow-unsafe"),
          queueId: option("--id", option("--queue-id", "")),
          maxRuns: option("--max-runs", null),
          timeout: option("--timeout", null),
        });
        if (String(option("--format", "text")) === "json") {
          console.log(JSON.stringify(created.state, null, 2));
        } else {
          console.log(`queue: ${created.queueId}`);
          console.log(`state: ${path.relative(cwd, sweepQueueStatePath(cwd, created.queueId))}`);
          console.log(`variants: ${created.state.counts.total}`);
        }
      } catch (err) {
        console.error(`sweep create error: ${err.message}`);
        process.exitCode = 1;
      }
      return;
    }
  }

  const specPath = option("--spec", null);
  if (!specPath || typeof specPath !== "string") {
    console.error("autoresearch sweep requires --spec <file.json|yaml|csv>");
    process.exitCode = 1;
    return;
  }
  const abs = path.isAbsolute(specPath) ? specPath : path.join(cwd, specPath);
  if (!fs.existsSync(abs)) {
    console.error(`sweep spec not found: ${abs}`);
    process.exitCode = 1;
    return;
  }
  let spec;
  try {
    spec = parseSweepSpec(fs.readFileSync(abs, "utf8"), {
      name: option("--name", ""),
      metric: option("--metric", ""),
      direction: option("--direction", ""),
      command_template: option("--command-template", ""),
    });
  } catch (err) {
    console.error(`sweep spec error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const template = spec.command_template || spec.command;
  if (!template || typeof template !== "string") {
    console.error("sweep spec must include `command_template` (string with {param} placeholders)");
    process.exitCode = 1;
    return;
  }
  let variants;
  try {
    variants = expandSweepVariants(spec);
  } catch (err) {
    console.error(`sweep spec error: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!variants.length) {
    console.error("sweep spec produced 0 variants");
    process.exitCode = 1;
    return;
  }

  const goalFields = readGoalFields(cwd);
  const metricName = String(option("--metric", spec.metric || goalFields.metric || "val_loss")).trim();
  const regexSource = option("--regex", spec.regex || null);
  const timeoutSec = Number(option("--timeout", spec.timeout_seconds || spec.timeout || 600));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const seedsRaw = option("--seeds", spec.seeds || null);
  const seeds = seedsRaw && typeof seedsRaw !== "boolean" ? parseInt(String(seedsRaw), 10) : null;
  const dryRun = hasFlag("--dry-run");
  const direction = String(option("--direction", spec.direction || goalFields.direction || "lower")).toLowerCase();
  const preferHigher = direction === "higher" || direction === "max" || direction === "maximize";
  const sweepName = String(spec.name || option("--name", "sweep")).replace(/[^A-Za-z0-9._-]/g, "-");
  const validation = validateSweepSpec({ ...spec, name: sweepName, metric: metricName, direction, command_template: template }, cwd, {
    allowUnsafe,
    maxRuns: option("--max-runs", null),
    timeout: timeoutSec,
  });
  if (!validation.ok) {
    console.error(`sweep spec error: ${validation.errors.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sweepId = `${sweepName}-${stamp}`;

  console.log(`autoresearch sweep`);
  console.log(`spec: ${abs}`);
  console.log(`name: ${sweepName}`);
  console.log(`variants: ${variants.length}`);
  console.log(`metric: ${metricName} (${preferHigher ? "higher" : "lower"})`);
  if (Number.isFinite(seeds) && seeds > 1) {
    console.log(`seeds per variant: ${seeds}`);
  }
  console.log("---");

  if (dryRun) {
    for (const variant of variants) {
      const cmdText = renderSweepCommand(template, variant.params);
      console.log(`[${variant.index}] ${JSON.stringify(variant.params)} -> ${cmdText}`);
    }
    console.log("---");
    console.log("dry-run: no runs executed");
    return;
  }

  const results = [];
  for (const variant of variants) {
    const cmdText = renderSweepCommand(template, variant.params);
    const variantId = `${sweepId}-v${variant.index}`;
    if (Number.isFinite(seeds) && seeds > 1) {
      console.log(`[${variant.index}] params=${JSON.stringify(variant.params)} cmd=${cmdText} (seeds=${seeds})`);
      await runWithSeeds({
        cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, seeds,
        idBase: variantId,
        direction,
      });
      const aggRow = readRunRowById(cwd, variantId);
      results.push({ variant, id: variantId, row: aggRow });
    } else {
      console.log(`[${variant.index}] params=${JSON.stringify(variant.params)} cmd=${cmdText}`);
      const res = await executeRun({
        cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe,
        isBaseline: false,
        idOverride: variantId,
        extraConfig: { sweep: sweepName, sweep_index: variant.index, sweep_params: variant.params },
        suppressExitCode: true,
        quiet: true,
        tags: ["sweep", `sweep:${sweepName}`],
        parentId: sweepId,
      });
      const m = res.metricValue !== null ? `${metricName}=${res.metricValue}` : "metric=?";
      console.log(`  → ${variantId} status=${res.status} ${m}`);
      results.push({ variant, id: variantId, row: res.row });
    }
  }

  console.log("---");
  const scored = results
    .map((r) => ({
      id: r.id,
      params: r.variant.params,
      value: r.row && r.row.metrics ? metricNumber(r.row.metrics[metricName]) : Number.NaN,
    }))
    .filter((r) => Number.isFinite(r.value));
  scored.sort((a, b) => (preferHigher ? b.value - a.value : a.value - b.value));
  console.log(`sweep: ${sweepName}`);
  console.log(`completed: ${results.length}/${variants.length}`);
  console.log(`scored: ${scored.length}`);
  if (scored.length > 0) {
    console.log(`best: ${scored[0].id} ${metricName}=${scored[0].value} params=${JSON.stringify(scored[0].params)}`);
    console.log("top:");
    for (const entry of scored.slice(0, Math.min(5, scored.length))) {
      console.log(`- ${entry.id}: ${metricName}=${entry.value} params=${JSON.stringify(entry.params)}`);
    }
  }

  const sweepDir = path.join(cwd, ".researchloop", "scratchpad", "sweeps", sweepId);
  ensureDir(sweepDir);
  fs.writeFileSync(path.join(sweepDir, "summary.json"), `${JSON.stringify({
    sweep: sweepName,
    sweep_id: sweepId,
    spec_path: path.relative(cwd, abs),
    metric: metricName,
    direction: preferHigher ? "higher" : "lower",
    variants_total: variants.length,
    variants_completed: results.length,
    seeds_per_variant: Number.isFinite(seeds) && seeds > 1 ? seeds : 1,
    scored,
    best: scored[0] || null,
  }, null, 2)}\n`);
  console.log(`summary: ${path.relative(cwd, path.join(sweepDir, "summary.json"))}`);
}

async function cmdQueue() {
  const cwd = targetDir();
  const subcommand = subcommandFor("queue", ["start", "pause", "resume", "cancel", "retry-failed", "delete", "clear", "report", "status"]) || "status";
  const queueId = String(option("--id", option("--queue-id", ""))).trim();
  if (!queueId) {
    console.error(`autoresearch queue ${subcommand} requires --id <queue-id>`);
    process.exitCode = 1;
    return;
  }
  try {
    if (subcommand === "start") {
      const state = await startSweepQueue(cwd, queueId, {
        allowUnsafe: hasFlag("--allow-unsafe"),
        maxParallel: option("--max-parallel", null),
        cudaVisibleDevices: option("--cuda-visible-devices", option("--device-pool", null)),
      });
      if (String(option("--format", "text")) === "json") console.log(JSON.stringify(state, null, 2));
      else {
        console.log(`queue: ${state.queue_id}`);
        console.log(`status: ${state.status}`);
        console.log(`complete: ${state.counts.complete}/${state.counts.total}`);
        console.log(`max_parallel: ${state.max_parallel || 1}`);
      }
      return;
    }
    if (subcommand === "pause") {
      const state = setQueueStatus(cwd, queueId, "pausing", "queue_pause_requested");
      console.log(String(option("--format", "text")) === "json" ? JSON.stringify(state, null, 2) : `queue: ${state.queue_id} status=${state.status}`);
      return;
    }
    if (subcommand === "resume") {
      const state = setQueueStatus(cwd, queueId, "pending", "queue_resume_requested");
      console.log(String(option("--format", "text")) === "json" ? JSON.stringify(state, null, 2) : `queue: ${state.queue_id} status=${state.status}`);
      return;
    }
    if (subcommand === "cancel") {
      const state = setQueueStatus(cwd, queueId, "cancelled", "queue_cancel_requested");
      console.log(String(option("--format", "text")) === "json" ? JSON.stringify(state, null, 2) : `queue: ${state.queue_id} status=${state.status}`);
      return;
    }
    if (subcommand === "retry-failed") {
      const result = resetFailedTrialsForRetry(cwd, queueId);
      console.log(String(option("--format", "text")) === "json" ? JSON.stringify(result.state, null, 2) : `queue: ${result.state.queue_id} retry_pending=${result.changed}`);
      return;
    }
    if (subcommand === "delete" || subcommand === "clear") {
      const result = archiveSweepQueue(cwd, queueId);
      if (String(option("--format", "text")) === "json") console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`queue: ${result.queueId} deleted`);
        if (result.archivedQueue) console.log(`archived_queue: ${result.archivedQueue}`);
        if (result.archivedReport) console.log(`archived_report: ${result.archivedReport}`);
      }
      return;
    }
    if (subcommand === "report") {
      const written = writeSweepReport(cwd, queueId);
      if (String(option("--format", "text")) === "json") console.log(JSON.stringify(written, null, 2));
      else {
        console.log(`report: ${written.report}`);
        console.log(`summary: ${written.summary}`);
        console.log(`results: ${written.results}`);
      }
      return;
    }
    if (subcommand === "status") {
      const state = readQueueState(cwd, queueId);
      if (String(option("--format", "text")) === "json") console.log(JSON.stringify(state, null, 2));
      else {
        console.log(`queue: ${state.queue_id}`);
        console.log(`status: ${state.status}`);
        console.log(`total: ${state.counts.total}`);
        console.log(`complete: ${state.counts.complete}`);
        console.log(`failed: ${state.counts.failed}`);
        console.log(`pending: ${state.counts.pending}`);
        if (state.best) console.log(`best: ${state.best.run_id} ${state.metric}=${state.best.value}`);
      }
      return;
    }
    console.error(`Unknown queue command: ${subcommand}`);
    process.exitCode = 1;
  } catch (err) {
    console.error(`queue ${subcommand} error: ${err.message}`);
    process.exitCode = 1;
  }
}

function cmdSweepReport() {
  const cwd = targetDir();
  const queueId = String(option("--id", option("--queue-id", ""))).trim();
  if (!queueId) {
    console.error("autoresearch sweep-report requires --id <queue-id>");
    process.exitCode = 1;
    return;
  }
  try {
    const written = writeSweepReport(cwd, queueId);
    if (String(option("--format", "text")) === "json") console.log(JSON.stringify(written, null, 2));
    else {
      console.log(`report: ${written.report}`);
      console.log(`summary: ${written.summary}`);
      console.log(`results: ${written.results}`);
    }
  } catch (err) {
    console.error(`sweep-report error: ${err.message}`);
    process.exitCode = 1;
  }
}

function detectAnomalies(series, opts = {}) {
  const { spikeFactor = 5, plateauWindow = 8, plateauTolerance = 0.005 } = opts;
  const anomalies = [];
  if (!Array.isArray(series) || series.length === 0) {
    return anomalies;
  }
  for (let i = 0; i < series.length; i += 1) {
    const v = series[i];
    if (!Number.isFinite(v)) {
      anomalies.push({ kind: "divergence", step: i + 1, value: String(v) });
    }
  }
  const finite = series.map((v, i) => ({ v, i })).filter((p) => Number.isFinite(p.v));
  if (finite.length >= 3) {
    for (let k = 1; k < finite.length; k += 1) {
      const window = finite.slice(0, k).map((p) => p.v).slice().sort((a, b) => a - b);
      const mid = window[Math.floor(window.length / 2)];
      const ref = Math.max(Math.abs(mid), 1e-9);
      const curr = finite[k].v;
      if (Math.abs(curr) > spikeFactor * ref) {
        anomalies.push({
          kind: "spike",
          step: finite[k].i + 1,
          value: curr,
          median_prior: Number(mid.toFixed(6)),
          factor: Number((Math.abs(curr) / ref).toFixed(2)),
        });
      }
    }
  }
  if (finite.length >= plateauWindow) {
    const tail = finite.slice(-plateauWindow).map((p) => p.v);
    const tailMean = tail.reduce((a, b) => a + b, 0) / tail.length;
    const tailRange = Math.max(...tail) - Math.min(...tail);
    const ref = Math.max(Math.abs(tailMean), 1e-9);
    if (tailRange / ref < plateauTolerance) {
      anomalies.push({
        kind: "plateau",
        window: plateauWindow,
        mean: Number(tailMean.toFixed(6)),
        range: Number(tailRange.toFixed(6)),
        relative_range: Number((tailRange / ref).toFixed(6)),
      });
    }
  }
  return anomalies;
}

function cmdAnomalies() {
  const cwd = targetDir();
  const runId = option("--id", null);
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) {
    console.error("no run ledger found");
    process.exitCode = 1;
    return;
  }
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const rows = fs
    .readFileSync(ledger, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
  const candidates = runId && typeof runId === "string"
    ? rows.filter((r) => r.id === runId)
    : rows.filter((r) => r.metric_history && Object.keys(r.metric_history).length > 0);
  if (!candidates.length) {
    if (formatJson) {
      console.log(JSON.stringify({ runs: [] }));
    } else {
      console.log("no runs with metric_history found");
    }
    return;
  }
  const report = [];
  for (const row of candidates) {
    const history = row.metric_history || {};
    for (const [metric, series] of Object.entries(history)) {
      if (!Array.isArray(series) || series.length === 0) continue;
      const anomalies = detectAnomalies(series);
      report.push({
        run_id: row.id,
        metric,
        points: series.length,
        anomalies,
      });
    }
  }
  if (formatJson) {
    console.log(JSON.stringify({ runs: report }, null, 2));
    return;
  }
  if (!report.length) {
    console.log("no metric history found for selected runs");
    return;
  }
  for (const entry of report) {
    console.log(`run: ${entry.run_id}`);
    console.log(`metric: ${entry.metric}`);
    console.log(`points: ${entry.points}`);
    if (!entry.anomalies.length) {
      console.log("anomalies: none detected");
      console.log("");
      continue;
    }
    console.log(`anomalies: ${entry.anomalies.length}`);
    for (const a of entry.anomalies) {
      if (a.kind === "divergence") {
        console.log(`- divergence at step ${a.step}: ${a.value}`);
      } else if (a.kind === "spike") {
        console.log(`- spike at step ${a.step}: value=${a.value} (median prior=${a.median_prior}, factor=${a.factor}x)`);
      } else if (a.kind === "plateau") {
        console.log(`- plateau: last ${a.window} steps within ${(a.relative_range * 100).toFixed(2)}% of ${a.mean}`);
      }
    }
    console.log("");
  }
}

async function cmdLoop() {
  const cwd = targetDir();
  const goalFields = readGoalFields(cwd);
  const explicitCommand = option("--command", null);
  let cmdText = explicitCommand && typeof explicitCommand === "string" ? explicitCommand : "";
  if (!cmdText) {
    cmdText = goalFields.evaluation || goalFields.baseline;
  }
  if (!cmdText) {
    console.error("autoresearch loop: no command. Pass --command CMD or set evaluation/baseline in goal.md");
    process.exitCode = 1;
    return;
  }
  const itersRaw = option("--iters", "3");
  const iters = Math.max(1, parseInt(String(itersRaw), 10) || 3);
  const metricName = String(option("--metric", goalFields.metric || "val_loss")).trim();
  const regexSource = option("--regex", null);
  const timeoutSec = Number(option("--timeout", 600));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const direction = String(option("--direction", goalFields.direction || "lower")).toLowerCase();
  const preferHigher = direction === "higher" || direction === "max" || direction === "maximize";
  const patchCmd = option("--patch-cmd", null);
  const revertOnRegression = hasFlag("--revert-on-regression");
  const commitOnWin = hasFlag("--commit-on-win");
  const keepIf = String(option("--keep-if", "better")).toLowerCase();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const loopId = String(option("--id", `loop-${stamp}`));
  const loopStateFile = path.join(cwd, ".researchloop", "scratchpad", "loop_state.json");
  let priorState = {};
  if (fs.existsSync(loopStateFile)) {
    try { priorState = JSON.parse(fs.readFileSync(loopStateFile, "utf8")); } catch { priorState = {}; }
  }
  const startingBest = priorState && priorState.best && Number.isFinite(Number(priorState.best.value))
    ? Number(priorState.best.value)
    : null;
  let bestSoFar = startingBest;
  let bestId = priorState && priorState.best ? priorState.best.id : null;

  console.log(`autoresearch loop`);
  console.log(`command: ${cmdText}`);
  console.log(`iters: ${iters}`);
  console.log(`metric: ${metricName} (${preferHigher ? "higher" : "lower"})`);
  if (patchCmd && typeof patchCmd === "string") console.log(`patch-cmd: ${patchCmd}`);
  if (revertOnRegression) console.log("revert-on-regression: on");
  if (commitOnWin) console.log("commit-on-win: on");
  if (bestSoFar !== null) console.log(`prior best: ${bestId} = ${bestSoFar}`);
  console.log("---");

  const iterations = [];
  for (let i = 0; i < iters; i += 1) {
    const iterId = `${loopId}-iter${i}`;
    console.log(`[iter ${i}] ${iterId}`);
    if (patchCmd && typeof patchCmd === "string") {
      const patchResult = runCapture(patchCmd, cwd);
      if (!patchResult.ok) {
        console.log(`  patch failed: skipping iter`);
        iterations.push({ iter: i, id: iterId, status: "patch_failed", value: null, kept: false });
        continue;
      }
    }
    const res = await executeRun({
      cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe,
      isBaseline: false,
      idOverride: iterId,
      extraConfig: { loop_id: loopId, loop_iter: i },
      suppressExitCode: true,
      quiet: true,
      tags: ["loop", `loop:${loopId}`],
      parentId: loopId,
    });
    const value = res.metricValue;
    let improved = false;
    let same = false;
    if (value !== null && Number.isFinite(value)) {
      if (bestSoFar === null) {
        improved = true;
      } else if (preferHigher && value > bestSoFar) {
        improved = true;
      } else if (!preferHigher && value < bestSoFar) {
        improved = true;
      } else if (value === bestSoFar) {
        same = true;
      }
    }
    const keep = improved || (same && keepIf === "same");
    if (improved) {
      bestSoFar = value;
      bestId = iterId;
    }
    iterations.push({ iter: i, id: iterId, status: res.status, value, improved, kept: keep });
    const tag = improved ? "WIN" : (same ? "same" : "regression");
    console.log(`  → status=${res.status} ${metricName}=${value} (${tag})`);
    if (!keep) {
      if (revertOnRegression) {
        const rev = runCapture("git checkout -- .", cwd);
        if (rev.ok) console.log("  reverted working tree (git checkout -- .)");
        else console.log("  revert failed (no git repo or no tracked changes)");
      }
    } else if (commitOnWin) {
      const stageRes = runCapture("git add -A", cwd);
      if (stageRes.ok) {
        const message = `autoresearch loop: keep ${iterId} (${metricName}=${value})`;
        const c = runCapture(`git commit -m ${JSON.stringify(message)}`, cwd);
        if (c.ok) console.log("  committed working tree");
      }
    }
  }

  console.log("---");
  console.log(`iterations: ${iterations.length}`);
  console.log(`best: ${bestId} = ${bestSoFar}`);
  const wins = iterations.filter((it) => it.improved).length;
  console.log(`wins: ${wins}/${iterations.length}`);
  const newState = {
    loop_id: loopId,
    started_at_best: startingBest,
    best: bestId ? { id: bestId, value: bestSoFar, metric: metricName, direction: preferHigher ? "higher" : "lower" } : null,
    last_iterations: iterations,
    updated_at: new Date().toISOString(),
  };
  ensureDir(path.dirname(loopStateFile));
  fs.writeFileSync(loopStateFile, `${JSON.stringify(newState, null, 2)}\n`);
  console.log(`state: ${path.relative(cwd, loopStateFile)}`);
}

function cmdHelp() {
  console.log(`AutoResearch-AI ${packageVersion()}

Usage:
  autoresearch init [--agent codex|claude-code|hermes|cursor] [--dir PATH] [--force]
  autoresearch goal [TEXT] [--dir PATH] [--metric NAME] [--direction lower|higher] [--baseline CMD] [--evaluation CMD] [--allowed TEXT] [--forbidden TEXT]
  autoresearch inspect [--dir PATH]
  autoresearch idea [--dir PATH]
  autoresearch propose [--n N] [--write] [--with-priors] [--prior-limit N] [--offline] [--cache-dir PATH] [--mode propose|novel|autonomous] [--focus hyperparameters|architecture|attention|data] [--dir PATH]
  autoresearch rank [--input PATH] [--write] [--dir PATH] [--goal TEXT] [--write]
  autoresearch next-experiment [PROPOSAL_ID] [--proposal ID] [--input PATH] [--write] [--out FILE.md] [--script FILE.sh] [--run-id ID] [--format markdown|json] [--dir PATH]
  autoresearch prompt [--goal TEXT] [--focus hyperparameters|architecture|attention|training-ladder] [--agent NAME]
  autoresearch doctor [--dir PATH] [--python PATH] [--repair-plan]
  autoresearch infra-doctor [--dir PATH] [--python PATH] [--format text|json] [--write]
  autoresearch scaffold [--template python-benchmark|cpp-benchmark|cuda-basic|triton-operator|llm-serving] [--out PATH] [--agent NAME] [--force]
  autoresearch replay [RUN_ID] [--id RUN_ID] [--n N] [--metric NAME] [--tolerance N] [--timeout SECONDS] [--allow-unsafe] [--dir PATH]
  autoresearch record [--dir PATH] [--id ID] [--status STATUS] [--metric key=value] [--note TEXT]    (manual escape hatch; prefer 'run')
  autoresearch run [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--device auto|cpu|cuda|mps|directml] [--cuda-visible-devices LIST] [--tags TEXT] [--note TEXT] [--seeds N] [--allow-unsafe]
  autoresearch baseline [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--device auto|cpu|cuda|mps|directml] [--cuda-visible-devices LIST] [--tags TEXT] [--note TEXT] [--allow-unsafe]
  autoresearch sweep generate|status|run <name> [--dir PATH] [--metric NAME] [--direction lower|higher] [--workers N] [--max-failures K] [--format text|json] [--allow-unsafe]
  autoresearch sweep --spec FILE.json|yaml|csv [--metric NAME] [--seeds N] [--direction lower|higher] [--dry-run] [--allow-unsafe] [--dir PATH] (legacy one-shot run)
  autoresearch sweep validate|preview|create --spec FILE.json|yaml|csv [--dir PATH] [--format text|json]
  autoresearch queue start|pause|resume|cancel|retry-failed|delete|clear|status|report --id QUEUE_ID [--dir PATH] [--max-parallel N] [--cuda-visible-devices LIST] [--format text|json]
  autoresearch sweep-report --id QUEUE_ID [--dir PATH] [--format text|json]
  autoresearch loop --command CMD [--iters N] [--metric NAME] [--direction lower|higher] [--patch-cmd CMD] [--revert-on-regression] [--commit-on-win] [--keep-if better|same] [--dir PATH]
  autoresearch anomalies [--id RUN_ID] [--format text|json] [--dir PATH]
  autoresearch verify --id <run-id> [--metric NAME] [--tolerance N] [--timeout SECONDS] [--allow-unsafe] [--dir PATH]
  autoresearch preflight [--command CMD] [--require-gpu] [--min-disk-gb N] [--min-mem-gb N] [--format text|json] [--dir PATH]
  autoresearch resume [RUN_ID] [--id RUN_ID] [--command CMD] [--metric NAME] [--timeout SECONDS] [--dry-run] [--allow-unsafe] [--dir PATH]
  autoresearch scan-papers [--dir PATH] [--query TEXT] [--limit N] [--since YYYY-MM] [--cache-dir PATH] [--offline]
  autoresearch eval [--run-id ID] [--command CMD] [--format text|json] [--allow-unsafe] [--dir PATH]
  autoresearch compare [--dir PATH] [--metric NAME] [--direction lower|higher]
  autoresearch metric-tiers init|show|score [--profile hpc_operator|model_inference|ai_infra_training] [--format text|json] [--dir PATH]
  autoresearch team [--dir PATH] [--workers N] [--goal TEXT] [--force]
  autoresearch tasks add|claim|done|status [--dir PATH] [--agent NAME] [--lane worker|reviewer|orchestrator] [--depends TASK_ID] [--format text|json]
  autoresearch dashboard [--dir PATH] [--host HOST] [--port PORT]
  autoresearch report [--dir PATH] [--format text|markdown] [--out report.md] [--include-plots]
  autoresearch portfolio [--dir PATH] [--out FILE.md] [--python PATH] [--no-env]
  autoresearch audit <file.md> [--tolerance N] [--dir PATH]
  autoresearch baseline-status [--dir PATH]
  autoresearch baseline --lock [--dir PATH]
  autoresearch baseline --unlock [--dir PATH] [--format json]
  autoresearch failures [--top N] [--format json] [--dir PATH]
  autoresearch diff-runs --id-a <id> --id-b <id> [--format text|json|markdown] [--dir PATH]
  autoresearch paper-read <paper-id> [--from arxiv|local] [--cache-dir PATH] [--write] [--dir PATH]
  autoresearch paper-reread <paper-id> --against <run-id> [--write] [--format text|json|markdown] [--dir PATH]
  autoresearch priors --proposal <id> [--limit N] [--offline] [--cache-dir PATH] [--input PATH] [--dir PATH]
  autoresearch hypothesis [--from-papers] [--from-runs] [--paper-id ID] [--run-id ID] [--novel] [--write] [--dir PATH]
  autoresearch prune [--older-than Nd] [--status STATUS] [--dry-run] [--no-keep-promoted] [--dir PATH]
  autoresearch data-fingerprint [--dir PATH]
  autoresearch model-card --id <run-id> [--out FILE.md] [--dir PATH]
  autoresearch tag --id <run-id> [--add TAG] [--remove TAG] [--list] [--dir PATH]\n  autoresearch digest [--since DURATION] [--format text|json|markdown] [--dir PATH]\n  autoresearch param-importance [--metric METRIC] [--format table|json] [--dir PATH]\n  autoresearch suggest [--n N] [--metric METRIC] [--direction higher|lower] [--format text|json] [--dir PATH]
  autoresearch topic "<text>" [--mode propose|novel|autonomous] [--dir PATH] [--write]
  autoresearch query "<expression>" [--format jsonl|table] [--dir PATH]
  autoresearch curves --id <run-id> [--format text|json|jsonl] [--dir PATH]
  autoresearch promote --id <run-id> [--note TEXT] [--force] [--skip-review] [--dir PATH]
  autoresearch review --id <run-id> [--format text|json|markdown] [--out FILE.md] [--dir PATH]
  autoresearch significance <run-a> <run-b> [--metric NAME] [--alpha N] [--n-permutations N] [--seed N] [--direction lower|higher] [--format text|json] [--require-significant] [--dir PATH]
  autoresearch determinism --command CMD [--n N] [--metric NAME] [--tolerance N] [--seed N] [--timeout SECONDS] [--format text|json] [--no-exit-code] [--allow-unsafe] [--dir PATH]
  autoresearch power [--baseline-std N] [--detect-delta N] [--n N] [--alpha 0.05] [--power 0.8] [--metric NAME] [--format text|json] [--dir PATH]
  autoresearch similar <run-id> [--k N] [--metric NAME] [--param-weight 0..1] [--format text|json] [--dir PATH]
  autoresearch learn --id <run-id> [--lesson "TEXT"] [--list] [--search QUERY] [--export] [--out FILE] [--format text|json] [--dir PATH]
  autoresearch archive --id <run-id> --reason "TEXT" [--mechanism TEXT] [--restore] [--list] [--format text|json] [--dir PATH]
  autoresearch forecast --command CMD | --similar-to <run-id> [--k N] [--format text|json] [--dir PATH]
  autoresearch pareto --metrics m1,m2[,...] [--direction m1=lower,m2=higher] [--format text|json] [--dir PATH]
  autoresearch ablate <run-id> [--n N] [--write] [--out FILE.jsonl] [--format text|json] [--dir PATH]
  autoresearch compute-budget [--params N] [--tokens N] [--flops N] [--gpu-days N] [--gpus N] [--tflops N] [--mfu 0.5] [--tokens-per-param 20] [--format text|json]
  autoresearch mechanisms [--check "TEXT"] [--for <run-id>] [--metric NAME] [--format text|json] [--dir PATH]
  autoresearch disk-check [--min-free-gb N] [--path PATH ...] [--format text|json] [--dir PATH]
  autoresearch leaderboard [--metric NAME] [--direction lower|higher] [--top N] [--since 7d] [--include complete|all] [--format text|json] [--dir PATH]
  autoresearch bibtex [--file report.md] [--all] [--out refs.bib] [--format text|json] [--dir PATH]
  autoresearch seed [--set N] [--bump] [--clear] [--env] [--format text|json] [--dir PATH]
  autoresearch pr-bundle <run-id> [--baseline-id ID] [--out FILE.md] [--dashboard-url URL] [--dir PATH]
  autoresearch agent-memory [--metric NAME] [--direction lower|higher] [--out FILE.md] [--format text|json] [--dir PATH]
  autoresearch story <run-id> [--format text|json] [--dir PATH]
  autoresearch smoke --command CMD [--seconds N] [--metric NAME] [--id ID] [--allow-unsafe] [--dir PATH]
  autoresearch share <run-id> [--out FILE.tar.gz] [--dir PATH]
  autoresearch bench list | info <id> | add <id> [--dry-run] [--format text|json] [--dir PATH]
  autoresearch slurm --command CMD [--partition NAME] [--gpus N] [--cpus N] [--mem 32G] [--time HH:MM:SS] [--nodes N] [--account NAME] [--constraint NAME] [--env-script PATH] [--modules m1,m2] [--exclusive] [--id ID] [--metric NAME] [--timeout SECONDS] [--allow-unsafe] [--out FILE.sbatch] [--dir PATH]
  autoresearch retrospective [--since 7d] [--metric NAME] [--direction lower|higher] [--out FILE.md] [--format text|json] [--dir PATH]
  autoresearch lit-diff <paper-a> <paper-b> [--unified] [--format text|json] [--dir PATH]
  autoresearch budget [--set USD] [--clear] [--check] [--note TEXT] [--format text|json] [--dir PATH]
  autoresearch fork <run-id> [--bump key=value ...] [--new-id ID] [--seeds N] [--out FILE.sh] [--dry-run] [--dir PATH]
  autoresearch validate-config [--format text|json] [--dir PATH]
  autoresearch eta <run-id> [--total-steps N] [--format text|json] [--dir PATH]
  autoresearch summary [--metric NAME] [--direction lower|higher] [--format text|json] [--out FILE.md] [--dir PATH]
  autoresearch hardware [--format text|json] [--dir PATH]
  autoresearch hooks list | install <event> | remove <event> | test <event> | env-template [--into FILE] [--file PATH] [--dir PATH]
  autoresearch data-sample --path FILE [--n N] [--seed N] [--label FIELD] [--format text|json] [--dir PATH]
  autoresearch canary --eval EVAL.jsonl --train TRAIN.jsonl [--substring] [--min-len N] [--max-show N] [--format text|json] [--dir PATH]
  autoresearch stale-locks [--clean] [--max-age MINUTES] [--format text|json] [--dir PATH]
  autoresearch reset --id <run-id> [--force] [--no-archive] [--format text|json] [--dir PATH]
  autoresearch question add "TEXT" [--run RUN_ID ...] | list [--open|--answered|--closed] | answer <id> "ANSWER" | close <id> [--format text|json] [--dir PATH]
  autoresearch search "TEXT" [--include ledger,papers,...] [--context N] [--format text|json] [--dir PATH]
  autoresearch tail <run-id> [--follow|-f] [--lines N] [--metrics] [--latest] [--dir PATH]
  autoresearch container-snapshot --id <run-id> [--gpu] [--out DIR] [--dir PATH]
  autoresearch warmstart <run-id> [--new-id ID] [--checkpoint PATH] [--command CMD] [--metric NAME] [--out FILE.sh] [--dry-run] [--dir PATH]
  autoresearch gpu-report [--top N] [--format text|json] [--dir PATH]
  autoresearch gpu-fit --params 7B | --layers N --d-model N [--d-ff N] [--vocab N] [--batch N] [--seq N] [--dtype bf16|fp16|fp32|fp8] [--optimizer adamw|sgd|adam8bit] [--grad-checkpoint] [--tp N] [--dp N] [--zero 0|1|2|3] [--format text|json]
  autoresearch eval-diff --a runA/predictions.jsonl --b runB/predictions.jsonl [--field correct] [--id-key id] [--max-show N] [--format text|json]
  autoresearch scaling-fit [--metric NAME] [--x compute|flops|params|tokens|wall_seconds] [--with-offset] [--target N] [--format text|json] [--dir PATH]
  autoresearch sample-efficiency <run-id> [--metric NAME] [--direction lower|higher] [--vs BASELINE_ID] [--plateau-threshold 0.005] [--format text|json] [--dir PATH]
  autoresearch rl-stats <run-id> | --file rewards.jsonl [--success-threshold N] [--vs BASELINE_ID] [--metric episode_return] [--bootstrap 1000] [--format text|json] [--dir PATH]
  autoresearch sweep-projection --name <sweep> | --spec FILE.yaml | --n N [--seconds-per-run N] [--cost-per-run N] [--workers N] [--format text|json] [--dir PATH]
  autoresearch headroom [--metric NAME] [--direction lower|higher] [--ceiling N] [--sota N] [--baseline N] [--current N] [--format text|json] [--dir PATH]
  autoresearch mfu [RUN_ID] [--params 7B] [--layers N] [--d-model N] [--batch N] [--seq N] [--tokens N] [--gpu H100] [--tflops N] [--gpus N] [--format text|json] [--dir PATH]
  autoresearch kv-cache --layers N --n-kv-heads N --head-dim N [--n-heads N] [--params 70B] [--context N] [--batch N] [--gpu H100] [--kv-dtype fp16|fp8|int8] [--weights-dtype fp16|int8|int4] [--format text|json]
  autoresearch lr-finder --file lrtest.jsonl | --id <run-id> [--smoothing 0.05] [--format text|json] [--dir PATH]
  autoresearch overfit-watch <run-id> [--train-metric train_loss] [--val-metric val_loss] [--direction lower|higher] [--gap-threshold 0.05] [--format text|json] [--dir PATH]
  autoresearch shard-plan --params 70B --layers 80 --d-model 8192 [--d-ff N] [--vocab N] [--batch 1] [--seq 8192] [--dtype bf16|fp16|fp8] [--optimizer adamw|sgd|adam8bit] [--grad-checkpoint] [--zero 0|1|2|3] [--gpus N] [--gpu H100] [--vram-gb N] [--reserve-gb N] [--format text|json]
  autoresearch elo --file wins.jsonl [--k 4] [--bootstrap 200] [--format text|json]
  autoresearch api-budget --provider claude-opus-4-7 --prompts N --avg-input-tokens N --avg-output-tokens N | --file prompts.jsonl [--field prompt] [--input-price USD] [--output-price USD] [--tokens-per-char 0.25] [--list] [--format text|json]
  autoresearch judge --candidates pairs.jsonl --mode pairwise|scalar|reference --judge MODEL [--out judge_prompts.jsonl] [--avg-output-tokens N] [--format text|json]
  autoresearch judge --parse outputs.jsonl --prompts judge_prompts.jsonl --mode pairwise|scalar|reference [--out parsed.jsonl]
  autoresearch grad-noise --norm-small N --batch-small N --norm-big N --batch-big N | --file grad_norms.jsonl | --id <run-id> [--batch N] [--format text|json] [--dir PATH]
  autoresearch memorization --outputs gens.jsonl --train train.txt | --train-globs f1.txt,f2.txt [--n 50] [--report-threshold N] [--max-show N] [--format text|json]
  autoresearch --version

Aliases:
  autoresearch-ai
  researchloop    legacy alias, still supported

AutoResearch-AI installs docs, prompts, scratchpads, and experiment ledgers for autonomous AI research agents.
`);
}

async function main() {
  if (hasFlag("--version") || command === "version") {
    console.log(packageVersion());
    return;
  }
  if (hasFlag("--list-commands") || command === "list-commands" || command === "commands") {
    cmdListCommands();
    return;
  }
  if (hasFlag("--help") || command === "help") {
    cmdHelp();
  } else if (command === "init") {
    cmdInit();
  } else if (command === "goal") {
    cmdGoal();
  } else if (command === "inspect") {
    cmdInspect();
  } else if (command === "idea") {
    cmdIdea();
  } else if (command === "propose") {
    await cmdPropose();
  } else if (command === "rank") {
    cmdRank();
  } else if (command === "next-experiment" || command === "next") {
    cmdNextExperiment({ args, option, hasFlag, targetDir });
  } else if (command === "prompt") {
    cmdPrompt();
  } else if (command === "doctor") {
    cmdDoctor();
  } else if (command === "infra-doctor" || command === "infra") {
    cmdInfraDoctor();
  } else if (command === "scaffold") {
    cmdScaffold();
  } else if (command === "replay") {
    await cmdReplay();
  } else if (command === "record") {
    cmdRecord();
  } else if (command === "run") {
    await cmdRun(false);
  } else if (command === "baseline") {
    const lock = checkBaselineDrift();
    if (lock) {
      console.error("WARNING: baseline is drifted:");
      for (const w of lock) console.error("  " + w);
    }
    if (hasFlag("--lock")) {
      cmdBaselineLock();
    } else if (hasFlag("--unlock")) {
      cmdBaselineLock();
    } else {
      await cmdRun(true);
    }
  } else if (command === "scan-papers") {
    await cmdScanPapers();
  } else if (command === "eval") {
    await cmdEval();
  } else if (command === "priors") {
    await cmdPriors();
  } else if (command === "paper-read") {
    await cmdPaperRead({ args, option, hasFlag, positionalText, targetDir });
  } else if (command === "paper-reread") {
    await cmdPaperReread({ args, option, hasFlag, positionalText, targetDir });
  } else if (command === "compare") {
    cmdCompare();
  } else if (command === "metric-tiers") {
    cmdMetricTiers();
  } else if (command === "team") {
    cmdTeam();
  } else if (command === "tasks") {
    await cmdTasks({ args, option, optionsAll, hasFlag, targetDir });
  } else if (command === "dashboard") {
    cmdDashboard();
  } else if (command === "report") {
    cmdReport();
  } else if (command === "portfolio") {
    cmdPortfolio();
  } else if (command === "audit") {
    cmdAudit();
  } else if (command === "baseline-status") {
    cmdBaselineStatus();
  } else if (command === "failures") {
    cmdFailures();
  } else if (command === "diff-runs") {
    cmdDiffRuns();
  } else if (command === "prune") {
    cmdPrune();
  } else if (command === "model-card") {
    cmdModelCard();
  } else if (command === "tag") {
    cmdTag();
  } else if (command === "data-fingerprint") {
    cmdDataFingerprint();
  } else if (command === "digest") {
    cmdDigest();
  } else if (command === "param-importance") {
    cmdParamImportance();
  } else if (command === "suggest") {
    cmdSuggest();
  } else if (command === "topic") {
    cmdTopic();
  } else if (command === "hypothesis") {
    cmdHypothesis({ args, option, hasFlag, targetDir });
  } else if (command === "query") {
    cmdQuery();
  } else if (command === "approvals") {
    cmdApprovals();
  } else if (command === "sweep") {
    await cmdSweep();
  } else if (command === "queue") {
    await cmdQueue();
  } else if (command === "sweep-report") {
    cmdSweepReport();
  } else if (command === "loop") {
    await cmdLoop();
  } else if (command === "anomalies" || command === "anomaly") {
    cmdAnomalies();
  } else if (command === "verify") {
    await cmdVerify();
  } else if (command === "preflight" || command === "preflight-check") {
    cmdPreflight();
  } else if (command === "resume") {
    await cmdResume();
  } else if (command === "curves" || command === "curve") {
    cmdCurves();
  } else if (command === "promote") {
    cmdPromote();
  } else if (command === "review") {
    cmdReview();
  } else if (command === "significance" || command === "sig") {
    await cmdSignificance();
  } else if (command === "determinism" || command === "det") {
    await cmdDeterminism({ args, option, hasFlag, targetDir, appendRunRow });
  } else if (command === "power") {
    await cmdPower({ option, hasFlag, targetDir });
  } else if (command === "similar") {
    await cmdSimilar({ args, option, targetDir });
  } else if (command === "learn") {
    await cmdLearn({ option, hasFlag, targetDir });
  } else if (command === "archive") {
    await cmdArchive({ option, hasFlag, targetDir });
  } else if (command === "forecast") {
    await cmdForecast({ option, targetDir });
  } else if (command === "pareto") {
    await cmdPareto({ option, targetDir });
  } else if (command === "ablate") {
    await cmdAblate({ args, option, hasFlag, targetDir });
  } else if (command === "compute-budget" || command === "compute") {
    await cmdCompute({ option, targetDir });
  } else if (command === "mechanisms" || command === "mechanism-dict") {
    await cmdMechanisms({ args, option, hasFlag, targetDir });
  } else if (command === "disk-check" || command === "disk") {
    await cmdDiskCheck({ option, targetDir, optionsAll });
  } else if (command === "leaderboard" || command === "top") {
    await cmdLeaderboard({ option, targetDir });
  } else if (command === "bibtex" || command === "bib") {
    await cmdBibtex({ option, hasFlag, targetDir });
  } else if (command === "seed") {
    await cmdSeed({ option, hasFlag, targetDir });
  } else if (command === "pr-bundle" || command === "pr") {
    await cmdPrBundle({ args, option, targetDir });
  } else if (command === "agent-memory" || command === "memory") {
    await cmdAgentMemory({ option, targetDir });
  } else if (command === "story") {
    await cmdStory({ args, option, targetDir });
  } else if (command === "smoke" || command === "smoke-test") {
    await cmdSmoke({ option, hasFlag, targetDir });
  } else if (command === "share") {
    await cmdShare({ args, option, targetDir });
  } else if (command === "bench" || command === "benchmark") {
    await cmdBench({ args, option, hasFlag, targetDir });
  } else if (command === "slurm" || command === "sbatch") {
    await cmdSlurm({ option, hasFlag, targetDir });
  } else if (command === "retrospective" || command === "retro") {
    await cmdRetrospective({ option, targetDir });
  } else if (command === "lit-diff" || command === "litdiff") {
    await cmdLitDiff({ args, option, hasFlag, targetDir });
  } else if (command === "budget") {
    await cmdBudget({ option, hasFlag, targetDir });
  } else if (command === "fork") {
    await cmdFork({ args, option, hasFlag, targetDir, optionsAll });
  } else if (command === "validate-config" || command === "validate") {
    await cmdValidateConfig({ option, targetDir });
  } else if (command === "eta") {
    await cmdEta({ args, option, targetDir });
  } else if (command === "summary" || command === "status") {
    await cmdSummary({ option, targetDir });
  } else if (command === "hardware" || command === "hw") {
    await cmdHardware({ option, targetDir });
  } else if (command === "hooks" || command === "hook") {
    await cmdHooks({ args, option, hasFlag, targetDir });
  } else if (command === "data-sample" || command === "sample-data") {
    await cmdDataSample({ option, targetDir });
  } else if (command === "canary") {
    await cmdCanary({ option, hasFlag, targetDir });
  } else if (command === "stale-locks" || command === "locks") {
    await cmdStaleLocks({ option, hasFlag, targetDir });
  } else if (command === "reset") {
    await cmdReset({ option, hasFlag, targetDir });
  } else if (command === "question" || command === "q") {
    await cmdQuestion({ args, option, hasFlag, targetDir, optionsAll });
  } else if (command === "search" || command === "grep") {
    await cmdSearch({ args, option, hasFlag, targetDir });
  } else if (command === "tail") {
    await cmdTail({ args, option, hasFlag, targetDir });
  } else if (command === "container-snapshot" || command === "container") {
    await cmdContainerSnapshot({ option, hasFlag, targetDir });
  } else if (command === "warmstart") {
    await cmdWarmstart({ args, option, hasFlag, targetDir });
  } else if (command === "gpu-report" || command === "gpu") {
    await cmdGpuReport({ option, targetDir });
  } else if (command === "gpu-fit" || command === "vram-fit" || command === "vram") {
    await cmdGpuFit({ option, hasFlag });
  } else if (command === "eval-diff" || command === "predictions-diff") {
    await cmdEvalDiff({ option });
  } else if (command === "scaling-fit" || command === "scaling") {
    await cmdScalingFit({ option, hasFlag, targetDir });
  } else if (command === "sample-efficiency" || command === "se") {
    await cmdSampleEfficiency({ args, option, targetDir });
  } else if (command === "rl-stats" || command === "rl") {
    await cmdRlStats({ args, option, targetDir });
  } else if (command === "sweep-projection" || command === "sweep-project" || command === "project-sweep") {
    await cmdSweepProjection({ option, targetDir });
  } else if (command === "headroom") {
    await cmdHeadroom({ option, targetDir });
  } else if (command === "mfu") {
    await cmdMfu({ args, option, hasFlag, targetDir });
  } else if (command === "kv-cache" || command === "kv") {
    await cmdKvCache({ option });
  } else if (command === "lr-finder" || command === "lrfinder" || command === "find-lr") {
    await cmdLrFinder({ option, targetDir });
  } else if (command === "overfit-watch" || command === "overfit") {
    await cmdOverfitWatch({ args, option, targetDir });
  } else if (command === "shard-plan" || command === "parallelism" || command === "shard") {
    await cmdShardPlan({ option, hasFlag });
  } else if (command === "elo" || command === "arena") {
    await cmdElo({ option });
  } else if (command === "api-budget" || command === "api-cost" || command === "tokens-cost") {
    await cmdApiBudget({ option, hasFlag });
  } else if (command === "judge") {
    await cmdJudge({ option, hasFlag, targetDir });
  } else if (command === "grad-noise" || command === "gns" || command === "gradient-noise") {
    await cmdGradNoise({ option, targetDir });
  } else if (command === "memorization" || command === "memo" || command === "verbatim-check") {
    await cmdMemorization({ option });
  } else {
    console.error(`Unknown command: ${command}`);
    cmdHelp();
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
