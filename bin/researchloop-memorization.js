// `autoresearch memorization` — detect verbatim training-data leakage in
// model outputs.
//
// This is a different problem from `autoresearch canary` (which checks for
// eval/train leakage in the dataset itself). This checks the *model's
// generated outputs* against a training corpus to find verbatim memorization
// — the Carlini et al. 2021 / 2023 family of attacks.
//
// Method: for each generated output, take rolling n-grams (default n=50
// characters, configurable) and check whether each appears verbatim
// anywhere in the training set. Reports per-output longest-verbatim-match
// length, the offending substring, and an overall memorization rate.
//
// Two scales of training-set support:
//   --train PATH                  small training file (loaded fully in RAM)
//   --train-globs PAT,PAT,...     multiple files (line-by-line streamed)
//
// For genuinely large corpora (TB-scale), this implementation will be slow.
// Real C4-scale memorization research uses suffix arrays or rolling hashes
// against bloom filters; we ship the honest small-corpus version here. The
// rolling-hash version is on the roadmap if anyone needs it.

import fs from "node:fs";
import path from "node:path";

function readLines(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").split("\n");
}

function buildShingleSet(corpus, n) {
  // O(L) build of all n-character shingles in the corpus. Memory is the
  // dominant cost — keep n high enough that the set isn't explosive.
  const shingles = new Set();
  for (const line of corpus) {
    if (line.length < n) continue;
    for (let i = 0; i <= line.length - n; i++) {
      shingles.add(line.substring(i, i + n));
    }
  }
  return shingles;
}

function loadTraining(trainPath, trainGlobs) {
  let lines = [];
  if (trainPath) {
    const got = readLines(path.resolve(trainPath));
    if (!got) { console.error(`train file not found: ${trainPath}`); process.exit(1); }
    lines = got;
  } else if (trainGlobs) {
    // Tiny glob expansion: comma-separated literal paths (no glob expansion).
    // Real glob expansion is left to the shell — we trust the user passed
    // already-expanded paths.
    for (const p of String(trainGlobs).split(",").map((s) => s.trim()).filter(Boolean)) {
      const got = readLines(path.resolve(p));
      if (got) lines = lines.concat(got);
    }
  }
  return lines;
}

function longestVerbatimMatch(text, corpusText) {
  // Bounded longest-common-substring via a simple doubling search over the
  // shingle set. For correctness when the corpus is small enough to live in
  // RAM, we just iterate match lengths and check substring inclusion.
  if (!text || !corpusText) return { length: 0, snippet: null };
  // Binary-search for the longest L such that some L-char substring of text
  // appears in corpusText. Use a probe heuristic: at each L, slide once
  // over text and check inclusion.
  let lo = 1;
  let hi = Math.min(text.length, 1000); // 1000-char cap keeps the test cheap
  let bestSnippet = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    let found = null;
    for (let i = 0; i + mid <= text.length; i++) {
      const probe = text.substring(i, i + mid);
      if (corpusText.indexOf(probe) !== -1) { found = probe; break; }
    }
    if (found) { bestSnippet = found; lo = mid + 1; }
    else hi = mid - 1;
  }
  return { length: bestSnippet ? bestSnippet.length : 0, snippet: bestSnippet };
}

function readOutputs(p) {
  const txt = fs.readFileSync(p, "utf8");
  // Accept both JSONL ({text|output|response|completion}) and plain newline
  // text. Heuristic: if the first line parses as JSON, treat the whole file
  // as JSONL.
  const firstLine = txt.split("\n", 1)[0] || "";
  let isJsonl = false;
  try { JSON.parse(firstLine); isJsonl = true; } catch { /* plain text */ }
  if (isJsonl) {
    return txt.split("\n").filter(Boolean).map((l, i) => {
      try {
        const obj = JSON.parse(l);
        const text = obj.text ?? obj.output ?? obj.response ?? obj.completion ?? obj.generation ?? "";
        return { id: obj.id ?? String(i), text: String(text) };
      } catch { return null; }
    }).filter(Boolean);
  }
  return txt.split("\n").filter(Boolean).map((line, i) => ({ id: String(i), text: line }));
}

