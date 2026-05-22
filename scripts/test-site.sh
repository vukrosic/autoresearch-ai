#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_file="$repo_root/docs/site/index.html"

if [ ! -f "$site_file" ]; then
  echo "site file missing: $site_file" >&2
  exit 1
fi

site="$(cat "$site_file")"

printf '%s' "$site" | grep -q 'AutoResearch-AI - Autonomous AI Research, in one prompt'
printf '%s' "$site" | grep -q 'npm install -g autoresearch-ai'
printf '%s' "$site" | grep -q 'Automated AI research.'
printf '%s' "$site" | grep -q 'Humans scope. Agents run.'
printf '%s' "$site" | grep -q 'a pile of agents handle'
printf '%s' "$site" | grep -q 'autoresearch dashboard'
printf '%s' "$site" | grep -q 'Local only. No auth. No cloud.'
printf '%s' "$site" | grep -q 'Placeholder'

node - "$repo_root" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const expected = String(pkg.scripts.test || "")
  .split(/\s*&&\s*/)
  .map((part) => part.match(/^npm run ([A-Za-z0-9:_-]+)$/)?.[1])
  .filter(Boolean)
  .map((name) => `- \`${name}\``)
  .join("\n");

if (!expected) {
  console.error("docs drift: package.json scripts.test did not contain any `npm run ...` entries");
  process.exit(1);
}

const docs = [
  "README.md",
  "docs/getting-started.md",
];

let failed = false;
for (const rel of docs) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/<!-- AUTO-TEST-SUITE:START -->\n([\s\S]*?)\n<!-- AUTO-TEST-SUITE:END -->/);
  if (!match) {
    console.error(`docs drift: ${rel} is missing AUTO-TEST-SUITE markers`);
    failed = true;
    continue;
  }
  const actual = match[1].trim();
  if (actual !== expected) {
    console.error(`docs drift: ${rel} AUTO-TEST-SUITE does not match package.json scripts.test`);
    console.error("--- expected");
    console.error(expected);
    console.error("--- actual");
    console.error(actual);
    failed = true;
  }
  if (!text.includes("npm run test:release")) {
    console.error(`docs drift: ${rel} must mention npm run test:release for packed release checks`);
    failed = true;
  }
}

if (failed) process.exit(1);
NODE

echo "autoresearch test:site passed"
