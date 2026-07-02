// `autoresearch shard-plan` — recommend TP × PP × DP for a target model.
//
// Given (model size, sequence length, batch, dtype, optimizer) and a cluster
// (total GPUs, VRAM per GPU), search the small space of parallelism splits
// and return the configuration that:
//   - actually fits in VRAM (per-GPU memory ≤ vram − reserve)
//   - minimizes communication: prefer DP > PP > TP at equal feasibility,
//     because TP needs the fastest interconnect (NVLink/NVSwitch).
//
// We score each candidate with a simple priority:
//   1. fits (hard constraint)
//   2. prefer the largest DP feasible (most overlap with compute)
//   3. prefer smaller TP (TP needs the NVLink mesh; PP can cross PCIe)
//   4. prefer smaller PP (PP bubble = (PP - 1) / num_microbatches)
//
// Uses the same per-component memory model as `gpu-fit`: weights + grads +
// optimizer state (ZeRO-aware when DP shards them) + activations (Korthikanti
// 2022 rule). PP shards layers, so PP=N divides activations and weight bytes
// by N at the cost of bubble inefficiency.

import { fmt } from "./researchloop-core.js";

const DTYPE_BYTES = {
  fp32: 4, fp16: 2, bf16: 2, fp8: 1, int8: 1, int4: 0.5,
};
const GPU_VRAM_GB = {
  "h200": 141, "h100": 80, "a100-80": 80, "a100": 80, "a100-40": 40,
  "l40s": 48, "l40": 48, "rtx6000ada": 48, "rtx4090": 24, "rtx3090": 24,
  "a10g": 24, "v100-32": 32, "v100-16": 16, "t4": 16,
  "mi300x": 192,
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

function fmtParams(p) {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1e9) return (p / 1e9).toFixed(2) + "B";
  if (p >= 1e6) return (p / 1e6).toFixed(2) + "M";
  return String(Math.round(p));
}

function derivedParams(layers, dModel, dFf, vocab) {
  if (!Number.isFinite(layers) || !Number.isFinite(dModel)) return null;
  const ff = Number.isFinite(dFf) ? dFf : 4 * dModel;
  return layers * (4 * dModel * dModel + 2 * dModel * ff) + (Number.isFinite(vocab) ? vocab * dModel : 0);
}

function memoryForSplit({ P, layers, dModel, batch, seq, dtypeBytes, optimizer, gradCkpt, tp, pp, dp, zero }) {
  // Per-GPU shares:
  const layersPerStage = layers / pp;
  const paramFracTpPp = P / tp / pp;
  // ZeRO sharding across DP:
  const shardOpt = zero >= 1 ? dp : 1;
  const shardGrad = zero >= 2 ? dp : 1;
  const shardParam = zero >= 3 ? dp : 1;

  const paramBytes = (paramFracTpPp * dtypeBytes) / shardParam;
  const gradBytes = (paramFracTpPp * dtypeBytes) / shardGrad;
  const optBytesBase = (function () {
    const o = String(optimizer || "adamw").toLowerCase();
    if (o === "sgd") return paramFracTpPp * dtypeBytes;
    if (o === "adam8bit") return 2 * paramFracTpPp * 1;
    return 2 * paramFracTpPp * 4; // adamw
  })();
  const optBytes = optBytesBase / shardOpt;

  // Activations: per stage of PP holds layersPerStage layers, divided by TP.
  if (!Number.isFinite(dModel) || !Number.isFinite(batch) || !Number.isFinite(seq)) {
    return paramBytes + gradBytes + optBytes;
  }
  const perToken = 12 * dModel * dtypeBytes;
  const linear = layersPerStage * batch * seq * perToken;
  const attn = layersPerStage * batch * seq * seq * 2 * dtypeBytes;
  let activations = (linear + attn) / tp;
  if (gradCkpt) activations /= Math.sqrt(Math.max(1, layersPerStage));

  return paramBytes + gradBytes + optBytes + activations;
}

function* candidates(totalGpus) {
  // Enumerate (tp, pp, dp) with tp*pp*dp ≤ totalGpus and tp,pp,dp are
  // divisors of totalGpus when multiplied — we only require the product to
  // fit the cluster, and tp/pp ∈ small powers of 2 in practice.
  const small = [1, 2, 4, 8, 16, 32, 64];
  for (const tp of small) {
    for (const pp of small) {
      const dpProduct = totalGpus / (tp * pp);
      if (!Number.isInteger(dpProduct) || dpProduct < 1) continue;
      const dp = dpProduct;
      yield { tp, pp, dp };
    }
  }
}

