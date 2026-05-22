// `autoresearch api-budget` — project $ cost for an LLM API evaluation.
//
// Researchers spend more money than they think running eval sets against
// proprietary APIs. "Just 1000 prompts" turns into $400 fast when the model
// is opus-class and the outputs are long. This command does the napkin math:
//
//   cost = n_prompts × (input_tokens × input_price + output_tokens × output_price)
//
// Pricing for the major frontier APIs is baked in (as of ~2026-Q1). Override
// any number via flags; pricing is just a default.
//
// Modes:
//   --prompts N --avg-input-tokens T --avg-output-tokens U --provider claude-opus-4
//   --file prompts.jsonl    (auto-counts via approximate tokenizer — 1 token ≈ 4 chars)
//                          adds --field text|prompt|input to pick the field
//   --list                  print the pricing table and exit
//
// The text→token heuristic is the OpenAI BPE rule of thumb (~4 chars/token,
// ~0.75 words/token). It's within 10–15% of real tiktoken/cl100k for English
// prose. Pass --tokens-per-char N to tune for your domain.

import fs from "node:fs";
import path from "node:path";

// $ per 1M tokens. Approximate, public list pricing — set via --input-price /
// --output-price if your contract is different. Last refreshed around the
// model knowledge cutoff; treat as defaults and override for billing-grade
// numbers. Keys are case-insensitive.
const PRICING = {
  // Anthropic
  "claude-opus-4-7":    { in: 15.0, out: 75.0 },
  "claude-opus-4-6":    { in: 15.0, out: 75.0 },
  "claude-opus-4":      { in: 15.0, out: 75.0 },
  "claude-sonnet-4-6":  { in:  3.0, out: 15.0 },
  "claude-sonnet-4-5":  { in:  3.0, out: 15.0 },
  "claude-haiku-4-5":   { in:  1.0, out:  5.0 },
  "claude-3-5-sonnet":  { in:  3.0, out: 15.0 },
  "claude-3-5-haiku":   { in:  0.8, out:  4.0 },
  // OpenAI
  "gpt-5":              { in: 10.0, out: 40.0 },
  "gpt-4o":             { in:  2.5, out: 10.0 },
  "gpt-4o-mini":        { in:  0.15,out:  0.60 },
  "o1":                 { in: 15.0, out: 60.0 },
  "o1-mini":            { in:  3.0, out: 12.0 },
  "o3":                 { in: 10.0, out: 40.0 },
  "o3-mini":            { in:  1.1, out:  4.4 },
  // Google
  "gemini-1.5-pro":     { in:  3.5, out: 10.5 },
  "gemini-1.5-flash":   { in:  0.075,out:0.30 },
  "gemini-2.0-flash":   { in:  0.10,out:  0.40 },
  "gemini-2.5-pro":     { in:  2.5, out: 10.0 },
  // DeepSeek / open serving
  "deepseek-v3":        { in:  0.27,out:  1.10 },
  "deepseek-r1":        { in:  0.55,out:  2.19 },
  // Open models on Together
  "llama-3.1-70b":      { in:  0.88,out:  0.88 },
  "llama-3.1-405b":     { in:  5.0, out: 15.0 },
  "qwen-2.5-72b":       { in:  0.9, out:  0.9 },
};

function normName(s) { return String(s || "").toLowerCase().replace(/_/g, "-").trim(); }

function lookupPrice(name, overrideIn, overrideOut) {
  const hasInOverride = overrideIn !== null && overrideIn !== undefined && overrideIn !== true;
  const hasOutOverride = overrideOut !== null && overrideOut !== undefined && overrideOut !== true;
  const inP = hasInOverride ? Number(overrideIn) : NaN;
  const outP = hasOutOverride ? Number(overrideOut) : NaN;
  if (Number.isFinite(inP) && Number.isFinite(outP)) return { in: inP, out: outP, source: "override" };
  const n = normName(name);
  if (PRICING[n]) return { ...PRICING[n], source: "registry" };
  for (const k of Object.keys(PRICING)) {
    if (n.includes(k) || k.includes(n)) return { ...PRICING[k], source: `alias(${k})` };
  }
  return null;
}

function approxTokens(text, tokensPerChar) {
  if (!text) return 0;
  return Math.ceil(text.length * tokensPerChar);
}

