// `autoresearch judge` — LLM-as-judge eval harness (offline planner).
//
// LLM-as-judge is now the default eval methodology for modern chat models —
// LMSYS arena, MT-Bench, AlpacaEval, Arena-Hard. But every team rolls their
// own. This command writes the eval harness for you:
//
//   1. Read a candidates JSONL of {prompt, model, response} rows
//      (or {prompt, model_a_response, model_b_response} for pairwise mode).
//   2. Emit a judge prompt JSONL: one row per (candidate, judge_model)
//      pair, with the judge prompt fully assembled and ready to send.
//   3. Project total cost via the same registry as `api-budget` so the
//      researcher sees the bill before sending one byte.
//
// The user runs the actual API calls themselves (we're zero-network); the
// resulting judge outputs are parsed back via `--parse PATH` into ledger
// rows compatible with `autoresearch elo` (pairwise) or scalar metrics
// compatible with `autoresearch compare`.
//
// Modes:
//   pairwise  — A vs B, judge picks winner (or tie)
//   scalar    — single response, judge scores 1–10 along axes
//   reference — single response, judge scores against a gold answer

import fs from "node:fs";
import path from "node:path";

const PAIRWISE_PROMPT = `You are a fair, careful judge comparing two AI assistant responses.

User question:
{prompt}

Response A:
{response_a}

Response B:
{response_b}

Pick the better response based on accuracy, helpfulness, and clarity. If they are equivalent, say "tie".
Respond with a JSON object only:
{"winner": "A" | "B" | "tie", "reason": "<one sentence>"}`;

const SCALAR_PROMPT = `You are a fair, careful judge scoring an AI assistant response on three axes.

User question:
{prompt}

Response:
{response}

Score each from 1 (poor) to 10 (excellent):
- accuracy: factual correctness
- helpfulness: addresses the user's actual need
- clarity: well-structured, easy to follow

Respond with a JSON object only:
{"accuracy": <int>, "helpfulness": <int>, "clarity": <int>, "reason": "<one sentence>"}`;

const REFERENCE_PROMPT = `You are a fair, careful judge comparing an AI assistant response to a gold reference answer.

User question:
{prompt}

Gold answer:
{reference}

Model response:
{response}

Score the model response from 1 (completely incorrect) to 10 (matches or exceeds the gold).
Respond with a JSON object only:
{"score": <int>, "matches_gold": <bool>, "reason": "<one sentence>"}`;

// Pricing baked in via api-budget's registry — duplicated here to keep
// modules independent. Same numbers, same caveats.
const PRICING = {
  "claude-opus-4-7":    { in: 15.0, out: 75.0 },
  "claude-sonnet-4-6":  { in:  3.0, out: 15.0 },
  "claude-haiku-4-5":   { in:  1.0, out:  5.0 },
  "gpt-5":              { in: 10.0, out: 40.0 },
  "gpt-4o":             { in:  2.5, out: 10.0 },
  "gpt-4o-mini":        { in:  0.15,out:  0.60 },
  "o3":                 { in: 10.0, out: 40.0 },
  "o3-mini":            { in:  1.1, out:  4.4 },
  "gemini-2.5-pro":     { in:  2.5, out: 10.0 },
  "gemini-1.5-flash":   { in:  0.075,out:0.30 },
  "deepseek-v3":        { in:  0.27,out:  1.10 },
};

function readJsonl(p) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l, i) => { try { return JSON.parse(l); } catch { console.error(`bad JSON at ${p}:${i + 1}`); return null; } })
    .filter(Boolean);
}

function approxTokens(s) { return Math.ceil(String(s || "").length / 4); }

function chooseTemplate(mode) {
  if (mode === "pairwise") return PAIRWISE_PROMPT;
  if (mode === "scalar") return SCALAR_PROMPT;
  if (mode === "reference") return REFERENCE_PROMPT;
  return null;
}

function fillTemplate(tmpl, vars) {
  let s = tmpl;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v ?? ""));
  return s;
}

