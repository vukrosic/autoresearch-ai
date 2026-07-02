// `autoresearch compute-budget` — Chinchilla-style compute calculator.
//
// Two empirical rules of thumb power this:
//   1. Chinchilla-optimal: optimal tokens ≈ 20 × non-embedding params
//      (Hoffmann et al. 2022; "scaling laws for compute-optimal LLMs")
//   2. Transformer FLOPs ≈ 6 × params × tokens
//      (Kaplan et al. 2020; standard forward+backward+optimizer factor)
//
// Inputs come as any two of {params, tokens, flops, gpu_days}; the rest are
// derived. With `.researchloop/cost.yaml` we also report USD. The output is
// meant to settle "do we have enough compute for this model size?" in seconds
// rather than spreadsheets.

import { loadCostYaml, fmt } from "./researchloop-core.js";

const SECONDS_PER_DAY = 86400;

// Default H100 sustained TFLOPS for transformer training (BF16, MFU ~50%).
// Researchers can override with --tflops to match their accelerator + MFU.
const DEFAULT_TFLOPS = 989; // theoretical peak BF16; not sustained
const DEFAULT_MFU = 0.5;    // typical model-FLOPs-utilization for well-tuned LLM training

function parseSizeLike(raw) {
  // Accepts "7B", "1.5b", "350M", "13_000_000_000", or plain "13e9".
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase().replace(/_/g, "");
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const m = text.match(/^([\d.]+(?:e[+-]?\d+)?)([kmbt])?$/);
  if (m) {
    const num = parseFloat(m[1]);
    if (!Number.isFinite(num)) return null;
    return num * (m[2] ? mult[m[2]] : 1);
  }
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function fmtBig(n) {
  if (!Number.isFinite(n)) return "null";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

function fmtFlops(f) {
  if (!Number.isFinite(f)) return "null";
  if (f >= 1e21) return (f / 1e21).toFixed(2) + " ZFLOPs";
  if (f >= 1e18) return (f / 1e18).toFixed(2) + " EFLOPs";
  if (f >= 1e15) return (f / 1e15).toFixed(2) + " PFLOPs";
  if (f >= 1e12) return (f / 1e12).toFixed(2) + " TFLOPs";
  return f.toExponential(2) + " FLOPs";
}

export async function cmdCompute(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const params = parseSizeLike(option("--params", null));
  const tokens = parseSizeLike(option("--tokens", null));
  const flops = parseSizeLike(option("--flops", null));
  const gpuDays = parseSizeLike(option("--gpu-days", null));
  const tflopsSustained = parseFloat(String(option("--tflops", String(DEFAULT_TFLOPS)))) * parseFloat(String(option("--mfu", String(DEFAULT_MFU))));
  const numGpus = parseInt(String(option("--gpus", "1")), 10) || 1;
  const chinchillaRatio = parseFloat(String(option("--tokens-per-param", "20")));

  const provided = [params, tokens, flops, gpuDays].filter((v) => Number.isFinite(v) && v > 0);
  if (provided.length === 0) {
    console.error("Usage: autoresearch compute-budget [--params 7B] [--tokens 140B] [--flops 5.88e22] [--gpu-days N] [--gpus N] [--tflops N] [--mfu 0.5] [--tokens-per-param 20] [--format text|json]");
    console.error("Provide at least one of --params, --tokens, --flops, --gpu-days. Others are derived.");
    process.exitCode = 1;
    return;
  }

  // Solve the under-constrained system using the two laws.
  let P = params;
  let T = tokens;
  let F = flops;
  let GD = gpuDays;

  // If only params given -> assume Chinchilla-optimal tokens
  if (P && !T && !F) T = P * chinchillaRatio;
  // If only tokens given -> derive Chinchilla-optimal params
  if (T && !P && !F) P = T / chinchillaRatio;
  // Compute F from P and T if we have them
  if (P && T && !F) F = 6 * P * T;
  // If F is given but not both P and T, fall back: assume Chinchilla-optimal
  if (F && !P && !T) {
    // F = 6 * P * (20P) = 120 P^2 -> P = sqrt(F / 120)
    P = Math.sqrt(F / 120);
    T = P * chinchillaRatio;
  } else if (F && P && !T) {
    T = F / (6 * P);
  } else if (F && T && !P) {
    P = F / (6 * T);
  }

  // GPU-days <-> FLOPs
  // FLOPs/sec sustained = tflopsSustained * 1e12 * numGpus
  const sustainedFlopsPerSec = tflopsSustained * 1e12 * numGpus;
  if (!F && GD) F = GD * SECONDS_PER_DAY * sustainedFlopsPerSec;
  if (F && !GD) GD = F / (SECONDS_PER_DAY * sustainedFlopsPerSec);
  // Re-solve P/T if F was added by gpu-days alone
  if (GD && F && !P) {
    P = Math.sqrt(F / 120);
    T = P * chinchillaRatio;
  }

  const cost = loadCostYaml(cwd);
  const hourly = cost && Number.isFinite(Number(cost.hourly_usd)) ? Number(cost.hourly_usd) : null;
  const estCost = hourly !== null && Number.isFinite(GD) ? GD * 24 * hourly * numGpus : null;

  const out = {
    inputs: { params, tokens, flops, gpu_days: gpuDays, gpus: numGpus, tflops_sustained: tflopsSustained, tokens_per_param: chinchillaRatio },
    params: P,
    tokens: T,
    flops: F,
    gpu_days: GD,
    gpu_hours: Number.isFinite(GD) ? GD * 24 : null,
    sustained_flops_per_sec: sustainedFlopsPerSec,
    est_cost_usd: estCost,
    notes: [
      "Tokens-per-param ratio (Chinchilla) defaults to 20 — pass --tokens-per-param to override.",
      "FLOPs ≈ 6 × params × tokens for transformer training (forward+backward+optimizer).",
      `Sustained throughput = ${tflopsSustained.toFixed(1)} TFLOPS × ${numGpus} GPU = ${(sustainedFlopsPerSec / 1e12).toFixed(1)} TFLOP/s.`,
      hourly === null ? "Add .researchloop/cost.yaml with `hourly_usd: N` per GPU to enable $ estimates." : `Cost assumes hourly_usd=${hourly} per GPU.`,
    ],
  };

  if (formatJson) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  console.log("autoresearch compute-budget");
  console.log("---");
  console.log(`params:        ${fmtBig(P)}`);
  console.log(`tokens:        ${fmtBig(T)}`);
  console.log(`flops:         ${fmtFlops(F)}`);
  console.log(`gpu-days:      ${fmt(GD, 3)} (on ${numGpus} GPU${numGpus === 1 ? "" : "s"})`);
  console.log(`gpu-hours:     ${fmt(GD * 24, 2)}`);
  console.log(`assumed_mfu:   ${(tflopsSustained / DEFAULT_TFLOPS).toFixed(2)} × ${DEFAULT_TFLOPS} TFLOPS peak`);
  if (estCost !== null) {
    console.log(`est_cost_usd:  $${fmt(estCost, 2)}  (at $${fmt(hourly, 2)}/GPU-hour × ${numGpus} GPUs × ${fmt(GD * 24, 2)} hours)`);
  } else {
    console.log("est_cost_usd:  unavailable — add .researchloop/cost.yaml with `hourly_usd: N`");
  }
  console.log("---");
  for (const note of out.notes) console.log(`note: ${note}`);
}
