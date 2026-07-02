// `autoresearch hardware` — what hardware has this project actually run on?
//
// Walks the ledger's `env` blocks (G14) and aggregates the hardware seen:
//   - GPU model + count distribution
//   - CUDA versions
//   - Python / Torch versions
//   - hostnames
//
// Useful for:
//   1. Spotting that "deterministic" results were collected on three
//      different GPU SKUs (a non-obvious confounder)
//   2. Confirming a sweep ran on the partition the user expected
//   3. Generating a Hardware section for a model card or paper

import { readLedgerRows, fmt } from "./researchloop-core.js";

function bucket(rows, accessor) {
  const m = new Map();
  for (const r of rows) {
    const env = r.env || {};
    const value = accessor(env);
    if (value === null || value === undefined || value === "") continue;
    const key = Array.isArray(value) ? value.join(", ") : String(value);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

export async function cmdHardware(ctx) {
  const { option, targetDir } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const rows = readLedgerRows(cwd).filter((r) => r && r.env);
  if (rows.length === 0) {
    if (formatJson) {
      console.log(JSON.stringify({ n_with_env: 0, reason: "no rows with env capture (G14)" }, null, 2));
    } else {
      console.log("No rows with env capture. Older runs may not have G14 env data.");
    }
    return;
  }

  const gpuModels = bucket(rows, (env) => env.gpu);
  const cudaVersions = bucket(rows, (env) => env.cuda);
  const pythonVersions = bucket(rows, (env) => env.python);
  const torchVersions = bucket(rows, (env) => env.torch);
  const hosts = bucket(rows, (env) => env.hostname);
  const os = bucket(rows, (env) => env.os);

  if (formatJson) {
    console.log(JSON.stringify({
      n_with_env: rows.length,
      gpu_models: gpuModels,
      cuda_versions: cudaVersions,
      python_versions: pythonVersions,
      torch_versions: torchVersions,
      hostnames: hosts,
      os: os,
      hardware_diversity_warning: gpuModels.length > 1,
    }, null, 2));
    return;
  }

  console.log("autoresearch hardware");
  console.log(`n_rows_with_env: ${rows.length}`);
  console.log("");

  function printSection(title, items) {
    if (items.length === 0) return;
    console.log(`## ${title}`);
    for (const it of items) {
      const pct = (it.count / rows.length * 100).toFixed(1);
      console.log(`  ${String(it.count).padStart(4)} (${pct.padStart(5)}%)  ${it.value}`);
    }
    console.log("");
  }

  printSection("GPU models", gpuModels);
  printSection("CUDA versions", cudaVersions);
  printSection("Python versions", pythonVersions);
  printSection("Torch versions", torchVersions);
  printSection("Hostnames", hosts);
  printSection("OS", os);

  if (gpuModels.length > 1) {
    console.log("warning: more than one GPU model in the ledger — bitwise reproducibility");
    console.log("         across runs is unlikely. Pair `autoresearch determinism` against");
    console.log("         each GPU you care about before publishing claims.");
  }
  if (cudaVersions.length > 1) {
    console.log("warning: more than one CUDA version — cudnn ops can pick different");
    console.log("         kernels, which can move metrics. Pin a version with");
    console.log("         a Dockerfile or conda env if reproducibility matters.");
  }
}