function generatePrompts(mode, rows) {
  const tmpl = chooseTemplate(mode);
  if (!tmpl) return null;
  const out = [];
  for (const r of rows) {
    if (mode === "pairwise") {
      const a = r.response_a ?? r.model_a_response ?? r.a;
      const b = r.response_b ?? r.model_b_response ?? r.b;
      if (!a || !b) continue;
      const prompt = fillTemplate(tmpl, { prompt: r.prompt ?? r.question ?? "", response_a: a, response_b: b });
      out.push({ id: r.id, mode, judge_prompt: prompt, model_a: r.model_a, model_b: r.model_b });
    } else if (mode === "scalar") {
      const resp = r.response ?? r.completion ?? r.output;
      if (!resp) continue;
      const prompt = fillTemplate(tmpl, { prompt: r.prompt ?? r.question ?? "", response: resp });
      out.push({ id: r.id, mode, judge_prompt: prompt, model: r.model });
    } else if (mode === "reference") {
      const resp = r.response ?? r.completion ?? r.output;
      const ref = r.reference ?? r.gold ?? r.target ?? r.answer;
      if (!resp || !ref) continue;
      const prompt = fillTemplate(tmpl, { prompt: r.prompt ?? r.question ?? "", response: resp, reference: ref });
      out.push({ id: r.id, mode, judge_prompt: prompt, model: r.model });
    }
  }
  return out;
}

function parseJudgeOutput(mode, raw) {
  // Try a JSON parse first, then a fenced ```json``` block.
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(String(raw).trim());
  if (!obj) {
    const m = String(raw).match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) obj = tryParse(m[1]);
  }
  if (!obj) {
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) obj = tryParse(m[0]);
  }
  if (!obj) return null;
  if (mode === "pairwise") {
    const w = String(obj.winner || "").trim().toLowerCase();
    if (!["a", "b", "tie", "draw"].includes(w)) return { error: `unknown winner: ${obj.winner}` };
    return { winner: w === "draw" ? "tie" : w, reason: obj.reason ?? null };
  }
  if (mode === "scalar") {
    return {
      accuracy: Number(obj.accuracy), helpfulness: Number(obj.helpfulness),
      clarity: Number(obj.clarity), reason: obj.reason ?? null,
    };
  }
  if (mode === "reference") {
    return { score: Number(obj.score), matches_gold: !!obj.matches_gold, reason: obj.reason ?? null };
  }
  return null;
}

function projectCost(prompts, judgeModel, avgOutputTokens) {
  const price = PRICING[String(judgeModel || "").toLowerCase()];
  if (!price) return null;
  const inputTokens = prompts.reduce((s, p) => s + approxTokens(p.judge_prompt), 0);
  const outputTokens = prompts.length * avgOutputTokens;
  return {
    n_prompts: prompts.length,
    avg_input_tokens: prompts.length > 0 ? inputTokens / prompts.length : 0,
    avg_output_tokens: avgOutputTokens,
    input_cost_usd: (inputTokens / 1e6) * price.in,
    output_cost_usd: (outputTokens / 1e6) * price.out,
    total_cost_usd: (inputTokens / 1e6) * price.in + (outputTokens / 1e6) * price.out,
  };
}