function readJsonl(p) {
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

export async function cmdApiBudget(ctx) {
  const { option, hasFlag } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (hasFlag("--list")) {
    if (formatJson) {
      console.log(JSON.stringify({ pricing: PRICING }, null, 2));
    } else {
      console.log("Pricing table ($ per 1M tokens):");
      console.log("| model                | input | output |");
      console.log("| ---                  | ---   | ---    |");
      Object.entries(PRICING).sort((a, b) => a[0].localeCompare(b[0])).forEach(([k, v]) => {
        console.log(`| ${k.padEnd(20)} | ${String(v.in).padStart(5)} | ${String(v.out).padStart(6)} |`);
      });
    }
    return;
  }

  const provider = String(option("--provider", option("--model", "")) || "");
  const inPrice = option("--input-price", null);
  const outPrice = option("--output-price", null);
  const pricing = lookupPrice(provider, inPrice, outPrice);
  if (!pricing) {
    console.error(`No pricing for "${provider}". Known: ${Object.keys(PRICING).join(", ")}`);
    console.error("Pass --input-price USD_per_1M --output-price USD_per_1M for a custom model.");
    process.exitCode = 1;
    return;
  }

  const tokensPerChar = parseFloat(String(option("--tokens-per-char", "0.25"))) || 0.25;
  const filePath = option("--file", null);
  const field = String(option("--field", "prompt"));
  const expectedOutChars = parseFloat(String(option("--avg-output-chars", "0"))) || 0;
  const expectedOutTokens = parseFloat(String(option("--avg-output-tokens", String(expectedOutChars * tokensPerChar)))) || 0;

  let nPrompts;
  let avgInTokens;
  let inputSource;

  if (filePath) {
    const rows = readJsonl(path.resolve(filePath));
    nPrompts = rows.length;
    if (nPrompts === 0) { console.error(`Empty file: ${filePath}`); process.exitCode = 1; return; }
    const tokensList = rows.map((r) => {
      const text = String(r[field] ?? r.text ?? r.input ?? r.prompt ?? "");
      return approxTokens(text, tokensPerChar);
    });
    avgInTokens = tokensList.reduce((a, b) => a + b, 0) / tokensList.length;
    inputSource = `file:${filePath} (${nPrompts} rows, field "${field}", ${tokensPerChar} tok/char)`;
  } else {
    nPrompts = parseInt(String(option("--prompts", "0")), 10) || 0;
    avgInTokens = parseFloat(String(option("--avg-input-tokens", "0"))) || 0;
    inputSource = `flags: n=${nPrompts} avg_in=${avgInTokens}`;
  }
  if (nPrompts <= 0 || avgInTokens <= 0) {
    console.error("Usage:");
    console.error("  autoresearch api-budget --provider claude-opus-4-7 --prompts 1000 --avg-input-tokens 800 --avg-output-tokens 300");
    console.error("  autoresearch api-budget --provider gpt-4o --file prompts.jsonl --avg-output-tokens 200 [--field prompt]");
    console.error("  autoresearch api-budget --list");
    process.exitCode = 1;
    return;
  }

  const inTokensTotal = nPrompts * avgInTokens;
  const outTokensTotal = nPrompts * expectedOutTokens;
  const inputCost = (inTokensTotal / 1e6) * pricing.in;
  const outputCost = (outTokensTotal / 1e6) * pricing.out;
  const totalCost = inputCost + outputCost;

  // Compare against the configured budget if present.
  const budgetFile = path.join(process.cwd(), ".researchloop", "budget.json");
  let budget = null;
  if (fs.existsSync(budgetFile)) {
    try { budget = JSON.parse(fs.readFileSync(budgetFile, "utf8")); } catch { /* ignore */ }
  }

  if (formatJson) {
    console.log(JSON.stringify({
      provider, pricing, input_source: inputSource,
      n_prompts: nPrompts,
      avg_input_tokens: avgInTokens, avg_output_tokens: expectedOutTokens,
      total_input_tokens: inTokensTotal, total_output_tokens: outTokensTotal,
      input_cost_usd: inputCost, output_cost_usd: outputCost,
      total_cost_usd: totalCost,
      budget: budget ? { limit_usd: budget.limit_usd, spent_usd: budget.spent_usd } : null,
    }, null, 2));
    return;
  }

  console.log("autoresearch api-budget");
  console.log(`provider: ${provider}   pricing: $${pricing.in}/M input  $${pricing.out}/M output  (${pricing.source})`);
  console.log(`input source: ${inputSource}`);
  console.log("---");
  console.log(`prompts:                ${nPrompts.toLocaleString()}`);
  console.log(`avg input tokens:       ${avgInTokens.toFixed(1)}      total: ${inTokensTotal.toLocaleString()}`);
  console.log(`avg output tokens:      ${expectedOutTokens.toFixed(1)}      total: ${outTokensTotal.toLocaleString()}`);
  console.log("---");
  console.log(`input cost:             $${inputCost.toFixed(4)}`);
  console.log(`output cost:            $${outputCost.toFixed(4)}`);
  console.log(`TOTAL projected:        $${totalCost.toFixed(4)}`);
  if (budget && Number.isFinite(budget.limit_usd)) {
    const remaining = budget.limit_usd - (budget.spent_usd || 0);
    const wouldExceed = totalCost > remaining;
    console.log("---");
    console.log(`project budget:         $${budget.limit_usd} limit, $${budget.spent_usd || 0} spent, $${remaining.toFixed(2)} remaining`);
    if (wouldExceed) {
      console.log(`⚠ This eval would EXCEED the remaining budget by $${(totalCost - remaining).toFixed(2)}.`);
    } else {
      console.log(`✓ Within budget — would leave $${(remaining - totalCost).toFixed(2)}.`);
    }
  }
  if (totalCost > 1) {
    console.log("---");
    console.log("Reduce cost ideas:");
    if (pricing.in > 1) console.log(`  - try a cheaper provider (e.g. gpt-4o-mini, claude-haiku, deepseek-v3)`);
    if (expectedOutTokens > 200) console.log(`  - cap output tokens (max_tokens=...) — output is ${(pricing.out / pricing.in).toFixed(1)}× input price`);
    if (nPrompts > 100) console.log(`  - prompt cache: --provider claude-opus-4-7 with cache_control on the prompt prefix cuts repeated-prefix input by ~10×`);
    console.log(`  - test the eval on the first 25 prompts first; estimate noise floor with --bootstrap`);
  }
}