export async function cmdMemorization(ctx) {
  const { option } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const outputsPath = option("--outputs", null);
  const trainPath = option("--train", null);
  const trainGlobs = option("--train-globs", null);
  const n = parseInt(String(option("--n", "50")), 10) || 50;
  const reportLen = parseInt(String(option("--report-threshold", String(n))), 10) || n;
  const maxShow = parseInt(String(option("--max-show", "10")), 10) || 10;

  if (typeof outputsPath !== "string" || (typeof trainPath !== "string" && typeof trainGlobs !== "string")) {
    console.error("Usage:");
    console.error("  autoresearch memorization --outputs gens.jsonl --train train.txt [--n 50] [--report-threshold N]");
    console.error("  autoresearch memorization --outputs gens.jsonl --train-globs file1.txt,file2.txt");
    console.error("");
    console.error("--outputs: JSONL with {text|output|response|completion} or one-output-per-line text");
    console.error("--n      : n-gram size in CHARACTERS for the shingle filter (default 50)");
    console.error("--report-threshold: only output rows with a verbatim match ≥ N chars (default = n)");
    process.exitCode = 1;
    return;
  }

  const outputs = readOutputs(path.resolve(outputsPath));
  const train = loadTraining(trainPath, trainGlobs);
  if (outputs.length === 0) { console.error("no outputs to check"); process.exitCode = 1; return; }
  if (train.length === 0) { console.error("no training lines loaded"); process.exitCode = 1; return; }

  const shingles = buildShingleSet(train, n);
  const corpusText = train.join("\n");

  const results = [];
  let hitCount = 0;
  for (const o of outputs) {
    // Cheap filter: does the output contain ANY n-shingle from the corpus?
    let hasHit = false;
    if (o.text.length >= n) {
      for (let i = 0; i + n <= o.text.length; i++) {
        if (shingles.has(o.text.substring(i, i + n))) { hasHit = true; break; }
      }
    }
    if (!hasHit) {
      results.push({ id: o.id, longest_match: 0, snippet: null });
      continue;
    }
    // We have at least one n-gram match — find the longest extension.
    const { length, snippet } = longestVerbatimMatch(o.text, corpusText);
    results.push({ id: o.id, longest_match: length, snippet });
    if (length >= reportLen) hitCount++;
  }

  const rate = hitCount / outputs.length;
  const reportable = results.filter((r) => r.longest_match >= reportLen).sort((a, b) => b.longest_match - a.longest_match);

  if (formatJson) {
    console.log(JSON.stringify({
      outputs: outputsPath, train: trainPath || trainGlobs,
      shingle_n: n, report_threshold: reportLen,
      n_outputs: outputs.length, n_train_lines: train.length, n_shingles: shingles.size,
      memorization_rate: rate,
      memorization_count: hitCount,
      details: reportable,
    }, null, 2));
    return;
  }

  console.log("autoresearch memorization");
  console.log(`outputs: ${outputsPath}   train: ${trainPath || trainGlobs}`);
  console.log(`shingle n=${n}   report-threshold=${reportLen}   n_outputs=${outputs.length}   n_shingles=${shingles.size}`);
  console.log("---");
  console.log(`outputs with verbatim match ≥ ${reportLen} chars: ${hitCount} / ${outputs.length}   (${(rate * 100).toFixed(2)}%)`);
  if (hitCount === 0) {
    console.log("No memorization detected at the configured threshold. Try lowering --n to catch shorter borrowed snippets, or --report-threshold to surface near-misses.");
    return;
  }
  console.log("---");
  console.log(`Top ${Math.min(maxShow, reportable.length)} verbatim matches:`);
  for (const r of reportable.slice(0, maxShow)) {
    const sn = r.snippet ? r.snippet.length > 80 ? r.snippet.slice(0, 77) + "…" : r.snippet : "—";
    console.log(`  ${String(r.id).slice(0, 24).padEnd(24)} ${String(r.longest_match).padStart(5)} chars   ${JSON.stringify(sn)}`);
  }
  console.log("---");
  if (rate > 0.05) {
    console.log("Heads up: > 5% of outputs contain verbatim training-data substrings. Likely culprits: too few epochs of generalization, dataset duplicates, decoded with low temperature on overfit checkpoints.");
  }
  console.log("Tip: also run `autoresearch canary --eval outputs.jsonl --train train.jsonl --substring` to check for eval-set leakage in the training corpus (different attack surface).");
}
