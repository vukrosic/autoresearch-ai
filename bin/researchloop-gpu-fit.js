// `autoresearch gpu-fit` — transformer training VRAM estimator.
//
// Answers the very first question every LLM researcher asks before launching a
// run: "does this model + batch + seq-len even fit on my GPU?". The cost of
// guessing wrong is a 20-minute boot + OOM. This estimator runs locally in
// milliseconds and tells you both the per-component breakdown and which GPU
// SKUs would have room.
//
// Modeling assumptions (decoder-only transformer):
//   params P                 — provided or derived from layers × d_model × d_ff
//   weights bytes            — P × dtype_bytes
//   gradients bytes          — P × dtype_bytes (mixed precision keeps fp16/bf16)
//   optimizer state (AdamW)  — 2 × P × 4   (m, v in fp32; mixed-precision recipe)
//                  (SGD)     — P × dtype_bytes (just momentum)
//                  (8bit)    — 2 × P × 1   (bitsandbytes-style 8-bit Adam)
//   activations              — ≈ s_layer × layers × batch × seq × d_model × dtype_bytes
//                              where s_layer ~ 12 for vanilla attention + MLP
//                              (Korthikanti et al., "Reducing Activation
//                              Recomputation in Large Transformer Models", 2022).
//   grad checkpointing       — divides activation memory by ~sqrt(layers)
//
// Numbers are intentionally a single-digit-percent estimate. They will not
// match nvidia-smi exactly (kernel workspaces, fragmentation, CUDA context all
// add ~1-2 GB), but they're correct enough to decide "yes" / "no" / "halve the
// batch" before submission.

import { loadCostYaml, fmt } from "./researchloop-core.js";

const GPU_PROFILES = [
  { name: "H200",   vram_gb: 141 },
  { name: "H100",   vram_gb: 80 },
  { name: "A100-80",vram_gb: 80 },
  { name: "A100-40",vram_gb: 40 },
  { name: "L40S",   vram_gb: 48 },
  { name: "L40",    vram_gb: 48 },
  { name: "RTX6000Ada", vram_gb: 48 },
  { name: "RTX4090",vram_gb: 24 },
  { name: "RTX3090",vram_gb: 24 },
  { name: "A10G",   vram_gb: 24 },
  { name: "V100-32",vram_gb: 32 },
  { name: "V100-16",vram_gb: 16 },
  { name: "T4",     vram_gb: 16 },
];

const DTYPE_BYTES = {
  fp32: 4, float32: 4,
  fp16: 2, float16: 2, half: 2,
  bf16: 2, bfloat16: 2,
  fp8: 1, float8: 1,
  int8: 1, int4: 0.5,
};

function parseSize(raw) {
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

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const abs = Math.abs(bytes);
  if (abs >= 1e12) return (bytes / 1e12).toFixed(2) + " TB";
  if (abs >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (abs >= 1e6) return (bytes / 1e6).toFixed(2) + " MB";
  if (abs >= 1e3) return (bytes / 1e3).toFixed(2) + " KB";
  return bytes.toFixed(0) + " B";
}

function fmtParams(p) {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1e9) return (p / 1e9).toFixed(2) + "B";
  if (p >= 1e6) return (p / 1e6).toFixed(2) + "M";
  if (p >= 1e3) return (p / 1e3).toFixed(2) + "K";
  return String(Math.round(p));
}

function derivedParams({ layers, dModel, dFf, vocab }) {
  // Standard decoder-only Transformer with pre-norm + GQA-free attention:
  //   per layer: 4 × d^2 (attn QKVO) + 2 × d × d_ff (MLP up+down)
  //   embedding: vocab × d (tied with LM head by convention here)
  if (!Number.isFinite(layers) || !Number.isFinite(dModel)) return null;
  const ff = Number.isFinite(dFf) ? dFf : 4 * dModel;
  const perLayer = 4 * dModel * dModel + 2 * dModel * ff;
  const embed = Number.isFinite(vocab) ? vocab * dModel : 0;
  return layers * perLayer + embed;
}

