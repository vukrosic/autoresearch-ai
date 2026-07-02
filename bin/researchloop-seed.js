// `autoresearch seed` — global seed control.
//
// Writes `.researchloop/seed.json` carrying a single integer that downstream
// training scripts can read (via `RESEARCHLOOP_SEED` env var injected by
// `run`, or by reading the file directly). Also emits per-framework
// env-var snippets that researchers can source into their shells.
//
// This is intentionally tiny — researchers want one source of truth for "what
// seed are we running today" plus a way to bump it deterministically across
// runs. The framework-specific code for setting `torch.manual_seed`, etc.,
// lives in the user's training script; this file just centralizes the number.

import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./researchloop-core.js";

function seedFile(cwd) {
  return path.join(cwd, ".researchloop", "seed.json");
}

function readSeed(cwd) {
  const p = seedFile(cwd);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function writeSeed(cwd, state) {
  const p = seedFile(cwd);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

function envSnippet(seed) {
  return [
    `RESEARCHLOOP_SEED=${seed}`,
    `PYTHONHASHSEED=${seed}`,
    `CUBLAS_WORKSPACE_CONFIG=:4096:8   # required by torch.use_deterministic_algorithms(True)`,
    `# in your training script:`,
    `#   import random, numpy, torch`,
    `#   seed = int(os.environ["RESEARCHLOOP_SEED"])`,
    `#   random.seed(seed); numpy.random.seed(seed); torch.manual_seed(seed)`,
    `#   torch.cuda.manual_seed_all(seed)`,
    `#   torch.backends.cudnn.deterministic = True`,
    `#   torch.backends.cudnn.benchmark = False`,
    `#   torch.use_deterministic_algorithms(True, warn_only=True)`,
  ].join("\n");
}

export async function cmdSeed(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const setRaw = option("--set", null);
  const bump = hasFlag("--bump");
  const showEnv = hasFlag("--env");
  const clear = hasFlag("--clear");

  if (clear) {
    const p = seedFile(cwd);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    console.log(`cleared ${path.relative(cwd, p)}`);
    return;
  }

  let state = readSeed(cwd);

  if (setRaw !== null && setRaw !== undefined) {
    const n = parseInt(String(setRaw), 10);
    if (!Number.isFinite(n) || n < 0) {
      console.error(`Invalid seed: ${setRaw}. Must be a non-negative integer.`);
      process.exitCode = 1;
      return;
    }
    state = {
      seed: n,
      previous: state ? state.seed : null,
      updated_at: new Date().toISOString(),
      history: (state && state.history ? state.history : []).concat([{
        seed: n,
        at: new Date().toISOString(),
        action: "set",
      }]).slice(-20),
    };
    writeSeed(cwd, state);
    console.log(`set seed = ${n}  (was ${state.previous ?? "unset"})`);
  } else if (bump) {
    const next = state ? state.seed + 1 : 1;
    state = {
      seed: next,
      previous: state ? state.seed : null,
      updated_at: new Date().toISOString(),
      history: (state && state.history ? state.history : []).concat([{
        seed: next,
        at: new Date().toISOString(),
        action: "bump",
      }]).slice(-20),
    };
    writeSeed(cwd, state);
    console.log(`bumped seed = ${state.seed}  (was ${state.previous ?? "unset"})`);
  }

  // Show current state.
  if (formatJson) {
    console.log(JSON.stringify(state || { seed: null }, null, 2));
    return;
  }
  if (!state) {
    console.log("No seed set. Run: autoresearch seed --set 42");
    return;
  }
  console.log(`seed: ${state.seed}`);
  console.log(`previous: ${state.previous ?? "unset"}`);
  console.log(`updated_at: ${state.updated_at}`);
  if (state.history && state.history.length > 1) {
    console.log(`history (last ${state.history.length}):`);
    for (const h of state.history) {
      console.log(`  ${h.at}  ${h.action}: ${h.seed}`);
    }
  }
  if (showEnv) {
    console.log("---");
    console.log("# export the following into your shell before training:");
    console.log(envSnippet(state.seed));
  }
}
