#!/usr/bin/env python3
"""Patch script for G31 doctor --repair-plan"""

with open('bin/researchloop.js', 'r') as f:
    content = f.read()

old_doctor = '''function cmdDoctor() {
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
}'''

new_doctor = '''function cmdDoctor() {
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
      const rows = fs.readFileSync(ledgerPath, "utf8").split("\\n").filter(Boolean).map((l) => {
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
}'''

if old_doctor not in content:
    print("ERROR: cmdDoctor function not found")
    exit(1)

content = content.replace(old_doctor, new_doctor, 1)

# Update help text to mention --repair-plan
old_help = '  autoresearch doctor [--dir PATH] [--python PATH]'
new_help = '  autoresearch doctor [--dir PATH] [--python PATH] [--repair-plan]'

if old_help not in content:
    print("ERROR: doctor help text not found")
    exit(1)

content = content.replace(old_help, new_help, 1)

with open('bin/researchloop.js', 'w') as f:
    f.write(content)

print("G31 doctor --repair-plan patched successfully")