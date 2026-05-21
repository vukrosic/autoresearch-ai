#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

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
  return runs.find((row) => row && !row.parse_error && String(row.id) === String(runId)) || null;
}

function appendRunRow(cwd, row) {
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  ensureDir(path.dirname(ledger));
  fs.appendFileSync(ledger, `${JSON.stringify(row)}\n`);
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
    const value = raw !== null && raw !== undefined && raw !== "" ? Number(raw) : Number.NaN;
    if (Number.isFinite(value)) return value;
  }
  if (row?.metrics) {
    for (const raw of Object.values(row.metrics)) {
      const num = raw !== null && raw !== undefined && raw !== "" ? Number(raw) : Number.NaN;
      if (Number.isFinite(num)) return num;
    }
  }
  const fallback = row?.value !== null && row?.value !== undefined && row?.value !== "" ? Number(row.value) : Number.NaN;
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

function renderMarkdownReport(cwd, runs, goal, plan, opts = {}) {
  const cleanRuns = runs.filter((row) => row && !row.parse_error);
  const primaryMetric = choosePrimaryMetric(goal, cleanRuns);
  const preferHigher = String(goal.direction || "").toLowerCase().includes("high");
  const entries = buildReportMetricEntries(cleanRuns, primaryMetric, preferHigher);
  const best = entries[0] || null;
  const worst = entries[entries.length - 1] || null;
  const traces = buildRunTraces(cwd, cleanRuns, primaryMetric, preferHigher);
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
      values.push({ runId: row.id, metric, value: Number(raw) });
    }
    if (isNumericMetric(row.value)) {
      values.push({ runId: row.id, metric: "value", value: Number(row.value) });
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
    const valA = Number(rowA.metrics?.[key]);
    const valB = Number(rowB.metrics?.[key]);
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

function summarizeTraces(traces, preferHigher = false) {
  const finalEntries = traces
    .map((trace) => ({ trace, final: Number(trace.final) }))
    .filter((entry) => Number.isFinite(entry.final));
  const sorted = finalEntries
    .slice()
    .sort((a, b) => (preferHigher ? b.final - a.final : a.final - b.final));
  const bestFinal = sorted[0] || null;
  const worstFinal = sorted[sorted.length - 1] || null;

  const improved = traces
    .map((trace) => {
      const first = Number(trace.values?.[0]?.value);
      const final = Number(trace.final);
      return {
        trace,
        delta: Number.isFinite(first) && Number.isFinite(final)
          ? (preferHigher ? final - first : first - final)
          : Number.NaN,
      };
    })
    .filter((entry) => Number.isFinite(entry.delta))
    .sort((a, b) => b.delta - a.delta);

  return {
    bestFinal,
    worstFinal,
    bestImprovement: improved[0] || null,
  };
}

function buildRunTraces(cwd, runs, primaryMetric, preferHigher, customRegexSource) {
  const palette = [
    "#62d6a6",
    "#71a7ff",
    "#f6c177",
    "#ff8b8b",
    "#c38bff",
    "#6ee7e7",
  ];

  return runs
    .filter((run) => !run.parse_error)
    .map((run, index) => {
      const values = readRunMetricSeries(cwd, run, primaryMetric, customRegexSource);
      const metricRaw = run?.metrics?.[primaryMetric];
      const finalFromMetrics = metricRaw !== null && metricRaw !== undefined && metricRaw !== "" ? Number(metricRaw) : Number.NaN;
      const final = Number.isFinite(finalFromMetrics)
        ? finalFromMetrics
        : Number(values.length ? values[values.length - 1].value : Number.NaN);
      const fallbackValues = values.length
        ? values
        : (Number.isFinite(final) ? [{ step: 1, value: final }] : []);
      return {
        id: run.id,
        status: run.status,
        final,
        values: fallbackValues,
        log: run.log || "",
        notes: run.notes || "",
        color: palette[index % palette.length],
        isBest: false,
        isLatest: false,
        index,
      };
    })
    .filter((trace) => trace.values.length || Number.isFinite(trace.final))
    .map((trace) => ({
      ...trace,
      final: Number.isFinite(trace.final) ? trace.final : (trace.values.length ? trace.values[trace.values.length - 1].value : Number.NaN),
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

function readSystemMetrics() {
  const cpus = os.cpus() || [];
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
  const cpuCount = cpus.length || 1;
  const loadPct = Math.min(100, (loadAvg[0] / cpuCount) * 100);
  const platform = `${os.platform()} ${os.arch()}`;
  const hostname = os.hostname();
  const nodeVersion = process.version;

  return {
    hostname,
    platform,
    nodeVersion,
    uptimeSeconds: Math.round(os.uptime()),
    cpu: {
      count: cpuCount,
      model: cpus[0]?.model || "unknown",
      loadAvg: { "1m": loadAvg[0], "5m": loadAvg[1], "15m": loadAvg[2] },
      usagePct: Number.isFinite(loadPct) ? Number(loadPct.toFixed(1)) : 0,
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usagePct: Number(memPct.toFixed(1)),
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
  let recentlyTouched = false;
  if (logTail?.modifiedAt) {
    const mtime = new Date(logTail.modifiedAt).getTime();
    if (Number.isFinite(mtime)) {
      recentlyTouched = Date.now() - mtime < 60_000;
    }
  }
  if (!statusActive && !recentlyTouched) return { active: false, latestId: latest.id };
  return {
    active: true,
    latestId: latest.id,
    runId: latest.id,
    command: latest.command || "",
    agent: latest.agent || "",
    startedAt: latest.started_at || latest.timestamp || null,
    logPath: latest.log || "",
    logModifiedAt: logTail?.modifiedAt || null,
    reason: statusActive ? "status" : "log_recent",
    est_cost_usd: latest.est_cost_usd ?? null,
  };
}

function buildDashboardState(cwd) {
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
  const traces = buildRunTraces(cwd, runs, primaryMetric, preferHigher);
  const comparison = summarizeTraces(traces, preferHigher);
  const system = readSystemMetrics();
  const thread = readThreadTail(cwd, 24);
  const logTail = readLatestLogTail(cwd, runs, 30);
  const activeRun = detectActiveRun(cwd, runs, logTail);

  return {
    cwd,
    generatedAt: new Date().toISOString(),
    goal,
    plan,
    repoProfile,
    runs,
    primaryMetric,
    preferHigher,
    summary,
    traces,
    comparison,
    system,
    thread,
    logTail,
    activeRun,
  };
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

function readCurvesForRun(cwd, runId) {
  if (!runId) return { run_id: null, error: "missing run id", series: [] };
  const safeId = String(runId).replace(/[^A-Za-z0-9._-]/g, "");
  if (safeId !== String(runId)) {
    return { run_id: runId, error: "invalid run id", series: [] };
  }
  const file = path.join(cwd, ".researchloop", "scratchpad", "runs", safeId, "metrics.jsonl");
  if (!fs.existsSync(file)) {
    return { run_id: safeId, error: "no metrics.jsonl for run", series: [] };
  }
  const series = [];
  const raw = fs.readFileSync(file, "utf8").trim();
  if (!raw) return { run_id: safeId, series: [] };
  for (const line of raw.split("\n")) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && Number.isFinite(Number(obj.step))) {
        series.push({
          metric: obj.metric ?? null,
          step: Number(obj.step),
          value: obj.value === null || obj.value === undefined ? null : Number(obj.value),
        });
      }
    } catch { /* skip malformed */ }
  }
  return { run_id: safeId, series };
}

function cmdDashboard() {
  const cwd = targetDir();
  const host = String(option("--host", "127.0.0.1"));
  const port = Number(option("--port", 8787));
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (!loopbackHosts.has(host)) {
    console.error("");
    console.error(`WARNING: --host ${host} is not loopback.`);
    console.error("The dashboard has no auth. Anyone who can reach this address can read");
    console.error("your run ledger, goal, and plan files. Press Ctrl+C now if that is not");
    console.error("what you want, and re-run without --host to stay on 127.0.0.1.");
    console.error("");
  }
  const dashboardFile = path.join(templatesRoot, "dashboard", "index.html");
  const html = readTextIfExists(dashboardFile);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (url.pathname === "/api/state") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(buildDashboardState(cwd), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/runs") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(cwd);
      res.end(`${JSON.stringify(state.runs, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/goal") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(cwd);
      res.end(`${JSON.stringify(state.goal, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/system") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(readSystemMetrics(), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/thread") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(`${JSON.stringify(readThreadTail(cwd, 50), null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/log-tail") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const state = buildDashboardState(cwd);
      res.end(`${JSON.stringify(state.logTail || null, null, 2)}\n`);
      return;
    }
    if (url.pathname === "/api/curves") {
      // Returns the streamed metric series for a single run (G06 foundation).
      // Reads .researchloop/scratchpad/runs/<id>/metrics.jsonl, which is now
      // written line-by-line during the run by spawnCommand's onLine hook.
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      const runId = url.searchParams.get("run") || url.searchParams.get("id");
      const payload = readCurvesForRun(cwd, runId);
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
}

function rowMetricValue(row, key) {
  if (!row || !row.metrics || !(key in row.metrics)) {
    return Number.NaN;
  }
  return Number(row.metrics[key]);
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
  return new RegExp(`["']?${escaped}["']?\\s*[:=]\\s*["']?(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`, "gi");
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
    return { earlyStop: [], gates: [], checkpointGlob: null, resumeFlagTemplate: null, present: false };
  }
  const raw = fs.readFileSync(evalFile, "utf8");
  return {
    earlyStop: parseEvalListSection(raw, "early_stop"),
    gates: parseEvalListSection(raw, "gates"),
    checkpointGlob: parseEvalScalar(raw, "checkpoint_glob"),
    resumeFlagTemplate: parseEvalScalar(raw, "resume_flag_template"),
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

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
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
      if (Number.isFinite(Number(v))) return Number(v);
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
        if (Number.isFinite(Number(v))) return Number(v);
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
    const value = Number(finalMetrics?.[metric]);
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

function startSystemSampler(runDir, intervalMs = 5000) {
  const file = path.join(runDir, "system.jsonl");
  fs.writeFileSync(file, "");
  const agg = {
    samples: 0,
    gpu_present: false,
    gpu_count: 0,
    gpu_util_max_pct: 0,
    gpu_util_sum_pct: 0,
    gpu_memory_peak_mb: 0,
    gpu_memory_total_mb: 0,
  };
  const sample = () => {
    const load = os.loadavg();
    const gpus = probeGpuStats();
    const row = {
      ts: new Date().toISOString(),
      load_avg_1m: load[0],
      load_avg_5m: load[1],
      load_avg_15m: load[2],
      mem_total_bytes: os.totalmem(),
      mem_free_bytes: os.freemem(),
      gpus: gpus || null,
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
    try {
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    } catch {
      // run dir may have been removed mid-sample; ignore
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  const stop = () => {
    clearInterval(timer);
  };
  stop.getAggregates = () => {
    const meanUtil = agg.samples > 0 && agg.gpu_present
      ? Number((agg.gpu_util_sum_pct / agg.samples).toFixed(2))
      : null;
    return {
      gpu_present: agg.gpu_present,
      gpu_count: agg.gpu_count || null,
      gpu_util_max_pct: agg.gpu_present ? agg.gpu_util_max_pct : null,
      gpu_util_mean_pct: meanUtil,
      gpu_memory_peak_mb: agg.gpu_present ? agg.gpu_memory_peak_mb : null,
      gpu_memory_total_mb: agg.gpu_present ? agg.gpu_memory_total_mb || null : null,
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
  const { onLine = null } = opts;
  return new Promise((resolve) => {
    // detached:true puts the shell into its own process group so we can signal
    // the whole group (shell + any grandchildren like `sleep`). Without this,
    // killing the shell leaves grandchildren holding the stdout pipe and
    // child.on('close') never fires.
    const child = spawn(commandText, { cwd, shell: true, env: childEnv, detached: true });
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
      process.stdout.write(data);
      logStream.write(data);
      drainBuffer(data.toString("utf8"), "out");
    });
    child.stderr.on("data", (data) => {
      chunks.push(data);
      process.stderr.write(data);
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

  const stopSampler = enableSystemSampling ? startSystemSampler(runDir) : () => ({});
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
    result = await spawnCommand(cmdText, cwd, effectiveTimeoutMs, logFile, timeoutReason, childEnv, { onLine });
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

  const metrics = {};
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
  if (metricValue !== null) {
    metrics[metricName] = metricValue;
  }
  if (status === "complete" && metricValue === null) {
    status = "complete_no_metric";
  }

  // Promotion gates (G05): apply after we know the final metric value.
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
    notes: "",
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
  };
  if (evalConfig.checkpointGlob) {
    row.last_checkpoint = lastCheckpoint ? lastCheckpoint.relative : null;
  }
  if (killReason) row.kill_reason = killReason;
  if (gateResult.reasons.length) row.gate_reasons = gateResult.reasons;
  if (tags) row.tags = tags;
  if (parentId) row.parent_id = parentId;
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

  const enableSystemSampling = !hasFlag("--no-system-sampling");

  if (Number.isFinite(seeds) && seeds > 1 && !isBaseline) {
    await runWithSeeds({
      cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, seeds,
      idBase: option("--id", null),
      direction: String(option("--direction", goalFields.direction || "lower")).toLowerCase(),
      enableSystemSampling,
    });
    return;
  }

  const idOverride = option("--id", null);
  await executeRunWithRetries({
    cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, isBaseline,
    idOverride, enableSystemSampling,
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

async function runWithSeeds({ cwd, cmdText, metricName, regexSource, timeoutSec, allowUnsafe, seeds, idBase, direction, enableSystemSampling = true }) {
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
    const childEnv = { RESEARCHLOOP_SEED: String(seed) };
    console.log(`[seed ${seed}] ${seedCmd}`);
    const res = await executeRun({
      cwd, cmdText: seedCmd, metricName, regexSource, timeoutSec, allowUnsafe,
      isBaseline: false,
      idOverride: seedId,
      extraConfig: { seed, parent_run: base },
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
  const expectedValue = source.metrics ? Number(source.metrics[metricName]) : Number.NaN;
  const tolerance = Math.max(0, parseFloat(String(option("--tolerance", "0.01"))));
  const replayCountRaw = parseInt(String(option("--n", "1")), 10);
  const replayCount = Number.isFinite(replayCountRaw) && replayCountRaw > 0 ? Math.min(replayCountRaw, 20) : 1;
  const timeoutSec = Number(option("--timeout", 600));
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
  const primaryValue = primary ? Number(row.metrics[primary]) : NaN;
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
  const expectedValue = source.metrics ? Number(source.metrics[metricName]) : Number.NaN;
  const tolRaw = option("--tolerance", "0.001");
  const tolerance = Math.max(0, parseFloat(String(tolRaw)));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const timeoutSec = Number(option("--timeout", 600));
  const regexSource = option("--regex", null);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const verifyId = String(option("--verify-id", `verify-${runId}-${stamp}`));

  console.log(`autoresearch verify`);
  console.log(`source: ${runId}`);
  console.log(`command: ${source.command}`);
  if (Number.isFinite(expectedValue)) {
    console.log(`expected ${metricName}: ${expectedValue} (tolerance=±${tolerance})`);
  } else {
    console.log(`expected ${metricName}: not recorded`);
  }
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
  const cutoff = Date.now() - sinceMs;

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

  // Check baseline status (reuses baseline logic)
  const baselineFile = path.join(cwd, ".researchloop", "baseline.md");
  let baselineState = "unknown";
  let baselineMetric = null;
  let baselineValue = null;

  if (fs.existsSync(baselineFile)) {
    const raw = fs.readFileSync(baselineFile, "utf8");
    const whatToRecord = extractSection(raw, "What To Record");
    const frozenSurfaces = extractSection(raw, "Frozen Surfaces");
    const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
    const requiredFrozen = ["Dataset", "Model size", "Seed"];
    let missing = [];
    for (const key of requiredWhatToRecord) {
      if (!sectionHasValue(whatToRecord, key)) missing.push(key);
    }
    for (const key of requiredFrozen) {
      if (!sectionHasValue(frozenSurfaces, key)) missing.push(key);
    }
    baselineState = missing.length === 0 ? "complete" : "incomplete";
    baselineMetric = extractValue(whatToRecord, "Metric") || null;
    baselineValue = extractValue(whatToRecord, "Metric") || null;
  } else {
    baselineState = "missing";
  }

  // Check for prior runs
  let priorRunCount = 0;
  let bestRun = null;
  try {
    const runsPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
    if (fs.existsSync(runsPath)) {
      const lines = fs.readFileSync(runsPath, "utf8").split("\n").filter(l => l.trim());
      priorRunCount = lines.length;
      for (const line of lines.reverse()) {
        const row = JSON.parse(line);
        if (row.status === "completed" && row.value != null) {
          bestRun = row;
          break;
        }
      }
    }
  } catch { /* ignore */ }

  // Check for existing paper notes
  let paperNotes = [];
  try {
    const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
    if (fs.existsSync(papersDir)) {
      for (const f of fs.readdirSync(papersDir)) {
        if (f.endsWith(".md")) paperNotes.push(f.replace(".md", ""));
      }
    }
  } catch { /* ignore */ }

  // Autonomy mode requires locked baseline
  if (mode === "autonomous") {
    const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
    if (!fs.existsSync(lockFile)) {
      console.error("topic: --mode autonomous requires a locked baseline. Run `autoresearch baseline --lock` first.");
      process.exitCode = 1;
      return;
    }
  }

  // Build output
  const slug = topicText.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
  const timestamp = new Date().toISOString().split("T")[0];

  let output = "# Topic: " + topicText + "\n\n";
  output += "_Generated: " + timestamp + " | Mode: " + mode + "_\n\n";

  output += "## Baseline State\n";
  output += "- Status: **" + baselineState + "**\n";
  if (baselineMetric) output += "- Metric: " + baselineMetric + "\n";
  if (baselineValue) output += "- Baseline value: " + baselineValue + "\n";
  if (priorRunCount > 0) output += "- Prior runs: " + priorRunCount + "\n";
  if (bestRun) output += "- Best run: " + bestRun.id + " (" + bestRun.value + ")\n";
  output += "\n";

  if (baselineState !== "complete") {
    output += "**Action required:** Baseline is " + baselineState + ". ";
    output += "Create or complete `.researchloop/baseline.md` before proceeding with experiments.\n\n";
  }

  output += "## Available Modes\n\n";
  output += "### propose (default)\n";
  output += "Read repo history and optionally search papers to propose 2-4 grounded next experiments.\n\n";
  output += "### novel\n";
  output += "Generate 3-5 genuinely different hypotheses with mechanism, why it might work, why it might fail, smallest test, and kill criterion.\n\n";
  output += "### autonomous\n";
  output += "Run the full loop (read history, search papers, write notes, choose cheapest meaningful test, run it, record it, compare it) within an agreed time budget. **Requires baseline lock.**\n\n";

  output += "## Next Steps\n\n";
  output += "Choose a mode and run:\n\n";
  output += "```bash\n";
  output += "autoresearch propose --topic \"" + topicText + "\"\n";
  output += "# OR\n";
  output += "autoresearch hypothesis --from-runs --topic \"" + topicText + "\"\n";
  output += "```\n\n";

  if (paperNotes.length > 0) {
    output += "## Relevant Paper Notes\n";
    for (const note of paperNotes) {
      output += "- " + note + "\n";
    }
    output += "\n";
  }

  output += "_Topic intake generated by AutoResearch-AI G28_\n";

  if (doWrite) {
    const topicsDir = path.join(cwd, ".researchloop", "scratchpad", "topics");
    if (!fs.existsSync(topicsDir)) fs.mkdirSync(topicsDir, { recursive: true });
    const outPath = path.join(topicsDir, slug + ".md");
    fs.writeFileSync(outPath, output);
    console.log("Topic note written to: " + outPath);
    if (mode === "autonomous" && baselineState !== "complete") {
      console.log("WARNING: baseline is " + baselineState + " — autonomous mode may not behave correctly.");
    }
  } else {
    process.stdout.write(output);
  }
}

function cmdPropose() {
  const cwd = targetDir();
  const n = parseInt(option("--n", "5"), 10);
  const doWrite = hasFlag("--write");
  const mode = option("--mode", "propose");
  const focus = option("--focus", "all");
  const metric = option("--metric", null);
  const direction = option("--direction", null);

  // Check baseline status
  const baselineFile = path.join(cwd, ".researchloop", "baseline.md");
  let baselineInfo = { status: "missing", metric: null, direction: null };
  if (fs.existsSync(baselineFile)) {
    const raw = fs.readFileSync(baselineFile, "utf8");
    const whatToRecord = extractSection(raw, "What To Record");
    const frozenSurfaces = extractSection(raw, "Frozen Surfaces");
    const requiredWhatToRecord = ["Baseline artifact", "Metric", "Direction", "Command or config"];
    const requiredFrozen = ["Dataset", "Model size", "Seed"];
    let missing = [];
    for (const key of requiredWhatToRecord) {
      if (!sectionHasValue(whatToRecord, key)) missing.push(key);
    }
    for (const key of requiredFrozen) {
      if (!sectionHasValue(frozenSurfaces, key)) missing.push(key);
    }
    baselineInfo.status = missing.length === 0 ? "complete" : "incomplete";
    baselineInfo.metric = extractValue(whatToRecord, "Metric") || null;
    baselineInfo.direction = extractValue(whatToRecord, "Direction") || null;
  }

  // Check if baseline is locked
  const lockFile = path.join(cwd, ".researchloop", "baseline.lock");
  if (fs.existsSync(lockFile)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      baselineInfo.locked_at = lock.locked_at;
      baselineInfo.baseline_value = lock.baseline_value;
    } catch { /* ignore */ }
  }

  // Collect prior runs
  let runs = [];
  try {
    const runsPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
    if (fs.existsSync(runsPath)) {
      const lines = fs.readFileSync(runsPath, "utf8").split("\n").filter(l => l.trim());
      for (const line of lines) {
        runs.push(JSON.parse(line));
      }
    }
  } catch { /* ignore */ }

  // Collect paper notes
  let paperNotes = [];
  try {
    const papersDir = path.join(cwd, ".researchloop", "scratchpad", "papers");
    if (fs.existsSync(papersDir)) {
      for (const f of fs.readdirSync(papersDir)) {
        if (f.endsWith(".md")) {
          const content = fs.readFileSync(path.join(papersDir, f), "utf8");
          paperNotes.push({ id: f.replace(".md", ""), content });
        }
      }
    }
  } catch { /* ignore */ }

  // Collect hypotheses
  let hypotheses = [];
  try {
    const hypDir = path.join(cwd, ".researchloop", "scratchpad", "hypotheses");
    if (fs.existsSync(hypDir)) {
      for (const f of fs.readdirSync(hypDir)) {
        if (f.endsWith(".md")) {
          const content = fs.readFileSync(path.join(hypDir, f), "utf8");
          hypotheses.push({ id: f.replace(".md", ""), content });
        }
      }
    }
  } catch { /* ignore */ }

  // Determine target metric
  const targetMetric = metric || baselineInfo.metric || "val_loss";
  const targetDirection = direction || baselineInfo.direction || "lower";

  // Generate proposals based on prior runs and baseline
  const proposals = [];
  const usedMechanisms = new Set();

  // Extract mechanism from existing runs
  for (const run of runs) {
    if (run.params && run.params._mechanism) {
      usedMechanisms.add(run.params._mechanism);
    }
  }

  // Simple proposal generation based on common ML improvements
  const proposalTemplates = [
    { title: "Learning rate warmup", hypothesis: "Warmup prevents early gradient instability in transformers.", mechanism: "lr_warmup", change: "add warmup schedule", risk: "low" },
    { title: "AdamW instead of Adam", hypothesis: "Decoupled weight decay in AdamW produces better regularization.", mechanism: "optimizer_change", change: "replace Adam with AdamW", risk: "low" },
    { title: "Reduce batch size", hypothesis: "Smaller batches improve generalization for small datasets.", mechanism: "batch_reduction", change: "halve batch_size", risk: "medium" },
    { title: "Add gradient clipping", hypothesis: "Gradient clipping prevents token-level explosion in transformers.", mechanism: "gradient_clipping", change: "set max_grad_norm=1.0", risk: "low" },
    { title: "Increase model width", hypothesis: "Wider layers capture more complex patterns.", mechanism: "width_increase", change: "double hidden_dim", risk: "high" },
    { title: "Dropout regularization", hypothesis: "Dropout prevents overfitting on small datasets.", mechanism: "dropout", change: "add dropout=0.1", risk: "low" },
    { title: "Longer training with early stopping", hypothesis: "More epochs with patience finds better optimum.", mechanism: "longer_training", change: "increase epochs to 200", risk: "medium" },
    { title: "Weight decay tuning", hypothesis: "Optimal weight decay depends on model size and dataset.", mechanism: "weight_decay", change: "sweep weight_decay 0.01-0.1", risk: "medium" },
  ];

  // Filter out already-tried mechanisms
  const available = proposalTemplates.filter(p => !usedMechanisms.has(p.mechanism));

  // Generate id for each proposal (content-hashed)
  function hashId(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return "prop_" + Math.abs(hash).toString(16).padStart(8, "0");
  }

  let count = 0;
  for (const tpl of available) {
    if (count >= n) break;

    const id = hashId(tpl.title + Date.now());
    const bestRun = runs.filter(r => r.status === "completed").sort((a, b) => {
      if (targetDirection === "higher") return (b.value || 0) - (a.value || 0);
      return (a.value || 0) - (b.value || 0);
    })[0];

    proposals.push({
      id,
      title: tpl.title,
      hypothesis: tpl.hypothesis,
      change: tpl.change,
      metric: targetMetric,
      expected_direction: targetDirection,
      estimated_minutes: tpl.risk === "low" ? 30 : tpl.risk === "medium" ? 120 : 240,
      est_cost_usd_or_null: null,
      risk: tpl.risk,
      priors: bestRun ? [{ type: "run", id: bestRun.id }] : [],
      kill_criterion: targetMetric + " does not improve by >5% after " + (tpl.risk === "low" ? "1h" : "4h"),
      mechanism: tpl.mechanism,
      mode,
      created_at: new Date().toISOString(),
    });

    count++;
  }

  // Output
  if (doWrite) {
    const proposalsPath = path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl");
    const scratchpadDir = path.join(cwd, ".researchloop", "scratchpad");
    if (!fs.existsSync(scratchpadDir)) fs.mkdirSync(scratchpadDir, { recursive: true });
    const existingIds = new Set();
    try {
      if (fs.existsSync(proposalsPath)) {
        const existing = fs.readFileSync(proposalsPath, "utf8").split("\n").filter(l => l.trim());
        for (const line of existing) {
          try { existingIds.add(JSON.parse(line).id); } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }

    const filtered = proposals.filter(p => !existingIds.has(p.id));
    if (filtered.length > 0) {
      const lines = filtered.map(p => JSON.stringify(p)).join("\n") + "\n";
      fs.appendFileSync(proposalsPath, lines);
    }
    console.log("Wrote " + filtered.length + " new proposal(s) to " + proposalsPath);
  } else {
    // JSON output
    process.stdout.write(JSON.stringify(proposals, null, 2));
  }
}

function cmdRank() {
  const cwd = targetDir();
  const inputFile = option("--input", null);
  const doWrite = hasFlag("--write");
  const inputPath = inputFile
    ? path.join(cwd, inputFile)
    : path.join(cwd, ".researchloop", "scratchpad", "proposals.jsonl");

  // Load proposals
  let proposals = [];
  try {
    if (!fs.existsSync(inputPath)) {
      console.error("rank: no proposals found at " + inputPath + " (use --input or run `autoresearch propose --write` first)");
      process.exitCode = 1;
      return;
    }
    const lines = fs.readFileSync(inputPath, "utf8").split("\n").filter(l => l.trim());
    for (const line of lines) {
      proposals.push(JSON.parse(line));
    }
  } catch (e) {
    console.error("rank: failed to read proposals: " + e.message);
    process.exitCode = 1;
    return;
  }

  if (proposals.length === 0) {
    console.error("rank: no proposals to rank");
    process.exitCode = 1;
    return;
  }

  // Load runs for novelty comparison
  let runs = [];
  try {
    const runsPath = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
    if (fs.existsSync(runsPath)) {
      const lines = fs.readFileSync(runsPath, "utf8").split("\n").filter(l => l.trim());
      for (const line of lines) {
        runs.push(JSON.parse(line));
      }
    }
  } catch { /* ignore */ }

  // Score each proposal
  function scoreProposal(prop) {
    let impact = 0.5; // baseline
    let cost = 0.5;
    let risk = 0.5;
    let novelty = 0.5;

    // Risk scoring
    const riskScores = { low: 0.2, medium: 0.5, high: 0.8 };
    risk = riskScores[prop.risk] || 0.5;

    // Estimated cost impact (minutes to hours, normalized 0-1)
    const estMinutes = prop.estimated_minutes || 30;
    cost = Math.min(estMinutes / 240, 1.0); // 240 min = 1.0

    // Impact: if prior exists, score based on whether it beats the prior
    if (prop.priors && prop.priors.length > 0) {
      const priorRun = runs.find(r => prop.priors.some(p => p.id === r.id));
      if (priorRun && priorRun.value != null) {
        // Proposals targeting lower metric should beat prior's value
        if (prop.expected_direction === "lower" && priorRun.value > (prop.target_value || 0)) {
          impact = 0.8;
        } else if (prop.expected_direction === "higher" && priorRun.value < (prop.target_value || 1)) {
          impact = 0.8;
        } else {
          impact = 0.4;
        }
      }
    }

    // Novelty: check if mechanism was already tried
    if (prop.mechanism) {
      const usedMechanisms = new Set();
      for (const run of runs) {
        if (run.params && run.params._mechanism) {
          usedMechanisms.add(run.params._mechanism);
        }
      }
      novelty = usedMechanisms.has(prop.mechanism) ? 0.1 : 0.8;
    }

    // Composite score (weighted average)
    const score = impact * 0.35 + (1 - cost) * 0.25 + (1 - risk) * 0.15 + novelty * 0.25;

    // Generate why
    let why = [];
    if (impact > 0.6) why.push("high impact relative to prior");
    else if (impact < 0.4) why.push("marginal improvement over prior");
    if (cost < 0.3) why.push("cheap to run");
    else if (cost > 0.7) why.push("expensive run");
    if (risk < 0.3) why.push("low risk");
    else if (risk > 0.6) why.push("high risk");
    if (novelty > 0.6) why.push("novel mechanism");
    else if (novelty < 0.3) why.push("already explored mechanism");

    return {
      score: Math.round(score * 1000) / 1000,
      score_breakdown: {
        impact: Math.round(impact * 100) / 100,
        cost: Math.round(cost * 100) / 100,
        risk: Math.round(risk * 100) / 100,
        novelty_vs_runs: Math.round(novelty * 100) / 100,
        why: why.join("; ") || "mixed signals",
      },
    };
  }

  // Score and sort
  const scored = proposals.map(p => ({ ...p, ...scoreProposal(p) }));
  scored.sort((a, b) => b.score - a.score);

  // Write ranked output
  if (doWrite) {
    const rankedPath = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.jsonl");
    const scratchpadDir = path.join(cwd, ".researchloop", "scratchpad");
    if (!fs.existsSync(scratchpadDir)) fs.mkdirSync(scratchpadDir, { recursive: true });

    const lines = scored.map(p => JSON.stringify(p)).join("\n") + "\n";
    fs.writeFileSync(rankedPath, lines);

    // Also write human-readable markdown
    let md = "# Ranked Proposals\n\n";
    md += "_Generated: " + new Date().toISOString().split("T")[0] + "_\n\n";
    md += "| Rank | Title | Score | Impact | Cost | Risk | Novelty | Mechanism |\n";
    md += "|---|---|---|---|---|---|---|---|\n";
    scored.forEach((p, i) => {
      md += "| " + (i + 1) + " | " + p.title + " | " + p.score + " | ";
      md += p.score_breakdown.impact + " | " + p.score_breakdown.cost + " | ";
      md += p.score_breakdown.risk + " | " + p.score_breakdown.novelty_vs_runs + " | ";
      md += (p.mechanism || "unknown") + " |\n";
    });
    md += "\n## Details\n\n";
    scored.forEach((p, i) => {
      md += "### " + (i + 1) + ". " + p.title + " (score: " + p.score + ")\n";
      md += "- **Hypothesis:** " + p.hypothesis + "\n";
      md += "- **Change:** " + p.change + "\n";
      md += "- **Risk:** " + p.risk + "\n";
      md += "- **Kill criterion:** " + p.kill_criterion + "\n";
      md += "- **Why:** " + p.score_breakdown.why + "\n\n";
    });

    const mdPath = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.md");
    fs.writeFileSync(mdPath, md);

    console.log("Ranked " + scored.length + " proposals -> " + rankedPath);
    console.log("Markdown summary -> " + mdPath);
  } else {
    process.stdout.write(JSON.stringify(scored, null, 2));
  }
}

function parseSweepSpec(text) {
  const trimmed = text.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`sweep spec must be valid JSON (parse error: ${err.message})`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("sweep spec must be a JSON object");
  }
  return parsed;
}

function expandSweepVariants(spec) {
  if (Array.isArray(spec.variants) && spec.variants.length) {
    return spec.variants.map((v, i) => ({ params: v, index: i }));
  }
  if (spec.grid && typeof spec.grid === "object") {
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
    return combos.map((params, index) => ({ params, index }));
  }
  throw new Error("sweep spec must define either `variants` (list) or `grid` (object)");
}

function renderSweepCommand(template, params) {
  let out = template;
  for (const [key, value] of Object.entries(params)) {
    const re = new RegExp(`\\{${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
    out = out.replace(re, String(value));
  }
  return out;
}

async function cmdSweep() {
  const cwd = targetDir();
  const specPath = option("--spec", null);
  if (!specPath || typeof specPath !== "string") {
    console.error("autoresearch sweep requires --spec <file.json>");
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
    spec = parseSweepSpec(fs.readFileSync(abs, "utf8"));
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
  const timeoutSec = Number(option("--timeout", spec.timeout || 600));
  const allowUnsafe = hasFlag("--allow-unsafe");
  const seedsRaw = option("--seeds", spec.seeds || null);
  const seeds = seedsRaw && typeof seedsRaw !== "boolean" ? parseInt(String(seedsRaw), 10) : null;
  const dryRun = hasFlag("--dry-run");
  const direction = String(option("--direction", spec.direction || goalFields.direction || "lower")).toLowerCase();
  const preferHigher = direction === "higher" || direction === "max" || direction === "maximize";
  const sweepName = String(spec.name || option("--name", "sweep")).replace(/[^A-Za-z0-9._-]/g, "-");
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
      value: r.row && r.row.metrics ? Number(r.row.metrics[metricName]) : Number.NaN,
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
  autoresearch propose [--n N] [--write] [--mode propose|novel|autonomous] [--focus hyperparameters|architecture|attention|data] [--dir PATH]
  autoresearch rank [--input PATH] [--write] [--dir PATH] [--goal TEXT] [--write]
  autoresearch prompt [--goal TEXT] [--focus hyperparameters|architecture|attention|training-ladder] [--agent NAME]
  autoresearch doctor [--dir PATH] [--python PATH] [--repair-plan]
  autoresearch replay [RUN_ID] [--id RUN_ID] [--n N] [--metric NAME] [--tolerance N] [--timeout SECONDS] [--allow-unsafe] [--dir PATH]
  autoresearch record [--dir PATH] [--id ID] [--status STATUS] [--metric key=value] [--note TEXT]    (manual escape hatch; prefer 'run')
  autoresearch run [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--seeds N] [--allow-unsafe]
  autoresearch baseline [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--allow-unsafe]
  autoresearch sweep --spec FILE.json [--metric NAME] [--seeds N] [--direction lower|higher] [--dry-run] [--allow-unsafe] [--dir PATH]
  autoresearch loop --command CMD [--iters N] [--metric NAME] [--direction lower|higher] [--patch-cmd CMD] [--revert-on-regression] [--commit-on-win] [--keep-if better|same] [--dir PATH]
  autoresearch anomalies [--id RUN_ID] [--format text|json] [--dir PATH]
  autoresearch verify --id <run-id> [--metric NAME] [--tolerance N] [--timeout SECONDS] [--allow-unsafe] [--dir PATH]
  autoresearch preflight [--command CMD] [--require-gpu] [--min-disk-gb N] [--min-mem-gb N] [--format text|json] [--dir PATH]
  autoresearch resume [RUN_ID] [--id RUN_ID] [--command CMD] [--metric NAME] [--timeout SECONDS] [--dry-run] [--allow-unsafe] [--dir PATH]
  autoresearch scan-papers [--dir PATH] [--query TEXT] [--limit N] [--since YYYY-MM] [--cache-dir PATH] [--offline]
  autoresearch compare [--dir PATH] [--metric NAME] [--direction lower|higher]
  autoresearch team [--dir PATH] [--workers N] [--goal TEXT] [--force]
  autoresearch dashboard [--dir PATH] [--host HOST] [--port PORT]
  autoresearch report [--dir PATH] [--format text|markdown] [--out report.md] [--include-plots]
  autoresearch audit <file.md> [--tolerance N] [--dir PATH]
  autoresearch baseline-status [--dir PATH]
  autoresearch baseline --lock [--dir PATH]
  autoresearch baseline --unlock [--dir PATH] [--format json]
  autoresearch failures [--top N] [--format json] [--dir PATH]
  autoresearch diff-runs --id-a <id> --id-b <id> [--format text|json|markdown] [--dir PATH]
  autoresearch prune [--older-than Nd] [--status STATUS] [--dry-run] [--no-keep-promoted] [--dir PATH]
  autoresearch data-fingerprint [--dir PATH]
  autoresearch model-card --id <run-id> [--out FILE.md] [--dir PATH]
  autoresearch tag --id <run-id> [--add TAG] [--remove TAG] [--list] [--dir PATH]\n  autoresearch digest [--since DURATION] [--format text|json|markdown] [--dir PATH]\n  autoresearch param-importance [--metric METRIC] [--format table|json] [--dir PATH]\n  autoresearch suggest [--n N] [--metric METRIC] [--direction higher|lower] [--format text|json] [--dir PATH]
  autoresearch topic "<text>" [--mode propose|novel|autonomous] [--dir PATH] [--write]
  autoresearch query "<expression>" [--format jsonl|table] [--dir PATH]
  autoresearch curves --id <run-id> [--format text|json|jsonl] [--dir PATH]
  autoresearch promote --id <run-id> [--note TEXT] [--force] [--skip-review] [--dir PATH]
  autoresearch review --id <run-id> [--format text|json|markdown] [--out FILE.md] [--dir PATH]
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
    cmdPropose();
  } else if (command === "rank") {
    cmdRank();
  } else if (command === "prompt") {
    cmdPrompt();
  } else if (command === "doctor") {
    cmdDoctor();
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
  } else if (command === "compare") {
    cmdCompare();
  } else if (command === "team") {
    cmdTeam();
  } else if (command === "dashboard") {
    cmdDashboard();
  } else if (command === "report") {
    cmdReport();
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
  } else if (command === "query") {
    cmdQuery();
  } else if (command === "approvals") {
    cmdApprovals();
  } else if (command === "sweep") {
    await cmdSweep();
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
