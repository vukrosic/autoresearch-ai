// `autoresearch mfu` — Model FLOPs Utilization for recorded runs.
//
// The single most-asked question after "did it fit": how efficiently is the
// training step actually using the silicon? MFU = (achieved training FLOPs/s)
// / (peak FLOPs/s of the GPU you're on). A well-tuned LLM training run
// achieves 40–55% MFU on H100/A100; 20% is leaving half the compute on the
// floor; 5% means the dataloader is the bottleneck (or PCIe, or a buggy
// kernel).
//
// Per-token training FLOPs ≈ 6 × P (Kaplan 2020). Per-step training FLOPs ≈
// 6 × P × batch × seq. The user provides batch and seq (or the command does
// in row.config). We auto-derive P from --params or from --layers+--d-model
// (same rule as `gpu-fit`), or read it from row.config.params / row.params.
//
// Peak FLOPs come from a baked-in registry of GPU SKUs (BF16 tensor TFLOPs);
// override per-row with --tflops N. We multiply by the world size (TP × DP ×
// PP) when known to get cluster-level peak.

import { readLedgerRows, rowMetricValue } from "./researchloop-core.js";

// Peak TFLOPS for the most common training accelerators (BF16 tensor core,
// dense, no sparsity). All are vendor-published; conservative end of the
// range when there's ambiguity.
const GPU_PEAK_BF16_TFLOPS = {
  "h200": 989,
  "h100": 989,
  "h100-sxm": 989,
  "h100-pcie": 756,
  "a100": 312,
  "a100-80": 312,
  "a100-40": 312,
  "a100-sxm": 312,
  "l40s": 362,
  "l40": 181,
  "rtx6000ada": 365,
  "rtx4090": 165,
  "rtx3090": 142,
  "a10g": 125,
  "v100": 125,
  "v100-32": 125,
  "v100-16": 125,
  "t4": 65,
  "mi300x": 1300,
  "mi250x": 383,
  "tpu-v4": 275,
  "tpu-v5e": 197,
  "tpu-v5p": 459,
};

function parseSize(raw) {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().toLowerCase().replace(/_/g, "");
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const m = text.match(/^([\d.]+(?:e[+-]?\d+)?)([kmbt])?$/);
  if (m) return parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1);
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function fmtBig(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + "K";
  return n.toFixed(2);
}

function derivedParams(layers, dModel, dFf, vocab) {
  if (!Number.isFinite(layers) || !Number.isFinite(dModel)) return null;
  const ff = Number.isFinite(dFf) ? dFf : 4 * dModel;
  const perLayer = 4 * dModel * dModel + 2 * dModel * ff;
  const embed = Number.isFinite(vocab) ? vocab * dModel : 0;
  return layers * perLayer + embed;
}

