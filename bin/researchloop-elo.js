// `autoresearch elo` — Bradley-Terry / Elo ratings from pairwise wins.
//
// Pairwise model evals (LMSYS arena, MT-Bench, custom A/B judges) produce a
// pile of `{model_a, model_b, winner}` rows. This command fits two ratings:
//
//   1. Elo (online, K=4, 1000 base). Sensitive to order; same as the LMSYS
//      arena leaderboard up to K-factor choice.
//   2. Bradley-Terry MLE (closed-form via iterative fitting). Order-invariant
//      and equivalent to the asymptotic Elo. This is the *right* aggregate
//      when you have all the matches up front.
//
// Reports per-model rating, win rate, total matches, and bootstrap 95% CI on
// the BT rating (default 200 resamples, seeded). Also prints the pairwise
// win-count matrix when the model set is small (≤ 12).
//
// Input formats (one accepted per row):
//   {"model_a":"A","model_b":"B","winner":"A"}
//   {"model_a":"A","model_b":"B","winner":"B"}
//   {"model_a":"A","model_b":"B","winner":"tie"}     (tie → 0.5 each)
//   {"a":"A","b":"B","winner":"A"}                   (short field names ok)
//   {"model_a":"A","model_b":"B","a_wins":3,"b_wins":1,"ties":0}  (counts)

import fs from "node:fs";
import path from "node:path";
import { percentile } from "./researchloop-core.js";

