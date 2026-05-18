#!/usr/bin/env python3
"""Patch script for G02 rank command"""

with open('bin/researchloop.js', 'r') as f:
    content = f.read()

# 1. Add cmdRank function before cmdHelp
old_fn = 'function cmdHelp() {'
new_fn = '''function cmdRank() {
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
    const lines = fs.readFileSync(inputPath, "utf8").split("\\n").filter(l => l.trim());
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
      const lines = fs.readFileSync(runsPath, "utf8").split("\\n").filter(l => l.trim());
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

    const lines = scored.map(p => JSON.stringify(p)).join("\\n") + "\\n";
    fs.writeFileSync(rankedPath, lines);

    // Also write human-readable markdown
    let md = "# Ranked Proposals\\n\\n";
    md += "_Generated: " + new Date().toISOString().split("T")[0] + "_\\n\\n";
    md += "| Rank | Title | Score | Impact | Cost | Risk | Novelty | Mechanism |\\n";
    md += "|---|---|---|---|---|---|---|---|\\n";
    scored.forEach((p, i) => {
      md += "| " + (i + 1) + " | " + p.title + " | " + p.score + " | ";
      md += p.score_breakdown.impact + " | " + p.score_breakdown.cost + " | ";
      md += p.score_breakdown.risk + " | " + p.score_breakdown.novelty_vs_runs + " | ";
      md += (p.mechanism || "unknown") + " |\\n";
    });
    md += "\\n## Details\\n\\n";
    scored.forEach((p, i) => {
      md += "### " + (i + 1) + ". " + p.title + " (score: " + p.score + ")\\n";
      md += "- **Hypothesis:** " + p.hypothesis + "\\n";
      md += "- **Change:** " + p.change + "\\n";
      md += "- **Risk:** " + p.risk + "\\n";
      md += "- **Kill criterion:** " + p.kill_criterion + "\\n";
      md += "- **Why:** " + p.score_breakdown.why + "\\n\\n";
    });

    const mdPath = path.join(cwd, ".researchloop", "scratchpad", "ranked-proposals.md");
    fs.writeFileSync(mdPath, md);

    console.log("Ranked " + scored.length + " proposals -> " + rankedPath);
    console.log("Markdown summary -> " + mdPath);
  } else {
    process.stdout.write(JSON.stringify(scored, null, 2));
  }
}

function cmdHelp() {'''

if old_fn not in content:
    print("ERROR: cmdHelp marker not found")
    exit(1)

content = content.replace(old_fn, new_fn, 1)

# 2. Add dispatch after propose
old_dispatch = '''} else if (command === "propose") {
    cmdPropose();
  } else if (command === "prompt") {'''
new_dispatch = '''} else if (command === "propose") {
    cmdPropose();
  } else if (command === "rank") {
    cmdRank();
  } else if (command === "prompt") {'''

if old_dispatch not in content:
    print("ERROR: propose dispatch not found")
    exit(1)

content = content.replace(old_dispatch, new_dispatch, 1)

# 3. Add help text
old_help = 'autoresearch propose [--n N] [--write] [--mode propose|novel|autonomous] [--focus hyperparameters|architecture|attention|data] [--dir PATH]'
new_help = 'autoresearch propose [--n N] [--write] [--mode propose|novel|autonomous] [--focus hyperparameters|architecture|attention|data] [--dir PATH]\n  autoresearch rank [--input PATH] [--write] [--dir PATH]'

if old_help not in content:
    print("ERROR: help text not found")
    exit(1)

content = content.replace(old_help, new_help, 1)

with open('bin/researchloop.js', 'w') as f:
    f.write(content)

print("G02 rank patched successfully")