function activationBytesPerStep({ layers, batch, seq, dModel, dtypeBytes, gradCheckpoint }) {
  if (![layers, batch, seq, dModel, dtypeBytes].every(Number.isFinite)) return null;
  // ~12 floats per token per layer worth of stored intermediates
  // (post-norm act, attn scores, softmax probs, V*P, MLP intermediate, ...);
  // attention probs alone are batch × heads × seq × seq, which dominates at
  // long seq — we approximate by adding 2 × batch × seq × seq × dtypeBytes once.
  const perToken = 12 * dModel * dtypeBytes;
  const linearTerm = layers * batch * seq * perToken;
  const attnTerm = layers * batch * seq * seq * 2 * dtypeBytes; // softmax + dropout mask
  const raw = linearTerm + attnTerm;
  if (!gradCheckpoint) return raw;
  // Selective recomputation reduces stored activations by ~sqrt(layers).
  return raw / Math.sqrt(Math.max(1, layers));
}

function optimizerBytes(P, optimizer, paramDtypeBytes) {
  const o = String(optimizer || "adamw").toLowerCase();
  if (o === "none" || o === "sgd-momentumless") return 0;
  if (o === "sgd") return P * paramDtypeBytes; // one momentum buffer
  if (o === "adam8bit" || o === "adamw8bit" || o === "8bit-adam") return 2 * P * 1;
  // adam / adamw default: fp32 m + v
  return 2 * P * 4;
}

function suggestGpus(totalBytes) {
  const totalGb = totalBytes / 1e9;
  // Reserve ~2 GB for CUDA context + kernel workspaces. Realistic margin.
  const reserved = 2;
  return GPU_PROFILES.map((g) => ({
    name: g.name,
    vram_gb: g.vram_gb,
    fits_solo: totalGb + reserved <= g.vram_gb,
    fits_dp2:  totalGb + reserved <= 2 * g.vram_gb,
    fits_dp4:  totalGb + reserved <= 4 * g.vram_gb,
    fits_dp8:  totalGb + reserved <= 8 * g.vram_gb,
  }));
}

// Pure analyzer — returns the same shape as the JSON output without any
// stdout side effects. Used by `cmdGpuFit` (CLI) and by `cmdPreflight` (so
// `autoresearch preflight` can show a fit verdict before launch).
export function analyzeVram(opts) {
  const layers = parseSize(opts.layers);
  const dModel = parseSize(opts.dModel ?? opts.d_model);
  const dFf = parseSize(opts.dFf ?? opts.d_ff);
  const vocab = parseSize(opts.vocab) || 32000;
  const batch = parseSize(opts.batch) || 1;
  const seq = parseSize(opts.seq) || 2048;
  const dtype = String(opts.dtype || "bf16").toLowerCase();
  const optimizer = String(opts.optimizer || "adamw").toLowerCase();
  const gradCheckpoint = !!opts.gradCheckpoint;
  const tp = Math.max(1, parseInt(String(opts.tp || 1), 10) || 1);
  const dp = Math.max(1, parseInt(String(opts.dp || 1), 10) || 1);
  const zeroStage = parseInt(String(opts.zero ?? 0), 10) || 0;

  const dtypeBytes = DTYPE_BYTES[dtype];
  if (!Number.isFinite(dtypeBytes)) return { error: `unknown dtype: ${dtype}` };

  let P = parseSize(opts.params);
  if (!Number.isFinite(P) && Number.isFinite(layers) && Number.isFinite(dModel)) {
    P = derivedParams({ layers, dModel, dFf, vocab });
  }
  if (!Number.isFinite(P) || P <= 0) return { error: "needs --params or --layers + --d-model" };

  const paramBytes = P * dtypeBytes;
  const gradBytes = P * dtypeBytes;
  const optBytes = optimizerBytes(P, optimizer, dtypeBytes);
  const actBytes = Number.isFinite(layers) && Number.isFinite(dModel)
    ? activationBytesPerStep({ layers, batch, seq, dModel, dtypeBytes, gradCheckpoint })
    : null;

  const shardOpt = zeroStage >= 1 ? dp : 1;
  const shardGrad = zeroStage >= 2 ? dp : 1;
  const shardParam = zeroStage >= 3 ? dp : 1;
  const perGpu = {
    params: (paramBytes / tp) / shardParam,
    grads: (gradBytes / tp) / shardGrad,
    optimizer: (optBytes / tp) / shardOpt,
    activations: actBytes !== null ? actBytes / tp : null,
  };
  const totalPerGpu = perGpu.params + perGpu.grads + perGpu.optimizer + (perGpu.activations || 0);

  return {
    params: P, layers, d_model: dModel, d_ff: dFf, vocab,
    batch, seq, dtype, optimizer, tp, dp, zero_stage: zeroStage,
    grad_checkpoint: gradCheckpoint,
    per_gpu: perGpu,
    total_per_gpu_bytes: totalPerGpu,
    gpu_fits: suggestGpus(totalPerGpu),
  };
}