function readJsonl(p) {
  if (!fs.existsSync(p)) {
    console.error(`File not found: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function normalize(rows) {
  // Expand `a_wins`/`b_wins`/`ties` rows into individual matches.
  const out = [];
  for (const r of rows) {
    const a = r.model_a ?? r.a;
    const b = r.model_b ?? r.b;
    if (!a || !b || String(a) === String(b)) continue;
    if (typeof r.a_wins === "number" || typeof r.b_wins === "number" || typeof r.ties === "number") {
      for (let i = 0; i < (r.a_wins || 0); i++) out.push({ a, b, w: "a" });
      for (let i = 0; i < (r.b_wins || 0); i++) out.push({ a, b, w: "b" });
      for (let i = 0; i < (r.ties || 0); i++) out.push({ a, b, w: "t" });
      continue;
    }
    const winnerRaw = String(r.winner ?? r.win ?? "").trim().toLowerCase();
    let w = null;
    if (winnerRaw === String(a).trim().toLowerCase() || winnerRaw === "a" || winnerRaw === "model_a") w = "a";
    else if (winnerRaw === String(b).trim().toLowerCase() || winnerRaw === "b" || winnerRaw === "model_b") w = "b";
    else if (winnerRaw === "tie" || winnerRaw === "draw" || winnerRaw === "both") w = "t";
    if (w === null) continue;
    out.push({ a, b, w });
  }
  return out;
}

function elo(matches, k = 4, base = 1000) {
  const rating = new Map();
  for (const m of matches) {
    if (!rating.has(m.a)) rating.set(m.a, base);
    if (!rating.has(m.b)) rating.set(m.b, base);
    const ra = rating.get(m.a), rb = rating.get(m.b);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const eb = 1 - ea;
    const sa = m.w === "a" ? 1 : m.w === "b" ? 0 : 0.5;
    const sb = 1 - sa;
    rating.set(m.a, ra + k * (sa - ea));
    rating.set(m.b, rb + k * (sb - eb));
  }
  return rating;
}

function bradleyTerry(matches, iterations = 200, tol = 1e-6, prior = 0.5) {
  // MM algorithm (Hunter 2004 "MM algorithms for generalized Bradley-Terry"),
  // with a Laplace-style prior of `prior` fictional 50/50 matches between
  // every pair of models that have actually faced each other. Without this,
  // a model with zero wins forces its strength to 0 and the resulting log
  // rating is -infinity. The prior keeps every estimate finite while
  // converging to the MLE as data grows.
  const models = Array.from(new Set(matches.flatMap((m) => [m.a, m.b])));
  const idx = new Map(models.map((m, i) => [m, i]));
  const wins = new Array(models.length).fill(0);
  const playsAgainst = models.map(() => new Map()); // idx → games played
  for (const m of matches) {
    const ai = idx.get(m.a), bi = idx.get(m.b);
    playsAgainst[ai].set(bi, (playsAgainst[ai].get(bi) || 0) + 1);
    playsAgainst[bi].set(ai, (playsAgainst[bi].get(ai) || 0) + 1);
    if (m.w === "a") wins[ai] += 1;
    else if (m.w === "b") wins[bi] += 1;
    else { wins[ai] += 0.5; wins[bi] += 0.5; }
  }
  // Apply prior: every pair that has met gets `prior` extra fictional games
  // (split 50/50). This regularizes toward the population mean.
  if (prior > 0) {
    for (let i = 0; i < models.length; i++) {
      for (const [j] of playsAgainst[i]) {
        playsAgainst[i].set(j, playsAgainst[i].get(j) + prior);
        wins[i] += prior / 2;
      }
    }
  }
  let p = new Array(models.length).fill(1);
  for (let it = 0; it < iterations; it++) {
    const pNew = new Array(models.length).fill(0);
    for (let i = 0; i < models.length; i++) {
      let denom = 0;
      for (const [j, n] of playsAgainst[i]) {
        denom += n / (p[i] + p[j]);
      }
      pNew[i] = denom > 0 ? wins[i] / denom : p[i];
    }
    // Normalize.
    const sum = pNew.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pNew.length; i++) pNew[i] = pNew[i] / sum * models.length;
    const delta = pNew.reduce((a, v, i) => a + Math.abs(v - p[i]), 0);
    p = pNew;
    if (delta < tol) break;
  }
  // Convert strengths to Elo-like ratings centered at 1000:
  const ratings = new Map();
  const logs = p.map((v) => Math.log(Math.max(v, 1e-12)) * 400 / Math.LN10);
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  models.forEach((m, i) => ratings.set(m, 1000 + (logs[i] - mean)));
  return ratings;
}

function bootstrapCi(matches, statFn, models, n = 200, seed = 0xBEEF) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const samples = models.map(() => []);
  const idx = new Map(models.map((m, i) => [m, i]));
  for (let b = 0; b < n; b++) {
    const sample = new Array(matches.length);
    for (let i = 0; i < matches.length; i++) sample[i] = matches[Math.floor(rng() * matches.length)];
    const r = statFn(sample);
    for (const m of models) {
      const v = r.get(m);
      if (Number.isFinite(v)) samples[idx.get(m)].push(v);
    }
  }
  return models.map((m, i) => ({
    model: m,
    ci_lo: samples[i].length > 0 ? percentile(samples[i].sort((a, b) => a - b), 0.025) : null,
    ci_hi: samples[i].length > 0 ? percentile(samples[i].sort((a, b) => a - b), 0.975) : null,
  }));
}

function winMatrix(matches, models) {
  const n = models.length;
  const idx = new Map(models.map((m, i) => [m, i]));
  const wins = Array.from({ length: n }, () => new Array(n).fill(0));
  const games = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const m of matches) {
    const ai = idx.get(m.a), bi = idx.get(m.b);
    games[ai][bi]++; games[bi][ai]++;
    if (m.w === "a") wins[ai][bi]++;
    else if (m.w === "b") wins[bi][ai]++;
    else { wins[ai][bi] += 0.5; wins[bi][ai] += 0.5; }
  }
  return { wins, games };
}

export async function cmdElo(ctx) {
  const { option } = ctx;
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";
  const file = option("--file", null);
  const k = parseFloat(String(option("--k", "4"))) || 4;
  const bootstrapN = Math.max(0, parseInt(String(option("--bootstrap", "200")), 10) || 0);

  if (!file) {
    console.error("Usage: autoresearch elo --file wins.jsonl [--k 4] [--bootstrap 200] [--format text|json]");
    console.error("");
    console.error("Each row should be JSON:");
    console.error('  {"model_a":"gpt-4","model_b":"claude-opus","winner":"gpt-4"}');
    console.error('  {"model_a":"A","model_b":"B","a_wins":12,"b_wins":7,"ties":1}');
    process.exitCode = 1;
    return;
  }

  const raw = readJsonl(path.resolve(file));
  const matches = normalize(raw);
  if (matches.length < 2) {
    console.error(`Need at least 2 matches; got ${matches.length}.`);
    process.exitCode = 1;
    return;
  }

  const models = Array.from(new Set(matches.flatMap((m) => [m.a, m.b]))).sort();
  const eloRatings = elo(matches, k, 1000);
  const btRatings = bradleyTerry(matches);
  const ci = bootstrapN > 0 ? bootstrapCi(matches, bradleyTerry, models, bootstrapN) : null;
  const ciMap = new Map((ci || []).map((r) => [r.model, r]));

  const counts = new Map(models.map((m) => [m, { games: 0, wins: 0, losses: 0, ties: 0 }]));
  for (const m of matches) {
    counts.get(m.a).games++; counts.get(m.b).games++;
    if (m.w === "a") { counts.get(m.a).wins++; counts.get(m.b).losses++; }
    else if (m.w === "b") { counts.get(m.b).wins++; counts.get(m.a).losses++; }
    else { counts.get(m.a).ties++; counts.get(m.b).ties++; }
  }

  const rows = models.map((m) => {
    const c = counts.get(m);
    const wr = c.games > 0 ? (c.wins + 0.5 * c.ties) / c.games : null;
    const ciEntry = ciMap.get(m);
    return {
      model: m,
      games: c.games, wins: c.wins, losses: c.losses, ties: c.ties,
      win_rate: wr,
      elo: eloRatings.get(m),
      bt_rating: btRatings.get(m),
      bt_ci_95: ciEntry ? [ciEntry.ci_lo, ciEntry.ci_hi] : null,
    };
  }).sort((a, b) => (b.bt_rating || 0) - (a.bt_rating || 0));

  if (formatJson) {
    console.log(JSON.stringify({ n_matches: matches.length, n_models: models.length, k_factor: k, bootstrap_n: bootstrapN, ratings: rows }, null, 2));
    return;
  }

  console.log("autoresearch elo");
  console.log(`matches: ${matches.length}   models: ${models.length}   k-factor: ${k}${bootstrapN > 0 ? `   bootstrap: ${bootstrapN}` : ""}`);
  console.log("---");
  console.log("| rank | model            | games | wins | losses | ties | win rate | Elo  | BT rating | BT CI95 |");
  console.log("| ---  | ---              | ---   | ---  | ---    | ---  | ---      | ---  | ---       | ---     |");
  rows.forEach((r, i) => {
    const wr = r.win_rate === null ? "—" : (100 * r.win_rate).toFixed(1) + "%";
    const ci = r.bt_ci_95 && r.bt_ci_95[0] !== null ? `[${r.bt_ci_95[0].toFixed(1)}, ${r.bt_ci_95[1].toFixed(1)}]` : "—";
    console.log(`| ${String(i + 1).padStart(4)} | ${String(r.model).slice(0, 16).padEnd(16)} | ${String(r.games).padStart(5)} | ${String(r.wins).padStart(4)} | ${String(r.losses).padStart(6)} | ${String(r.ties).padStart(4)} | ${wr.padStart(8)} | ${r.elo.toFixed(0).padStart(4)} | ${r.bt_rating.toFixed(1).padStart(9)} | ${ci} |`);
  });
  if (models.length <= 12) {
    const { wins, games } = winMatrix(matches, models);
    console.log("---");
    console.log("Pairwise win rate (row beats col):");
    const hdr = "         " + models.map((m) => String(m).slice(0, 8).padStart(8)).join(" ");
    console.log(hdr);
    for (let i = 0; i < models.length; i++) {
      const cells = [];
      for (let j = 0; j < models.length; j++) {
        if (i === j) cells.push("   —    ");
        else cells.push(games[i][j] === 0 ? "   ·    " : ((wins[i][j] / games[i][j]) * 100).toFixed(0).padStart(8));
      }
      console.log(String(models[i]).slice(0, 8).padEnd(8) + " " + cells.join(" "));
    }
  }
}
