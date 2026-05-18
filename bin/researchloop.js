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

function cmdReport() {
  const cwd = targetDir();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  if (!fs.existsSync(ledger)) {
    console.log("No run ledger found. Run `autoresearch init` first.");
    return;
  }
  const rows = fs.readFileSync(ledger, "utf8").split("\n").filter(Boolean);
  const parsed = rows.map((row) => {
    try {
      return JSON.parse(row);
    } catch {
      return { parse_error: true, raw: row };
    }
  });
  const errors = parsed.filter((row) => row.parse_error).length;
  const complete = parsed.filter((row) => row.status === "complete" || row.status === "completed").length;
  console.log(`runs: ${rows.length}`);
  console.log(`complete: ${complete}`);
  console.log(`parse_errors: ${errors}`);
  const totalWallSeconds = parsed.filter((r) => r && !r.parse_error && r.wall_seconds).reduce((s, r) => s + (r.wall_seconds || 0), 0);
  if (totalWallSeconds > 0) {
    console.log(`wall_time: ${Math.round(totalWallSeconds)}s total`);
  }
  if (parsed.length) {
    const last = parsed[parsed.length - 1];
    console.log(`last: ${JSON.stringify(last, null, 2)}`);
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
      const first = Number(trace.values?.[0]);
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
      const finalFromMetrics = Number(run?.metrics?.[primaryMetric]);
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
  return Number.isFinite(Number(value));
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

function startSystemSampler(runDir, intervalMs = 5000) {
  const file = path.join(runDir, "system.jsonl");
  fs.writeFileSync(file, "");
  const sample = () => {
    const load = os.loadavg();
    const row = {
      ts: new Date().toISOString(),
      load_avg_1m: load[0],
      load_avg_5m: load[1],
      load_avg_15m: load[2],
      mem_total_bytes: os.totalmem(),
      mem_free_bytes: os.freemem(),
    };
    try {
      fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
    } catch {
      // run dir may have been removed mid-sample; ignore
    }
  };
  sample();
  const timer = setInterval(sample, intervalMs);
  return () => {
    clearInterval(timer);
  };
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

function spawnCommand(commandText, cwd, timeoutMs, logFile, timeoutReason = "timeout", childEnv = process.env) {
  return new Promise((resolve) => {
    const child = spawn(commandText, { cwd, shell: true, env: childEnv });
    const chunks = [];
    let timedOut = false;
    const logStream = fs.createWriteStream(logFile);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      chunks.push(data);
      process.stdout.write(data);
      logStream.write(data);
    });
    child.stderr.on("data", (data) => {
      chunks.push(data);
      process.stderr.write(data);
      logStream.write(data);
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
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      logStream.end();
      resolve({
        output: Buffer.concat(chunks).toString("utf8"),
        exitCode: code,
        timedOut,
        timedOutBy: timedOut ? timeoutReason : null,
        spawnError: null,
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
  if (!cmdText || cmdText.toLowerCase() === "unknown") {
    console.error("No command to run.");
    console.error("Set one via:");
    console.error("  autoresearch goal \"<text>\" --baseline \"python train.py\" --evaluation \"python eval.py\"");
    console.error("Or pass --command directly.");
    process.exitCode = 1;
    return;
  }

  const metricName = String(option("--metric", goalFields.metric || "val_loss")).trim() || "val_loss";
  const customRegex = option("--regex", null);
  const regexSource = customRegex && typeof customRegex === "string" ? customRegex : null;
  const timeoutSec = Number(option("--timeout", 600));
  const timeoutMs = Number.isFinite(timeoutSec) && timeoutSec > 0 ? timeoutSec * 1000 : 600000;
  const safetyPolicy = loadSafetyPolicy(cwd);
  const safetyCheck = evaluateCommandSafety(cmdText, safetyPolicy);

  if (!allowUnsafe && !safetyCheck.allowed) {
    console.error("autoresearch safety: blocked command before execution");
    console.error(`rule: ${safetyCheck.rule}`);
    console.error(`reason: ${safetyCheck.message}`);
    process.exitCode = 1;
    return;
  }

  if (allowUnsafe) {
    console.error("WARNING: --allow-unsafe bypasses command safety checks. This command will run unsafely.");
  }

  const prefix = isBaseline ? "baseline" : "run";
  const id = String(option("--id", `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const runDir = path.join(cwd, ".researchloop", "scratchpad", "runs", id);
  ensureDir(runDir);
  const logFile = path.join(runDir, "log.txt");
  const env = captureEnv(cwd);
  const dataFingerprint = computeDataFingerprint(cwd, goalFields.data_globs);
  const effectiveTimeoutMs = allowUnsafe || !Number.isFinite(safetyCheck.maxMs)
    ? timeoutMs
    : Math.min(timeoutMs, safetyCheck.maxMs);
  const timeoutReason = !allowUnsafe && Number.isFinite(safetyCheck.maxMs) && safetyCheck.maxMs < timeoutMs
    ? "safety"
    : "timeout";

  const enableSystemSampling = !hasFlag("--no-system-sampling");
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
  });

  console.log(`autoresearch ${prefix}`);
  console.log(`command: ${cmdText}`);
  console.log(`metric: ${metricName}`);
  console.log(`timeout: ${effectiveTimeoutMs / 1000}s`);
  if (!allowUnsafe && timeoutReason === "safety") {
    console.log(`safety: max_minutes_per_run=${safetyPolicy.maxMinutesPerRun}`);
  }
  console.log(`log: ${path.relative(cwd, logFile)}`);
  console.log("---");

  const stopSampler = enableSystemSampling ? startSystemSampler(runDir) : () => {};
  const childEnv = { ...process.env, RESEARCHLOOP_RUN_DIR: runDir };
  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await spawnCommand(cmdText, cwd, effectiveTimeoutMs, logFile, timeoutReason, childEnv);
  } finally {
    stopSampler();
  }
  const finishedAt = new Date().toISOString();

  let status;
  if (result.spawnError) {
    status = "spawn_error";
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
  const metricValue = parseMetricFromOutput(result.output, metricName, regexSource);
  const metricSeries = extractMetricSeriesFromText(result.output, metricName, regexSource);
  if (metricValue !== null) {
    metrics[metricName] = metricValue;
  }
  if (status === "complete" && metricValue === null) {
    status = "complete_no_metric";
  }

  const wallSeconds = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
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
  };
  appendRunRow(cwd, row);
  writeArtifactMetricsJsonl(runDir, metricName, metricSeries);
  writeArtifactManifest(runDir);

  const thread = path.join(cwd, ".researchloop", "scratchpad", "THREAD.md");
  ensureDir(path.dirname(thread));
  const metricSuffix = metricValue !== null ? ` ${metricName}=${metricValue}` : "";
  fs.appendFileSync(thread, `- ${finishedAt} ${prefix} ${id} status=${status}${metricSuffix}\n`);

  console.log("---");
  console.log(`status: ${status}`);
  console.log(`exit_code: ${result.exitCode}`);
  if (metricValue !== null) {
    console.log(`${metricName}: ${metricValue}`);
  } else {
    console.log("metric: not parsed");
  }
  console.log(`recorded: ${id}`);

  if (isBaseline && metricValue !== null) {
    updateGoalCurrentBest(cwd, metricName, metricValue, id);
    updatePlanBaseline(cwd, metricName, metricValue, id);
    console.log("goal.md Current Best updated.");
    console.log("plan.md Current State updated.");
  }

  if (status === "failed" || status === "timeout" || status === "spawn_error") {
    process.exitCode = 1;
  }
  if (status === "killed_by_safety") {
    process.exitCode = 1;
  }
}

function cmdReplay() {
  const cwd = targetDir();
  const runId = String(option("--id", positionalText())).trim();
  if (!runId) {
    console.error("No run id provided.");
    console.error("Usage: autoresearch replay <run-id>");
    process.exitCode = 1;
    return;
  }

  const source = readRunRowById(cwd, runId);
  if (!source) {
    console.error(`No run found for id: ${runId}`);
    process.exitCode = 1;
    return;
  }

  const currentEnv = captureEnv(cwd);
  console.log(`replay: ${runId}`);
  console.log(`command: ${source.command || "not recorded"}`);

  if (!source.env) {
    console.error("WARNING: replay source run has no env capture.");
    return;
  }

  const mismatches = envMismatches(source.env, currentEnv);
  if (!mismatches.length) {
    console.log("env: match");
    return;
  }

  for (const mismatch of mismatches) {
    console.error(
      `WARNING: replay env mismatch ${mismatch.field}: stored=${formatEnvValue(mismatch.expected)} current=${formatEnvValue(mismatch.current)}`
    );
  }
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

  if (result.length === 0) {
    console.log("(no rows match)");
    return;
  }

  const allKeys = new Set(["id", "status", "timestamp", "value"]);
  for (const row of result) {
    if (row.metrics) for (const k of Object.keys(row.metrics)) allKeys.add("metrics." + k);
    if (row.params) for (const k of Object.keys(row.params)) allKeys.add("params." + k);
  }
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
  autoresearch replay [--dir PATH] [--id RUN_ID]
  autoresearch record [--dir PATH] [--id ID] [--status STATUS] [--metric key=value] [--note TEXT]    (manual escape hatch; prefer 'run')
  autoresearch run [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--allow-unsafe]
  autoresearch baseline [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--allow-unsafe]
  autoresearch scan-papers [--dir PATH] [--query TEXT] [--limit N] [--since YYYY-MM] [--cache-dir PATH] [--offline]
  autoresearch compare [--dir PATH] [--metric NAME] [--direction lower|higher]
  autoresearch team [--dir PATH] [--workers N] [--goal TEXT] [--force]
  autoresearch dashboard [--dir PATH] [--host HOST] [--port PORT]
  autoresearch report [--dir PATH]
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
    cmdReplay();
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
