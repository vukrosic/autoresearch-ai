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
  for (let i = idx + 1; i < args.length; i += 1) {
    const arg = args[i];
    if (skip.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
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
  const python = String(option("--python", "python3"));
  const nodeVersion = process.version;
  const npmVersion = run("npm --version", cwd) || "not found";
  const gitVersion = run("git --version", cwd) || "not found";
  const currentEnv = captureEnv(cwd, python);
  const latestRun = readLatestRunRow(cwd);

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
  if (parsed.length) {
    console.log(`last: ${JSON.stringify(parsed[parsed.length - 1], null, 2)}`);
  }
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

  return {
    totalRuns: runs.length,
    completeRuns: completeRuns.length,
    parseErrors,
    latestRun,
    bestRun,
    worstRun,
    series,
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

  const row = {
    id,
    timestamp: finishedAt,
    started_at: startedAt,
    status,
    agent: `autoresearch ${prefix}`,
    command: cmdText,
    exit_code: result.exitCode,
    log: path.relative(cwd, logFile),
    metrics,
    metric_history: metricSeries.length ? { [metricName]: metricSeries } : {},
    notes: "",
    env,
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

function cmdHelp() {
  console.log(`AutoResearch-AI ${packageVersion()}

Usage:
  autoresearch init [--agent codex|claude-code|hermes|cursor] [--dir PATH] [--force]
  autoresearch goal [TEXT] [--dir PATH] [--metric NAME] [--direction lower|higher] [--baseline CMD] [--evaluation CMD] [--allowed TEXT] [--forbidden TEXT]
  autoresearch inspect [--dir PATH]
  autoresearch idea [--dir PATH] [--goal TEXT] [--write]
  autoresearch prompt [--goal TEXT] [--focus hyperparameters|architecture|attention|training-ladder] [--agent NAME]
  autoresearch doctor [--dir PATH] [--python PATH]
  autoresearch replay [--dir PATH] [--id RUN_ID]
  autoresearch record [--dir PATH] [--id ID] [--status STATUS] [--metric key=value] [--note TEXT]    (manual escape hatch; prefer 'run')
  autoresearch run [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--allow-unsafe]
  autoresearch baseline [--dir PATH] [--id ID] [--command CMD] [--metric NAME] [--regex PATTERN] [--timeout SECONDS] [--allow-unsafe]
  autoresearch scan-papers [--dir PATH] [--query TEXT] [--limit N] [--since YYYY-MM] [--cache-dir PATH] [--offline]
  autoresearch compare [--dir PATH] [--metric NAME] [--direction lower|higher]
  autoresearch team [--dir PATH] [--workers N] [--goal TEXT] [--force]
  autoresearch dashboard [--dir PATH] [--host HOST] [--port PORT]
  autoresearch report [--dir PATH]
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
    await cmdRun(true);
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