export async function cmdGpuFit(ctx) {
  const { option, hasFlag } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const opts = {
    params: option("--params", null),
    layers: option("--layers", null),
    dModel: option("--d-model", null),
    dFf: option("--d-ff", null),
    vocab: option("--vocab", null) || 32000,
    batch: option("--batch", null) || 1,
    seq: option("--seq", null) || 2048,
    dtype: String(option("--dtype", "bf16")).toLowerCase(),
    optimizer: String(option("--optimizer", "adamw")).toLowerCase(),
    gradCheckpoint: hasFlag("--grad-checkpoint") || hasFlag("--gc"),
    tp: Math.max(1, parseInt(String(option("--tp", "1")), 10) || 1),
    dp: Math.max(1, parseInt(String(option("--dp", "1")), 10) || 1),
    zero: parseInt(String(option("--zero", "0")), 10) || 0,
  };

  const res = analyzeVram(opts);
  if (res.error === `unknown dtype: ${opts.dtype}`) {
    console.error(`Unknown --dtype "${opts.dtype}". Use one of: ${Object.keys(DTYPE_BYTES).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (res.error) {
    console.error("Provide --params (e.g. 7B) OR --layers + --d-model (+ optional --d-ff, --vocab) so I can compute it.");
    console.error("Examples:");
    console.error("  autoresearch gpu-fit --params 7B --batch 1 --seq 4096 --dtype bf16 --optimizer adamw");
    console.error("  autoresearch gpu-fit --layers 32 --d-model 4096 --d-ff 11008 --vocab 32000 --batch 1 --seq 4096");
    process.exitCode = 1;
    return;
  }

  const P = res.params;
  const layers = res.layers;
  const dModel = res.d_model;
  const dFf = res.d_ff;
  const vocab = res.vocab;
  const batch = res.batch;
  const seq = res.seq;
  const dtype = res.dtype;
  const optimizer = res.optimizer;
  const gradCheckpoint = res.grad_checkpoint;
  const tp = res.tp;
  const dp = res.dp;
  const zeroStage = res.zero_stage;
  const dtypeBytes = DTYPE_BYTES[dtype];
  const tpDiv = tp;
  const shardOpt = zeroStage >= 1 ? dp : 1;
  const shardGrad = zeroStage >= 2 ? dp : 1;
  const shardParam = zeroStage >= 3 ? dp : 1;
  const perGpu = res.per_gpu;
  const actBytes = perGpu.activations;
  const totalPerGpu = res.total_per_gpu_bytes;

  const breakdown = [
    { component: "params",      bytes: perGpu.params,       note: `P=${fmtParams(P)} × ${dtypeBytes}B${tpDiv > 1 ? ` ÷ TP=${tpDiv}` : ""}${shardParam > 1 ? ` ÷ ZeRO-3=${shardParam}` : ""}` },
    { component: "gradients",   bytes: perGpu.grads,        note: `P × ${dtypeBytes}B${shardGrad > 1 ? ` ÷ ZeRO-${zeroStage}=${shardGrad}` : ""}` },
    { component: "optimizer",   bytes: perGpu.optimizer,    note: `${optimizer}${shardOpt > 1 ? ` ÷ ZeRO-${zeroStage}=${shardOpt}` : ""}` },
    { component: "activations", bytes: perGpu.activations,  note: perGpu.activations !== null ? `batch=${batch} seq=${seq}${gradCheckpoint ? " (grad-ckpt)" : ""}` : "needs --layers + --d-model" },
  ];

  const gpuFits = suggestGpus(totalPerGpu);

  if (formatJson) {
    console.log(JSON.stringify({
      params: P,
      params_human: fmtParams(P),
      dtype, optimizer,
      tp, dp, zero_stage: zeroStage,
      batch, seq, vocab,
      layers: Number.isFinite(layers) ? layers : null,
      d_model: Number.isFinite(dModel) ? dModel : null,
      d_ff: Number.isFinite(dFf) ? dFf : null,
      grad_checkpoint: gradCheckpoint,
      per_gpu_bytes: {
        params: perGpu.params,
        gradients: perGpu.grads,
        optimizer: perGpu.optimizer,
        activations: perGpu.activations,
        total: totalPerGpu,
      },
      total_per_gpu_gb: totalPerGpu / 1e9,
      gpu_fits: gpuFits,
    }, null, 2));
    return;
  }

  console.log("autoresearch gpu-fit");
  console.log(`params: ${fmtParams(P)} | dtype: ${dtype} | optimizer: ${optimizer}${gradCheckpoint ? " | grad-ckpt" : ""}`);
  if (Number.isFinite(layers) && Number.isFinite(dModel)) {
    console.log(`arch: ${layers} layers × ${dModel} d_model × ${Number.isFinite(dFf) ? dFf : 4 * dModel} d_ff | vocab=${vocab}`);
  }
  console.log(`shape: batch=${batch} seq=${seq} | TP=${tp} DP=${dp} ZeRO=${zeroStage}`);
  console.log("---");
  console.log("| component   | per-GPU bytes | note |");
  console.log("| ---         | ---           | ---  |");
  for (const b of breakdown) {
    console.log(`| ${b.component.padEnd(11)} | ${fmtBytes(b.bytes).padStart(13)} | ${b.note} |`);
  }
  console.log(`| total       | ${fmtBytes(totalPerGpu).padStart(13)} | per-GPU; reserve ~2 GB for CUDA |`);
  console.log("---");
  console.log("GPU fit verdict (assumes ~2 GB CUDA reserve):");
  console.log("| GPU          | VRAM | solo | DP=2 | DP=4 | DP=8 |");
  console.log("| ---          | ---  | ---  | ---  | ---  | ---  |");
  for (const g of gpuFits) {
    const ok = (b) => b ? "✓" : "✗";
    console.log(`| ${g.name.padEnd(12)} | ${String(g.vram_gb).padStart(3)}G | ${ok(g.fits_solo).padStart(4)} | ${ok(g.fits_dp2).padStart(4)} | ${ok(g.fits_dp4).padStart(4)} | ${ok(g.fits_dp8).padStart(4)} |`);
  }
  console.log("---");
  if (totalPerGpu / 1e9 > 80 && tp === 1 && zeroStage < 3) {
    console.log("Heads up: total > 80 GB on a single GPU. Try one of:");
    console.log("  --grad-checkpoint            (cuts activations ~sqrt(layers)x)");
    console.log("  --optimizer adam8bit         (cuts optimizer 4x)");
    console.log("  --zero 3 --dp 8              (shards weights+grads+opt across DP=8)");
    console.log("  --tp 4                       (tensor-parallel split across 4 GPUs)");
  }
  if (actBytes === null) {
    console.log("Tip: pass --layers and --d-model to include activation memory; the bytes shown exclude it.");
  }
}