export async function cmdShardPlan(ctx) {
  const { option, hasFlag } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  let P = parseSize(option("--params", null));
  const layers = parseSize(option("--layers", null));
  const dModel = parseSize(option("--d-model", null));
  const dFf = parseSize(option("--d-ff", null));
  const vocab = parseSize(option("--vocab", null)) ?? 32000;
  const batch = parseSize(option("--batch", null)) ?? 1;
  const seq = parseSize(option("--seq", null)) ?? 4096;
  const dtype = String(option("--dtype", "bf16")).toLowerCase();
  const optimizer = String(option("--optimizer", "adamw")).toLowerCase();
  const gradCkpt = hasFlag("--grad-checkpoint") || hasFlag("--gc");
  const totalGpus = parseInt(String(option("--gpus", "8")), 10) || 8;
  const gpuName = String(option("--gpu", "h100")).toLowerCase();
  const vramGb = parseSize(option("--vram-gb", null)) ?? GPU_VRAM_GB[gpuName] ?? 80;
  const reserveGb = parseSize(option("--reserve-gb", null)) ?? 2;
  const zero = parseInt(String(option("--zero", "1")), 10) || 0;

  if (!Number.isFinite(P) && Number.isFinite(layers) && Number.isFinite(dModel)) {
    P = derivedParams(layers, dModel, dFf, vocab);
  }
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(layers)) {
    console.error("Need --params (or --layers + --d-model) AND --layers (used for activations / PP).");
    console.error("Example: autoresearch shard-plan --layers 80 --d-model 8192 --d-ff 28672 --vocab 128256 --batch 1 --seq 8192 --dtype bf16 --gpus 32 --gpu H100");
    process.exitCode = 1;
    return;
  }

  const dtypeBytes = DTYPE_BYTES[dtype];
  if (!Number.isFinite(dtypeBytes)) {
    console.error(`Unknown --dtype "${dtype}". Use one of: ${Object.keys(DTYPE_BYTES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  const vramBudget = (vramGb - reserveGb) * 1e9;

  const scored = [];
  for (const cand of candidates(totalGpus)) {
    if (layers % cand.pp !== 0) continue; // PP must divide layers
    const perGpu = memoryForSplit({
      P, layers, dModel, batch, seq, dtypeBytes, optimizer, gradCkpt,
      tp: cand.tp, pp: cand.pp, dp: cand.dp, zero,
    });
    const fits = perGpu <= vramBudget;
    // Score: feasibility, then prefer larger DP, smaller TP, smaller PP.
    const score = (fits ? 1e9 : 0) + cand.dp * 1000 - cand.tp * 100 - cand.pp * 10;
    scored.push({ ...cand, per_gpu_bytes: perGpu, fits, score, headroom_bytes: vramBudget - perGpu });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, 8);
  const best = scored.find((s) => s.fits) || null;

  if (formatJson) {
    console.log(JSON.stringify({
      params: P, layers, d_model: dModel, d_ff: dFf, vocab,
      batch, seq, dtype, optimizer, grad_checkpoint: gradCkpt,
      total_gpus: totalGpus, gpu: gpuName, vram_gb: vramGb, reserve_gb: reserveGb,
      zero_stage: zero,
      recommended: best,
      top: top,
    }, null, 2));
    return;
  }

  console.log("autoresearch shard-plan");
  console.log(`model: P=${fmtParams(P)}  ${layers}L × ${dModel} d_model  batch=${batch} seq=${seq}  dtype=${dtype} optimizer=${optimizer}${gradCkpt ? " grad-ckpt" : ""}`);
  console.log(`cluster: ${totalGpus} × ${gpuName} (${vramGb} GB, reserve ${reserveGb} GB) — ZeRO=${zero}`);
  console.log("---");
  if (!best) {
    console.log("No (TP, PP, DP) split fits in the given VRAM. Try:");
    console.log("  --grad-checkpoint  --optimizer adam8bit  --zero 3  --dtype fp8");
    console.log("Or use a larger GPU / more GPUs.");
  } else {
    console.log(`RECOMMENDED: TP=${best.tp}  PP=${best.pp}  DP=${best.dp}    per-GPU=${(best.per_gpu_bytes / 1e9).toFixed(2)} GB   headroom=${(best.headroom_bytes / 1e9).toFixed(2)} GB`);
    if (best.tp > 1 && best.tp > best.dp) {
      console.log("  Note: large TP relative to DP — make sure the TP group is co-resident on an NVLink/NVSwitch domain (single node, not across PCIe).");
    }
    if (best.pp > 1) {
      const bubble = (best.pp - 1);
      console.log(`  Note: PP=${best.pp} introduces a pipeline bubble — schedule enough micro-batches to amortize (~${bubble * 2}+ recommended).`);
    }
  }
  console.log("---");
  console.log("Top candidates (✓ = fits):");
  console.log("| #  | TP | PP | DP | per-GPU GB | headroom GB | fits |");
  console.log("| ---| ---| ---| ---| ---        | ---         | ---  |");
  top.forEach((c, i) => {
    console.log(`| ${String(i + 1).padStart(2)} | ${String(c.tp).padStart(2)} | ${String(c.pp).padStart(2)} | ${String(c.dp).padStart(2)} | ${(c.per_gpu_bytes / 1e9).toFixed(2).padStart(10)} | ${(c.headroom_bytes / 1e9).toFixed(2).padStart(11)} | ${c.fits ? " ✓ " : " ✗ "} |`);
  });
}
