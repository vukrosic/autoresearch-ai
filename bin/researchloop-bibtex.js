// `autoresearch bibtex` — extract BibTeX entries from paper notes.
//
// Each note under .researchloop/scratchpad/papers/<id>.md may contain a
// fenced bibtex block:
//
//     ```bibtex
//     @article{vaswani2017attention, ...}
//     ```
//
// With `--all`, dump every block. With `--file report.md`, only emit entries
// for arxiv ids that appear in the report (substring match on the bibtex key
// or arxiv id), so the .bib file is exactly what the paper cites.

import fs from "node:fs";
import path from "node:path";

const PAPERS_DIR_REL = ".researchloop/scratchpad/papers";

function papersDir(cwd) {
  return path.join(cwd, PAPERS_DIR_REL);
}

function extractBibtexBlocks(text) {
  // Find ```bibtex ... ``` fences.
  const blocks = [];
  const re = /```\s*bibtex\s*\n([\s\S]*?)```/gim;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

function bibtexEntryKey(entry) {
  const m = entry.match(/^\s*@\w+\s*{\s*([^,\s]+)/);
  return m ? m[1] : null;
}

function loadAllEntries(cwd) {
  const dir = papersDir(cwd);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const id = f.replace(/\.md$/, "");
    const text = fs.readFileSync(path.join(dir, f), "utf8");
    for (const block of extractBibtexBlocks(text)) {
      out.push({
        paper_id: id,
        key: bibtexEntryKey(block),
        entry: block,
      });
    }
  }
  return out;
}

function dedupeByKey(entries) {
  const seen = new Map();
  for (const e of entries) {
    const k = e.key || `__paper_${e.paper_id}`;
    if (!seen.has(k)) seen.set(k, e);
  }
  return Array.from(seen.values());
}

export async function cmdBibtex(ctx) {
  const { option, hasFlag, targetDir } = ctx;
  const cwd = targetDir();
  const all = loadAllEntries(cwd);
  const filePath = option("--file", null);
  const outPath = option("--out", null);
  const formatJson = String(option("--format", "text")).toLowerCase() === "json";

  if (all.length === 0) {
    if (formatJson) {
      console.log(JSON.stringify({ n: 0, entries: [], reason: "no paper notes with bibtex blocks" }, null, 2));
    } else {
      console.log(`No bibtex blocks found in ${PAPERS_DIR_REL}/*.md.`);
      console.log("Add a ```bibtex ... ``` fence to a paper note to make it citable.");
    }
    return;
  }

  let kept = dedupeByKey(all);

  if (filePath && typeof filePath === "string") {
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exitCode = 1;
      return;
    }
    const docText = fs.readFileSync(filePath, "utf8");
    kept = kept.filter((e) => {
      if (e.key && docText.includes(e.key)) return true;
      if (e.paper_id && docText.includes(e.paper_id)) return true;
      // Also accept the bare arxiv id from the paper filename
      return false;
    });
  } else if (!hasFlag("--all")) {
    // No --file and no --all: still print all entries, but warn.
    if (!formatJson) {
      console.error("note: pass --file report.md to filter to cited entries, or --all to suppress this warning.");
    }
  }

  if (formatJson) {
    console.log(JSON.stringify({ n: kept.length, entries: kept }, null, 2));
    return;
  }

  const bib = kept.map((e) => e.entry).join("\n\n") + (kept.length ? "\n" : "");
  if (outPath && typeof outPath === "string") {
    fs.writeFileSync(outPath, bib);
    console.log(`wrote ${kept.length} entries -> ${outPath}`);
  } else {
    process.stdout.write(bib);
  }
}
