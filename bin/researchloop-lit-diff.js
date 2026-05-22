// `autoresearch lit-diff <paper-a> <paper-b>` — compare two paper notes.
//
// Each paper note (under `.researchloop/scratchpad/papers/<id>.md`) follows
// the [[autoresearch-paper-read]] schema with sections `claim`, `mechanism`,
// `limits`, `how to port this`, `baseline relevance`. This command renders a
// side-by-side or unified diff of the matching sections so a reader can see
// "where do these two methods actually differ?" without flipping windows.
//
// Useful when proposing a hypothesis that combines two existing methods — or
// when the agent's `propose --novel` flow needs to confirm "this isn't just
// paper A with paper B's lr schedule."

import fs from "node:fs";
import path from "node:path";

const SECTIONS = ["claim", "mechanism", "limits", "how to port this", "baseline relevance"];

function paperPath(cwd, id) {
  return path.join(cwd, ".researchloop", "scratchpad", "papers", `${id}.md`);
}

function loadPaper(cwd, id) {
  const p = paperPath(cwd, id);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
}

// Extracts a section's body. Matches headings case-insensitively (## CLAIM,
// ## Claim, ### claim, etc.). Stops at the next `##`-level heading.
function sectionBody(text, name) {
  if (!text) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^#{2,6}\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#{2,6}\\s+\\S|\\Z)`, "im");
  const m = text.match(re);
  if (!m) return null;
  return m[1].trim();
}

function wrap(text, width = 72) {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      if (line) out.push(line);
      line = w;
    } else {
      line = line ? line + " " + w : w;
    }
  }
  if (line) out.push(line);
  return out;
}

function sideBySide(left, right, width = 60) {
  const l = wrap(left || "(empty)", width);
  const r = wrap(right || "(empty)", width);
  const n = Math.max(l.length, r.length);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const li = (l[i] || "").padEnd(width);
    const ri = r[i] || "";
    rows.push(`${li} │ ${ri}`);
  }
  return rows;
}

// Naive token overlap (lowercased words) as a similarity proxy.
function tokenJaccard(a, b) {
  const toks = (s) => new Set(((s || "").toLowerCase().match(/[a-z][a-z0-9_-]+/g) || []));
  const A = toks(a); const B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

export async function cmdLitDiff(ctx) {
  const { option, hasFlag, targetDir, args } = ctx;
  const cwd = targetDir();
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  const idx = args.findIndex((a) => a === "lit-diff" || a === "litdiff");
  let a = String(option("--a", "")).trim();
  let b = String(option("--b", "")).trim();
  if (!a && idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("-")) a = String(args[idx + 1]).trim();
  if (!b && idx !== -1 && args[idx + 2] && !args[idx + 2].startsWith("-")) b = String(args[idx + 2]).trim();

  if (!a || !b) {
    console.error("Usage: autoresearch lit-diff <paper-a-id> <paper-b-id> [--unified] [--format text|json] [--dir PATH]");
    process.exitCode = 1;
    return;
  }

  const textA = loadPaper(cwd, a);
  const textB = loadPaper(cwd, b);
  if (!textA) { console.error(`Paper note not found: ${a} (expected ${paperPath(cwd, a)})`); process.exitCode = 1; return; }
  if (!textB) { console.error(`Paper note not found: ${b} (expected ${paperPath(cwd, b)})`); process.exitCode = 1; return; }

  const result = {
    a,
    b,
    sections: SECTIONS.map((name) => {
      const ba = sectionBody(textA, name);
      const bb = sectionBody(textB, name);
      return {
        section: name,
        a: ba,
        b: bb,
        similarity: tokenJaccard(ba, bb),
        only_in_a: ba && !bb,
        only_in_b: !ba && bb,
        both_missing: !ba && !bb,
      };
    }),
  };

  if (formatJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`autoresearch lit-diff`);
  console.log(`A: ${a}`);
  console.log(`B: ${b}`);
  console.log("");
  if (hasFlag("--unified")) {
    for (const s of result.sections) {
      console.log(`## ${s.section}  (similarity=${s.similarity.toFixed(3)})`);
      if (s.both_missing) { console.log("(missing in both)\n"); continue; }
      if (s.a) { console.log(`--- A`); for (const l of (s.a.split("\n"))) console.log(`- ${l}`); }
      if (s.b) { console.log(`+++ B`); for (const l of (s.b.split("\n"))) console.log(`+ ${l}`); }
      console.log("");
    }
    return;
  }
  // Side-by-side
  const w = 60;
  for (const s of result.sections) {
    console.log(`## ${s.section}  (similarity=${s.similarity.toFixed(3)})`);
    console.log(`${("A: " + a).padEnd(w)} │ ${"B: " + b}`);
    console.log("─".repeat(w) + "─┼─" + "─".repeat(w));
    if (s.both_missing) {
      console.log("(missing in both)");
    } else {
      for (const row of sideBySide(s.a, s.b, w)) {
        console.log(row);
      }
    }
    console.log("");
  }
  console.log("Lowest-similarity sections are where the methods actually differ.");
}
