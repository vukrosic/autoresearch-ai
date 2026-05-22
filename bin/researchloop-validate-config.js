// `autoresearch validate-config` — schema lint for `.researchloop/*.yaml`.
//
// We don't pull in a real YAML library (zero-dep), but each of the autoresearch
// config files has a known shape that we can validate textually:
//   - eval.yaml      : metrics[], curves[], early_stop[], gates[], retry[], checkpoint_glob, resume_flag_template
//   - safety.yaml    : allow_prefixes[], deny_substrings[], max_minutes_per_run, max_cost_usd_per_run
//   - cost.yaml      : gpu (string), hourly_usd (number)
//   - review.yaml    : checks[]
//   - notify.yaml    : webhooks[]
//
// Each check returns { file, ok, errors[], warnings[] }. Aggregate exit is 0
// if everything passes, 1 if any errors, 0 with warnings printed otherwise.

import fs from "node:fs";
import path from "node:path";

function read(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

function checkEvalYaml(file) {
  const text = read(file);
  if (text === null) return { file, ok: true, errors: [], warnings: ["not present (optional)"] };
  const errors = [];
  const warnings = [];

  // Required: at least one metric or a curves entry (downstream commands need something).
  const hasMetrics = /^\s*metrics:\s*$/m.test(text);
  const hasCurves = /^\s*curves:\s*$/m.test(text);
  if (!hasMetrics && !hasCurves) warnings.push("no `metrics:` or `curves:` block — `run` will fall back to defaults");

  // Each `regex:` line should be quoted to avoid YAML stringification surprises.
  const regexMatches = text.match(/^\s+regex:\s+(.+)$/gm) || [];
  for (const line of regexMatches) {
    const m = line.match(/^\s+regex:\s+(.+)$/);
    if (!m) continue;
    const value = m[1].trim();
    if (!/^['"]/.test(value)) warnings.push(`regex value not quoted: ${value.slice(0, 60)} (recommend wrapping in single quotes)`);
  }

  // `direction:` must be lower|higher
  const dirs = text.match(/^\s+direction:\s+(\S+)/gm) || [];
  for (const line of dirs) {
    const m = line.match(/^\s+direction:\s+(\S+)/);
    if (!m) continue;
    const v = m[1].toLowerCase();
    if (!["lower", "higher", "min", "max", "minimize", "maximize"].includes(v)) {
      errors.push(`direction must be lower|higher (got '${v}')`);
    }
  }

  // `early_stop` rule shape: must reference a known rule type
  const ruleLines = text.match(/^\s+-\s+\{[^}]*rule:\s*[^,}]+/gm) || [];
  for (const line of ruleLines) {
    const m = line.match(/rule:\s*['"]?([^'",}\s]+)/);
    if (!m) continue;
    const rule = m[1];
    if (!/^(nan_or_inf|>\d+x_baseline_after_step_\d+|<\d+x_baseline_after_step_\d+)$/.test(rule)) {
      warnings.push(`unrecognized early_stop rule: ${rule}`);
    }
  }

  // gates: op should be one of <, <=, >, >=, ==, !=
  const opLines = text.match(/^\s+-\s+\{[^}]*op:\s*[^,}]+/gm) || [];
  for (const line of opLines) {
    const m = line.match(/op:\s*['"]?([^'",}\s]+)/);
    if (!m) continue;
    const op = m[1];
    if (!["<", "<=", ">", ">=", "==", "=", "!="].includes(op)) {
      errors.push(`gate op must be one of <, <=, >, >=, ==, != (got '${op}')`);
    }
  }

  return { file, ok: errors.length === 0, errors, warnings };
}

function checkSafetyYaml(file) {
  const text = read(file);
  if (text === null) return { file, ok: true, errors: [], warnings: ["not present (optional — defaults apply)"] };
  const errors = [];
  const warnings = [];
  if (!/^\s*allow_prefixes:\s*$/m.test(text)) warnings.push("no `allow_prefixes:` block — defaults apply");

  const minutesMatch = text.match(/^\s*max_minutes_per_run:\s*(\S+)/m);
  if (minutesMatch) {
    const n = Number(minutesMatch[1]);
    if (!Number.isFinite(n) || n <= 0) errors.push(`max_minutes_per_run must be a positive number (got '${minutesMatch[1]}')`);
    else if (n > 720) warnings.push(`max_minutes_per_run=${n} is > 12 hours — confirm this is intended`);
  }
  const costMatch = text.match(/^\s*max_cost_usd_per_run:\s*(\S+)/m);
  if (costMatch) {
    const n = Number(costMatch[1]);
    if (!Number.isFinite(n) || n < 0) errors.push(`max_cost_usd_per_run must be a non-negative number (got '${costMatch[1]}')`);
  }
  return { file, ok: errors.length === 0, errors, warnings };
}

function checkCostYaml(file) {
  const text = read(file);
  if (text === null) return { file, ok: true, errors: [], warnings: ["not present (optional)"] };
  const errors = [];
  const warnings = [];
  const hourlyMatch = text.match(/^\s*hourly_usd:\s*(\S+)/m);
  if (!hourlyMatch) errors.push("missing required `hourly_usd:` key");
  else {
    const n = Number(hourlyMatch[1]);
    if (!Number.isFinite(n) || n < 0) errors.push(`hourly_usd must be a non-negative number (got '${hourlyMatch[1]}')`);
  }
  if (!/^\s*gpu:\s*\S+/m.test(text)) warnings.push("no `gpu:` key — accounting will work but won't tell you which accelerator");
  return { file, ok: errors.length === 0, errors, warnings };
}

function checkReviewYaml(file) {
  const text = read(file);
  if (text === null) return { file, ok: true, errors: [], warnings: ["not present (optional)"] };
  return { file, ok: true, errors: [], warnings: [] };
}

function checkNotifyYaml(file) {
  const text = read(file);
  if (text === null) return { file, ok: true, errors: [], warnings: ["not present (optional)"] };
  const errors = [];
  const warnings = [];
  const urls = text.match(/url:\s*(\S+)/gm) || [];
  for (const line of urls) {
    const m = line.match(/url:\s*(\S+)/);
    if (!m) continue;
    if (!/^https?:\/\//.test(m[1])) errors.push(`webhook url must start with http(s)://  got: ${m[1]}`);
  }
  return { file, ok: errors.length === 0, errors, warnings };
}

const CHECKS = [
  ["eval.yaml", checkEvalYaml],
  ["safety.yaml", checkSafetyYaml],
  ["cost.yaml", checkCostYaml],
  ["review.yaml", checkReviewYaml],
  ["notify.yaml", checkNotifyYaml],
];

export async function cmdValidateConfig(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const results = [];
  for (const [name, fn] of CHECKS) {
    const file = path.join(cwd, ".researchloop", name);
    results.push({ name, ...fn(file) });
  }

  const anyError = results.some((r) => !r.ok);
  if (formatJson) {
    console.log(JSON.stringify({ all_ok: !anyError, results }, null, 2));
  } else {
    console.log("autoresearch validate-config");
    console.log("---");
    for (const r of results) {
      const status = r.ok ? "ok" : "FAIL";
      console.log(`[${status}] ${r.name}`);
      for (const e of r.errors) console.log(`  error: ${e}`);
      for (const w of r.warnings) console.log(`  warning: ${w}`);
    }
    console.log("---");
    if (anyError) console.log("verdict: FAIL — fix errors above before running");
    else console.log("verdict: ok");
  }
  if (anyError) process.exitCode = 1;
}
