// `autoresearch kv-cache` — inference VRAM estimator (weights + KV cache).
//
// For *inference / serving* the dominant memory cost beyond weights is the
// KV cache, which grows with batch × context length. This is the calculation
// every vLLM / TGI / SGLang user wants:
//
//   KV bytes per token = 2 (K and V) × layers × n_kv_heads × head_dim × dtype
//
// With grouped-query attention (GQA), `n_kv_heads` is much smaller than
// `n_heads` — that's the whole point of GQA — so a Llama-3-70B's KV cache is
// 8× smaller than a multi-head 70B's would be. We surface this explicitly so
// users don't model GQA wrong.
//
// Outputs:
//   - bytes per token (one number you can scale by anything)
//   - max batch × context that fits in (vram_gb − weights − headroom)
//   - per-request VRAM for a target (--batch, --context)
//   - throughput sanity: how many concurrent requests fit at a given context

import { fmt } from "./researchloop-core.js";

const DTYPE_BYTES = {
  fp32: 4, float32: 4,
  fp16: 2, float16: 2, half: 2,
  bf16: 2, bfloat16: 2,
  fp8: 1, float8: 1,
  int8: 1, int4: 0.5,
};

const GPU_VRAM_GB = {
  "h200": 141, "h100": 80, "h100-pcie": 80,
  "a100-80": 80, "a100-40": 40, "a100": 80,
  "l40s": 48, "l40": 48, "rtx6000ada": 48,
  "rtx4090": 24, "rtx3090": 24, "a10g": 24,
  "v100-32": 32, "v100-16": 16, "t4": 16,
  "mi300x": 192, "mi250x": 64,
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

function fmtBytes(b) {
  if (!Number.isFinite(b)) return "—";
  const a = Math.abs(b);
  if (a >= 1e12) return (b / 1e12).toFixed(2) + " TB";
  if (a >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (a >= 1e6) return (b / 1e6).toFixed(2) + " MB";
  if (a >= 1e3) return (b / 1e3).toFixed(2) + " KB";
  return b.toFixed(0) + " B";
}

function fmtParams(p) {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1e9) return (p / 1e9).toFixed(2) + "B";
  if (p >= 1e6) return (p / 1e6).toFixed(2) + "M";
  return String(Math.round(p));
}

export async function cmdKvCache(ctx) {
  const { option } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const layers = parseSize(option("--layers", null));
  const nHeads = parseSize(option("--n-heads", null));
  const nKvHeads = parseSize(option("--n-kv-heads", null)) ?? nHeads; // MHA default
  const headDim = parseSize(option("--head-dim", null));
  const dModel = parseSize(option("--d-model", null));
  const params = parseSize(option("--params", null));
  const dtype = String(option("--kv-dtype", option("--dtype", "fp16"))).toLowerCase();
  const weightsDtype = String(option("--weights-dtype", "fp16")).toLowerCase();
  const context = parseSize(option("--context", null)) ?? 8192;
  const batch = parseSize(option("--batch", null)) ?? 1;
  const vramGb = (() => {
    const explicit = parseSize(option("--vram-gb", null));
    if (Number.isFinite(explicit)) return explicit;
    const gpuName = String(option("--gpu", "")).toLowerCase().trim();
    if (gpuName && GPU_VRAM_GB[gpuName]) return GPU_VRAM_GB[gpuName];
    for (const [k, v] of Object.entries(GPU_VRAM_GB)) if (gpuName.includes(k)) return v;
    return 80; // H100/A100-80 default
  })();
  const reserveGb = parseSize(option("--reserve-gb", null)) ?? 2;

  const dtypeBytes = DTYPE_BYTES[dtype];
  const weightBytes = DTYPE_BYTES[weightsDtype];
  if (!Number.isFinite(dtypeBytes) || !Number.isFinite(weightBytes)) {
    console.error(`Unknown dtype. KV: ${dtype}, weights: ${weightsDtype}. Valid: ${Object.keys(DTYPE_BYTES).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(layers) || !Number.isFinite(headDim) || !Number.isFinite(nKvHeads)) {
    console.error("Need --layers, --head-dim, and --n-kv-heads (or --n-heads). Examples:");
    console.error("  Llama-3-70B: --layers 80 --n-heads 64 --n-kv-heads 8 --head-dim 128 --params 70B --gpu H100");
    console.error("  Llama-3-8B:  --layers 32 --n-heads 32 --n-kv-heads 8 --head-dim 128 --params 8B --gpu A10G");
    console.error("  GPT-2 small: --layers 12 --n-heads 12 --n-kv-heads 12 --head-dim 64 --params 124M --gpu T4");
    process.exitCode = 1;
    return;
  }

  // KV cache bytes per single token (across all layers, K + V both stored).
  const bytesPerToken = 2 * layers * nKvHeads * headDim * dtypeBytes;
  const bytesPerRequest = bytesPerToken * context;
  const bytesAllRequests = bytesPerRequest * batch;

  // Weight bytes (rough).
  const weightBytesTotal = Number.isFinite(params) ? params * weightBytes : null;

  // Workspace + scratch for attention kernels. PagedAttention overhead etc.
  // Rule of thumb: ~5% of weights for vLLM-style serving on top of CUDA reserve.
  const workspaceBytes = weightBytesTotal !== null ? weightBytesTotal * 0.05 : 0;

  const totalUsed = (weightBytesTotal ?? 0) + bytesAllRequests + workspaceBytes;
  const vramBudgetBytes = (vramGb - reserveGb) * 1e9;
  const fits = totalUsed <= vramBudgetBytes;

  // Max concurrency at the given context.
  const remainingForKv = vramBudgetBytes - (weightBytesTotal ?? 0) - workspaceBytes;
  const maxBatchAtContext = remainingForKv > 0 ? Math.floor(remainingForKv / bytesPerRequest) : 0;
  // Max context at batch=1.
  const maxContextAtBatch1 = remainingForKv > 0 ? Math.floor(remainingForKv / bytesPerToken) : 0;
  // Max tokens × batch product.
  const maxTokenBatchProduct = remainingForKv > 0 ? Math.floor(remainingForKv / bytesPerToken) : 0;

  const gqaRatio = Number.isFinite(nHeads) && nKvHeads > 0 ? nHeads / nKvHeads : 1;

  if (formatJson) {
    console.log(JSON.stringify({
      arch: { layers, n_heads: nHeads, n_kv_heads: nKvHeads, head_dim: headDim, d_model: dModel, params, kv_dtype: dtype, weights_dtype: weightsDtype, gqa_ratio: gqaRatio },
      gpu_vram_gb: vramGb, reserve_gb: reserveGb,
      bytes_per_token: bytesPerToken,
      per_request: { context, bytes: bytesPerRequest },
      target: { batch, total_kv_bytes: bytesAllRequests },
      weights_bytes: weightBytesTotal,
      workspace_bytes: workspaceBytes,
      total_used_bytes: totalUsed,
      fits, vram_budget_bytes: vramBudgetBytes,
      max_batch_at_context: maxBatchAtContext,
      max_context_at_batch1: maxContextAtBatch1,
      max_token_batch_product: maxTokenBatchProduct,
    }, null, 2));
    return;
  }

  console.log("autoresearch kv-cache");
  console.log(`arch: ${layers}L × ${nKvHeads}kv-heads × ${headDim} head_dim${Number.isFinite(nHeads) && nHeads !== nKvHeads ? `   GQA: ${gqaRatio.toFixed(0)}:1 (n_heads=${nHeads})` : ""}`);
  console.log(`kv-dtype: ${dtype} (${dtypeBytes}B)   weights-dtype: ${weightsDtype} (${weightBytes}B)${Number.isFinite(params) ? `   params: ${fmtParams(params)}` : ""}`);
  console.log(`gpu: ${vramGb} GB VRAM, reserve ${reserveGb} GB for CUDA + workspace`);
  console.log("---");
  console.log(`KV bytes per token:           ${fmtBytes(bytesPerToken)}`);
  console.log(`KV bytes per request (×${context}): ${fmtBytes(bytesPerRequest)}`);
  console.log(`KV bytes at batch=${batch}:           ${fmtBytes(bytesAllRequests)}`);
  if (weightBytesTotal !== null) {
    console.log(`weights:                       ${fmtBytes(weightBytesTotal)}`);
    console.log(`workspace (~5% of weights):    ${fmtBytes(workspaceBytes)}`);
    console.log(`total used:                    ${fmtBytes(totalUsed)}   ${fits ? "✓ fits" : "✗ does NOT fit"} in ${fmtBytes(vramBudgetBytes)}`);
  } else {
    console.log("(pass --params to add weight memory and a fit verdict)");
  }
  console.log("---");
  console.log("Headroom at this GPU:");
  console.log(`  max batch @ context=${context}: ${maxBatchAtContext}`);
  console.log(`  max context @ batch=1:    ${maxContextAtBatch1.toLocaleString()} tokens`);
  console.log(`  max (batch × context):    ${maxTokenBatchProduct.toLocaleString()} tokens`);
  console.log("---");
  if (gqaRatio === 1 && Number.isFinite(nHeads) && nHeads > 8) {
    console.log(`Heads up: pure MHA detected (n_heads = n_kv_heads = ${nHeads}). Converting to GQA with --n-kv-heads ${Math.max(1, Math.floor(nHeads / 8))} would cut KV cache ~${Math.floor(nHeads / Math.max(1, Math.floor(nHeads / 8)))}×.`);
  }
  if (dtype === "fp16" || dtype === "bf16") {
    console.log("Tip: --kv-dtype fp8 (or int8) cuts KV memory 2× with small quality cost on most LLMs (see e.g. vLLM, TensorRT-LLM kv_cache_dtype).");
  }
  if (!fits && weightBytesTotal !== null) {
    console.log("Doesn't fit. Try a larger GPU, fewer concurrent requests, shorter context, --kv-dtype fp8, GQA, or weight quantization (--weights-dtype int8/int4).");
  }
}