function rowParams(row, overrides) {
  const candidates = [
    overrides.params,
    row?.params?.params,
    row?.config?.params,
    row?.config?.n_params,
    row?.config?.model_params,
    row?.params?.n_params,
    row?.n_params,
  ];
  for (const c of candidates) {
    const n = parseSize(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const L = overrides.layers ?? row?.config?.layers ?? row?.config?.n_layers ?? row?.params?.layers;
  const D = overrides.dModel ?? row?.config?.d_model ?? row?.config?.hidden_size ?? row?.params?.d_model;
  const F = overrides.dFf ?? row?.config?.d_ff ?? row?.config?.ffn_dim ?? row?.config?.intermediate_size ?? row?.params?.d_ff;
  const V = overrides.vocab ?? row?.config?.vocab_size ?? row?.config?.vocab ?? row?.params?.vocab_size ?? 32000;
  return derivedParams(parseSize(L), parseSize(D), parseSize(F), parseSize(V));
}

function rowSteps(row) {
  const candidates = [row?.steps, row?.config?.steps, row?.config?.max_steps, row?.config?.train_steps];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function rowBatchSeq(row, overrides) {
  const batch = parseSize(overrides.batch ?? row?.config?.batch_size ?? row?.config?.batch ?? row?.config?.train_batch_size ?? row?.params?.batch_size);
  const seq = parseSize(overrides.seq ?? row?.config?.seq_len ?? row?.config?.seq_length ?? row?.config?.max_seq_len ?? row?.config?.context_length ?? row?.params?.seq_len);
  const tokensPerStep = (Number.isFinite(batch) && Number.isFinite(seq)) ? batch * seq : null;
  return { batch, seq, tokensPerStep };
}

function gpuPeakTflops(name) {
  const k = String(name || "").toLowerCase().trim();
  if (!k) return null;
  if (GPU_PEAK_BF16_TFLOPS[k] !== undefined) return GPU_PEAK_BF16_TFLOPS[k];
  for (const [alias, v] of Object.entries(GPU_PEAK_BF16_TFLOPS)) {
    if (k.includes(alias)) return v;
  }
  return null;
}

function rowGpuName(row) {
  const env = row?.env || {};
  const names = []
    .concat(env.gpu_names || [])
    .concat(env.gpu_name ? [env.gpu_name] : [])
    .concat(row?.gpu_name ? [row.gpu_name] : []);
  return names.length > 0 ? String(names[0]) : null;
}

function rowWorldSize(row) {
  return parseSize(row?.gpu_count ?? row?.config?.world_size ?? row?.env?.gpu_count) ?? 1;
}

// Pure analyzer — used by cmdReport, cmdReview, and the CLI cmdMfu.
// Returns either a result object (with {mfu, achievedFlopsPerSec, ...}) or
// null when the row lacks enough fields. Never throws.
export function computeMfuForRow(row, overrides = {}) {
  return compute(row, overrides);
}

function compute(row, overrides) {
  const wall = Number(row?.wall_seconds);
  if (!Number.isFinite(wall) || wall <= 0) return null;
  const P = rowParams(row, overrides);
  if (!Number.isFinite(P) || P <= 0) return null;
  const { batch, seq, tokensPerStep } = rowBatchSeq(row, overrides);
  const steps = rowSteps(row);
  // total training tokens. Prefer explicit; else steps × tokens/step.
  const totalTokens = parseSize(overrides.tokens ?? row?.tokens ?? row?.config?.tokens)
    ?? (Number.isFinite(steps) && Number.isFinite(tokensPerStep) ? steps * tokensPerStep : null);
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null;
  const totalFlops = 6 * P * totalTokens;
  const achievedFlopsPerSec = totalFlops / wall;
  const gpuName = overrides.gpu ?? rowGpuName(row);
  const peakTflopsSingle = parseSize(overrides.tflops) ?? gpuPeakTflops(gpuName);
  const worldSize = parseSize(overrides.gpus) ?? rowWorldSize(row);
  if (!Number.isFinite(peakTflopsSingle) || peakTflopsSingle <= 0) {
    return { id: row.id, P, totalTokens, wall, totalFlops, achievedFlopsPerSec, peakTflopsSingle: null, worldSize, mfu: null, gpuName, batch, seq };
  }
  const peakFlopsPerSec = peakTflopsSingle * 1e12 * worldSize;
  const mfu = achievedFlopsPerSec / peakFlopsPerSec;
  return { id: row.id, P, totalTokens, wall, totalFlops, achievedFlopsPerSec, peakTflopsSingle, worldSize, mfu, gpuName, batch, seq };
}

export async function cmdMfu(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  // Optional overrides applied to every row (or a single --id).
  const overrides = {
    params: option("--params", null),
    layers: option("--layers", null),
    dModel: option("--d-model", null),
    dFf: option("--d-ff", null),
    vocab: option("--vocab", null),
    batch: option("--batch", null),
    seq: option("--seq", null),
    tokens: option("--tokens", null),
    gpu: option("--gpu", null),
    tflops: option("--tflops", null),
    gpus: option("--gpus", null),
  };

  const positional = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "--id" && args[i - 1] !== "--params" && args[i - 1] !== "--layers" && args[i - 1] !== "--d-model" && args[i - 1] !== "--d-ff" && args[i - 1] !== "--vocab" && args[i - 1] !== "--batch" && args[i - 1] !== "--seq" && args[i - 1] !== "--tokens" && args[i - 1] !== "--gpu" && args[i - 1] !== "--tflops" && args[i - 1] !== "--gpus" && args[i - 1] !== "--format" && args[i - 1] !== "--dir");
  const onlyId = option("--id", positional || null);

  const rows = readLedgerRows(cwd);
  if (rows.length === 0) {
    console.error("No runs in ledger.");
    process.exitCode = 1;
    return;
  }

  const target = onlyId ? rows.filter((r) => String(r.id) === String(onlyId)) : rows;
  const results = target.map((r) => compute(r, overrides)).filter(Boolean);

  if (results.length === 0) {
    console.error("No rows have enough fields to compute MFU.");
    console.error("MFU needs per row: wall_seconds, params (or layers+d_model), batch+seq (or tokens), steps (when computing tokens from batch×seq×steps).");
    console.error("Apply project-wide via overrides, e.g.:");
    console.error("  autoresearch mfu --params 7B --batch 2 --seq 4096 --gpu H100");
    process.exitCode = 1;
    return;
  }

  if (formatJson) {
    console.log(JSON.stringify({ n: results.length, runs: results }, null, 2));
    return;
  }

  console.log("autoresearch mfu");
  console.log(`runs analyzed: ${results.length}${onlyId ? ` (filtered to ${onlyId})` : ""}`);
  console.log("---");
  console.log("| run id            | P       | tokens   | wall      | TFLOP/s | GPU         | world | peak TF/s | MFU    |");
  console.log("| ---               | ---     | ---      | ---       | ---     | ---         | ---   | ---       | ---    |");
  for (const r of results.sort((a, b) => (b.mfu ?? -1) - (a.mfu ?? -1))) {
    const tfps = r.achievedFlopsPerSec / 1e12;
    const peak = Number.isFinite(r.peakTflopsSingle) ? r.peakTflopsSingle * r.worldSize : null;
    const mfu = r.mfu === null ? "—" : (r.mfu * 100).toFixed(1) + "%";
    console.log(`| ${String(r.id).slice(0, 17).padEnd(17)} | ${fmtBig(r.P).padStart(7)} | ${fmtBig(r.totalTokens).padStart(8)} | ${(r.wall + "s").padStart(9)} | ${tfps.toFixed(1).padStart(7)} | ${String(r.gpuName || "?").slice(0, 11).padEnd(11)} | ${String(r.worldSize).padStart(5)} | ${peak === null ? "?".padStart(9) : peak.toFixed(0).padStart(9)} | ${mfu.padStart(6)} |`);
  }
  console.log("---");
  const withMfu = results.filter((r) => r.mfu !== null);
  if (withMfu.length > 0) {
    const med = withMfu.map((r) => r.mfu).sort()[Math.floor(withMfu.length / 2)];
    console.log(`median MFU: ${(med * 100).toFixed(1)}%`);
    if (med < 0.20) {
      console.log("Heads up: median MFU < 20%. Likely culprits in order: dataloader stall (check `nvidia-smi dmon` for sm util gaps), small batch + un-flash-attn, fp32 master weights, optimizer step compiled in eager mode, gradient sync over slow interconnect.");
    } else if (med < 0.35) {
      console.log("OK but not great: 20–35% MFU. Common wins: enable FlashAttention-2, bump per-device batch with grad-accum, use torch.compile, switch optimizer to fused/AdamW8bit.");
    } else if (med >= 0.45) {
      console.log("Excellent: median MFU ≥ 45%. Most well-tuned LLM training tops out around 50–55% on H100/A100.");
    }
  }
  const missingPeak = results.filter((r) => r.peakTflopsSingle === null);
  if (missingPeak.length > 0) {
    console.log(`(${missingPeak.length} rows missing GPU peak — pass --gpu H100 or --tflops 989 to fill in.)`);
  }
}
