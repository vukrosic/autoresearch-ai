#!/usr/bin/env python3
"""Patch script for G46 seed-track command"""

with open('bin/researchloop.js', 'r') as f:
    content = f.read()

# 1. Add cmdSeedTrack before cmdHelp
old_fn = 'function cmdHelp() {'
new_fn = '''function cmdSeedTrack() {
  const cwd = targetDir();
  const ledger = path.join(cwd, ".researchloop", "scratchpad", "runs.jsonl");
  const seedTrackIdx = args.findIndex((a) => a === "seed-track");
  const subcommand = seedTrackIdx !== -1 && args[seedTrackIdx + 1] ? args[seedTrackIdx + 1] : "";
  const runId = String(option("--id", ""));
  const numSeeds = parseInt(String(option("--seeds", "3")), 10);
  const seedFlag = String(option("--seed-flag", "--seed"));
  const metricName = String(option("--metric", "val_loss"));

  if (subcommand === "report") {
    if (!runId) {
      console.error("Usage: autoresearch seed-track report --id <run-id> [--metric NAME] [--dir PATH]");
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(ledger)) {
      console.error("No run ledger found.");
      process.exitCode = 1;
      return;
    }

    const rows = parseRunsLedger(ledger);
    const seedGroup = rows.find((r) => r && r.id === runId && r.seed_group);
    if (!seedGroup) {
      console.error("Run " + runId + " has no seed_group. Use seed-track to create seed runs.");
      process.exitCode = 1;
      return;
    }

    const groupId = seedGroup.seed_group;
    const seedRuns = rows.filter((r) => r && r.seed_group === groupId);

    if (seedRuns.length === 0) {
      console.error("No seed runs found for group " + groupId);
      process.exitCode = 1;
      return;
    }

    const values = seedRuns
      .map((r) => r.metrics && r.metrics[metricName])
      .filter((v) => v != null && typeof v === "number");

    if (values.length === 0) {
      console.error("Metric " + metricName + " not found in seed runs.");
      process.exitCode = 1;
      return;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);

    console.log("Seed group: " + groupId);
    console.log("  seeds: " + seedRuns.length);
    console.log("  mean: " + mean.toFixed(4));
    console.log("  std: " + std.toFixed(4));
    console.log("  min: " + Math.min(...values).toFixed(4));
    console.log("  max: " + Math.max(...values).toFixed(4));

    return;
  }

  // Default: create seed runs
  if (!runId) {
    console.error("Usage: autoresearch seed-track <run-id> --seeds N [--seed-flag FLAG] [--dir PATH]");
    console.error("       autoresearch seed-track report --id <run-id> [--metric NAME] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(ledger)) {
    console.error("No run ledger found.");
    process.exitCode = 1;
    return;
  }

  const rows = parseRunsLedger(ledger);
  const originalRun = rows.find((r) => r && r.id === runId);
  if (!originalRun) {
    console.error("Run not found: " + runId);
    process.exitCode = 1;
    return;
  }

  // Generate a seed group ID
  const seedGroup = "sg-" + runId + "-" + Date.now();

  console.log("Seeding " + numSeeds + " runs from " + runId + "...");
  for (let i = 1; i <= numSeeds; i++) {
    const seedValue = i;
    const newId = runId + "-seed-" + seedValue;

    // Build new command with seed flag
    const originalCmd = originalRun.command || "";
    const newCmd = originalCmd.includes(seedFlag)
      ? originalCmd.replace(new RegExp(seedFlag + "\\s*\\d+"), seedFlag + " " + seedValue)
      : originalCmd + " " + seedFlag + " " + seedValue;

    console.log("  seed " + seedValue + ": " + newId);

    // Write a seed run entry to runs.jsonl
    const seedRow = {
      ...originalRun,
      id: newId,
      seed_group: seedGroup,
      seed_value: seedValue,
      parent_id: runId,
      command: newCmd,
      status: "pending",
      timestamp: new Date().toISOString(),
      notes: "seed run " + seedValue + " of " + numSeeds,
    };

    fs.appendFileSync(ledger, JSON.stringify(seedRow) + "\\n");
  }

  console.log("Created " + numSeeds + " seed runs in group " + seedGroup);
  console.log("Run `autoresearch seed-track report --id " + runId + " --metric " + metricName + "` to see results.");
}

function cmdHelp() {'''

if old_fn not in content:
    print("ERROR: cmdHelp marker not found")
    exit(1)

content = content.replace(old_fn, new_fn, 1)

# 2. Add dispatch before the else at the end
old_dispatch = '} else {\n    console.error(`Unknown command: ${command}`);\n    cmdHelp();\n    process.exitCode = 1;\n  }\n}\n\nmain()'
new_dispatch = '} else if (command === "seed-track") {\n    cmdSeedTrack();\n  } else {\n    console.error(`Unknown command: ${command}`);\n    cmdHelp();\n    process.exitCode = 1;\n  }\n}\n\nmain()'

if old_dispatch not in content:
    print("ERROR: dispatch not found")
    exit(1)

content = content.replace(old_dispatch, new_dispatch, 1)

# 3. Add help text
old_help = '  autoresearch snapshot diff <name> [--dir PATH]'
new_help = '  autoresearch snapshot diff <name> [--dir PATH]\n  autoresearch seed-track <run-id> --seeds N [--seed-flag FLAG] [--dir PATH]\n  autoresearch seed-track report --id <run-id> [--metric NAME] [--dir PATH]'

if old_help not in content:
    print("ERROR: help text not found")
    exit(1)

content = content.replace(old_help, new_help, 1)

with open('bin/researchloop.js', 'w') as f:
    f.write(content)

print("G46 seed-track patched successfully, lines:", content.count('\n'))