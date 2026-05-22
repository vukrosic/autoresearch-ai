// `autoresearch eval-diff` — diff two predictions.jsonl files (per-example flips).
//
// LLM/classifier researchers spend most of their time *not* on the aggregate
// number — they're trying to understand *which* examples got worse. The
// aggregate accuracy can go up by 1% while 10% of examples flipped, with
// 5.5% going your way and 4.5% going the wrong way. That's a feature
// regression in disguise.
//
// This command answers: "Which examples did run B get right that A got wrong,
// and vice versa? Net delta? Per-class flip counts?"
//
// Input schema. Each line in --a / --b is one JSON object with at least:
//   { "id": ...,
//     ("correct": true/false   OR   "score": 0..1   OR   "prediction" + "target") }
// We try, in order: explicit boolean (--field, default "correct"); a 0/1 score
// thresholded at 0.5; equality of prediction == target.
//
// "id" is required for matching across files. If absent, we fall back to row
// position (a[i] vs b[i]) and emit a loud warning.

import fs from "node:fs";
import path from "node:path";

function readJsonl(p) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try { return JSON.parse(line); }
      catch { console.error(`Skipping malformed JSON at ${p}:${i + 1}`); return null; }
    })
    .filter(Boolean);
}

function correctness(row, field) {
  if (!row) return null;
  if (field in row) {
    const v = row[field];
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v >= 0.5;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["true", "1", "yes", "pass", "correct"].includes(s)) return true;
      if (["false", "0", "no", "fail", "incorrect"].includes(s)) return false;
    }
  }
  if ("prediction" in row && "target" in row) {
    return String(row.prediction).trim() === String(row.target).trim();
  }
  return null;
}

function targetOf(row) {
  if (row && "target" in row) return String(row.target);
  if (row && "label" in row) return String(row.label);
  if (row && "class" in row) return String(row.class);
  return null;
}