export async function cmdJudge(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Parse mode: turn raw judge outputs back into structured rows.
  if (hasFlag("--parse")) {
    const inputPath = option("--parse", null);
    const promptsPath = option("--prompts", null);
    if (typeof inputPath !== "string" || !promptsPath) {
      console.error("Usage: autoresearch judge --parse outputs.jsonl --prompts judge_prompts.jsonl --mode pairwise|scalar|reference [--out parsed.jsonl]");
      process.exitCode = 1;
      return;
    }
    const outputs = readJsonl(path.resolve(inputPath));
    const promptRows = readJsonl(path.resolve(promptsPath));
    const promptIdx = new Map(promptRows.map((p) => [String(p.id ?? p.judge_prompt), p]));
    const mode = String(option("--mode", promptRows[0]?.mode || "pairwise"));
    const parsedRows = [];
    for (const out of outputs) {
      const rawId = String(out.id ?? "");
      const matchedPrompt = promptIdx.get(rawId);
      const raw = out.response ?? out.output ?? out.completion ?? out.judgement ?? out.text;
      const parsed = parseJudgeOutput(mode, raw);
      if (!parsed || parsed.error) {
        parsedRows.push({ id: rawId, mode, parse_error: parsed?.error || "no JSON in output" });
        continue;
      }
      parsedRows.push({ id: rawId, mode, ...parsed,
        model_a: matchedPrompt?.model_a, model_b: matchedPrompt?.model_b, model: matchedPrompt?.model });
    }
    const outPath = option("--out", null);
    const text = parsedRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    if (outPath && typeof outPath === "string") {
      fs.writeFileSync(path.resolve(cwd, outPath), text);
      console.log(`parsed: ${parsedRows.length} rows → ${outPath}`);
    } else {
      process.stdout.write(text);
    }
    const errs = parsedRows.filter((r) => r.parse_error).length;
    if (errs > 0) console.error(`parse_errors: ${errs}`);
    if (mode === "pairwise" && !outPath) {
      console.error(`Tip: pipe to \`autoresearch elo --file -\` (or pass --out and then \`autoresearch elo --file PATH\`) to compute ratings.`);
    }
    return;
  }

  // Generate mode: read candidates, emit judge prompts + cost projection.
  const mode = String(option("--mode", "pairwise"));
  if (!chooseTemplate(mode)) {
    console.error(`Unknown --mode "${mode}". Valid: pairwise | scalar | reference`);
    process.exitCode = 1;
    return;
  }
  const candPath = option("--candidates", null);
  if (typeof candPath !== "string") {
    console.error("Usage:");
    console.error("  autoresearch judge --candidates pairs.jsonl --mode pairwise --judge claude-opus-4-7 --out judge_prompts.jsonl");
    console.error("  autoresearch judge --candidates responses.jsonl --mode scalar --judge gpt-4o");
    console.error("  autoresearch judge --candidates responses.jsonl --mode reference --judge claude-sonnet-4-6");
    console.error("  autoresearch judge --parse judge_outputs.jsonl --prompts judge_prompts.jsonl");
    process.exitCode = 1;
    return;
  }

  const rows = readJsonl(path.resolve(candPath));
  const prompts = generatePrompts(mode, rows);
  if (!prompts || prompts.length === 0) {
    console.error(`No usable candidates in ${candPath} for mode "${mode}".`);
    console.error("Pairwise needs response_a + response_b; scalar needs response; reference needs response + reference.");
    process.exitCode = 1;
    return;
  }

  const judgeModel = String(option("--judge", "claude-sonnet-4-6")).toLowerCase();
  const avgOutTokens = parseInt(String(option("--avg-output-tokens", "120")), 10) || 120;
  const cost = projectCost(prompts, judgeModel, avgOutTokens);

  const outPath = option("--out", null);
  const text = prompts.map((p) => JSON.stringify(p)).join("\n") + "\n";
  if (outPath && typeof outPath === "string") {
    fs.writeFileSync(path.resolve(cwd, outPath), text);
  } else {
    process.stdout.write(text);
  }

  if (formatJson) {
    console.error(JSON.stringify({ mode, judge_model: judgeModel, n_prompts: prompts.length, cost_projection: cost, out: outPath || "stdout" }, null, 2));
    return;
  }
  if (cost) {
    console.error("---");
    console.error(`autoresearch judge   mode=${mode}   judge=${judgeModel}`);
    console.error(`emitted ${prompts.length} judge prompts → ${outPath || "stdout"}`);
    console.error(`projected cost: $${cost.total_cost_usd.toFixed(4)}  (${cost.avg_input_tokens.toFixed(0)} in × $${PRICING[judgeModel].in}/M + ${cost.avg_output_tokens.toFixed(0)} out × $${PRICING[judgeModel].out}/M per row)`);
    console.error("");
    console.error("Next steps:");
    console.error("  1. Send each judge_prompt to the judge model (curl / SDK / batch API).");
    console.error("  2. Save outputs JSONL: [{\"id\": <same id>, \"response\": <judge model output>}, ...]");
    console.error(`  3. autoresearch judge --parse outputs.jsonl --prompts ${outPath || "judge_prompts.jsonl"} --mode ${mode} --out parsed.jsonl`);
    if (mode === "pairwise") {
      console.error("  4. autoresearch elo --file parsed.jsonl --bootstrap 500");
    }
  } else {
    console.error(`emitted ${prompts.length} judge prompts (no cost projection — judge model "${judgeModel}" not in registry; pass --input-price / --output-price)`);
  }
}