export async function cmdEvalDiff(ctx) {
  const { option } = ctx;
  const aPath = option("--a", null);
  const bPath = option("--b", null);
  const field = String(option("--field", "correct"));
  const idKey = String(option("--id-key", "id"));
  const maxShow = Math.max(0, parseInt(String(option("--max-show", "10")), 10) || 10);
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (!aPath || !bPath) {
    console.error("Usage: autoresearch eval-diff --a runA/predictions.jsonl --b runB/predictions.jsonl [--field correct] [--id-key id] [--max-show 10] [--format text|json]");
    console.error("");
    console.error("Each line should be JSON with an id and one of:");
    console.error("  {\"id\":\"q1\", \"correct\": true}");
    console.error("  {\"id\":\"q1\", \"score\": 0.87}");
    console.error("  {\"id\":\"q1\", \"prediction\":\"B\", \"target\":\"B\"}");
    process.exitCode = 1;
    return;
  }

  const A = readJsonl(path.resolve(aPath));
  const B = readJsonl(path.resolve(bPath));

  // Match by id if both sides have it; otherwise positional.
  const aHasId = A.length > 0 && idKey in A[0];
  const bHasId = B.length > 0 && idKey in B[0];
  let pairs = [];
  let matchMode = "id";
  if (aHasId && bHasId) {
    const bIndex = new Map(B.map((r) => [String(r[idKey]), r]));
    for (const a of A) {
      const b = bIndex.get(String(a[idKey]));
      if (b) pairs.push({ id: String(a[idKey]), a, b });
    }
  } else {
    matchMode = "position";
    console.error(`WARN: missing "${idKey}" on one or both sides — matching by row position. Add ids to avoid silent mis-matches.`);
    const n = Math.min(A.length, B.length);
    for (let i = 0; i < n; i++) pairs.push({ id: String(i), a: A[i], b: B[i] });
  }

  let bothCorrect = 0, bothWrong = 0, aOnly = 0, bOnly = 0, unknown = 0;
  const flips = []; // { id, a_correct, b_correct, target, a_pred, b_pred }
  const perTarget = new Map(); // class → {a_better, b_better}

  for (const { id, a, b } of pairs) {
    const ac = correctness(a, field);
    const bc = correctness(b, field);
    if (ac === null || bc === null) { unknown++; continue; }
    if (ac && bc) bothCorrect++;
    else if (!ac && !bc) bothWrong++;
    else if (ac && !bc) {
      aOnly++;
      flips.push({ id, a_correct: true, b_correct: false, target: targetOf(a) ?? targetOf(b), a_pred: a.prediction ?? null, b_pred: b.prediction ?? null });
    }
    else if (!ac && bc) {
      bOnly++;
      flips.push({ id, a_correct: false, b_correct: true, target: targetOf(a) ?? targetOf(b), a_pred: a.prediction ?? null, b_pred: b.prediction ?? null });
    }
    const t = targetOf(a) ?? targetOf(b);
    if (t !== null) {
      if (!perTarget.has(t)) perTarget.set(t, { a_better: 0, b_better: 0 });
      const cell = perTarget.get(t);
      if (ac && !bc) cell.a_better++;
      if (!ac && bc) cell.b_better++;
    }
  }

  const n = pairs.length - unknown;
  const accA = n > 0 ? (bothCorrect + aOnly) / n : null;
  const accB = n > 0 ? (bothCorrect + bOnly) / n : null;
  const netDelta = accB !== null && accA !== null ? accB - accA : null;
  const totalFlipped = aOnly + bOnly;

  if (formatJson) {
    console.log(JSON.stringify({
      a: aPath, b: bPath,
      match_mode: matchMode,
      n_pairs: pairs.length,
      n_scorable: n,
      n_unknown: unknown,
      acc_a: accA, acc_b: accB,
      net_delta: netDelta,
      both_correct: bothCorrect,
      both_wrong: bothWrong,
      a_only_correct: aOnly,
      b_only_correct: bOnly,
      total_flipped: totalFlipped,
      churn_rate: n > 0 ? totalFlipped / n : null,
      per_class: Object.fromEntries(perTarget),
      regressions_b_lost: flips.filter((f) => f.a_correct && !f.b_correct).slice(0, maxShow),
      gains_b_won: flips.filter((f) => !f.a_correct && f.b_correct).slice(0, maxShow),
    }, null, 2));
    return;
  }

  const pct = (x) => x === null ? "—" : (100 * x).toFixed(2) + "%";

  console.log("autoresearch eval-diff");
  console.log(`a: ${aPath}`);
  console.log(`b: ${bPath}`);
  console.log(`match: ${matchMode}  pairs=${pairs.length}  scorable=${n}${unknown ? `  (unknown=${unknown})` : ""}`);
  console.log("---");
  console.log(`acc A:        ${pct(accA)}   acc B:        ${pct(accB)}   Δ: ${netDelta === null ? "—" : (netDelta >= 0 ? "+" : "") + (100 * netDelta).toFixed(2) + "%"}`);
  console.log(`both correct: ${bothCorrect}   both wrong:  ${bothWrong}`);
  console.log(`A only:       ${aOnly} (regressions in B)   B only:       ${bOnly} (gains in B)`);
  console.log(`total flipped:${totalFlipped}  churn rate:   ${n > 0 ? (100 * totalFlipped / n).toFixed(2) + "%" : "—"}`);
  console.log("---");

  if (perTarget.size > 0 && perTarget.size <= 30) {
    console.log("Per-class flips:");
    console.log("| class | A-better | B-better |");
    console.log("| ---   | ---      | ---      |");
    const sorted = [...perTarget.entries()].sort((x, y) => (y[1].a_better + y[1].b_better) - (x[1].a_better + x[1].b_better));
    for (const [cls, cell] of sorted) {
      console.log(`| ${String(cls).slice(0, 20).padEnd(20)} | ${String(cell.a_better).padStart(8)} | ${String(cell.b_better).padStart(8)} |`);
    }
    console.log("---");
  }

  if (maxShow > 0 && aOnly > 0) {
    console.log(`Top ${Math.min(maxShow, aOnly)} regressions (A was right, B is wrong):`);
    flips.filter((f) => f.a_correct && !f.b_correct).slice(0, maxShow).forEach((f) => {
      console.log(`  ${f.id}  target=${f.target ?? "—"}  A→${f.a_pred ?? "?"}  B→${f.b_pred ?? "?"}`);
    });
    console.log("");
  }
  if (maxShow > 0 && bOnly > 0) {
    console.log(`Top ${Math.min(maxShow, bOnly)} gains (B fixed what A got wrong):`);
    flips.filter((f) => !f.a_correct && f.b_correct).slice(0, maxShow).forEach((f) => {
      console.log(`  ${f.id}  target=${f.target ?? "—"}  A→${f.a_pred ?? "?"}  B→${f.b_pred ?? "?"}`);
    });
  }

  if (totalFlipped > 0 && netDelta !== null && Math.abs(netDelta) < 0.01 && totalFlipped / n > 0.05) {
    console.log("---");
    console.log("Heads up: churn rate > 5% with near-zero net delta. The metric looks the same but the model is behaving differently — investigate before promoting.");
  }
}
