#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pack_dir="$(mktemp -d)"
prefix="$(mktemp -d)"
lab="$(mktemp -d)"
trap 'rm -rf "$pack_dir" "$prefix" "$lab"' EXIT

cd "$repo_root"
tarball_name="$(npm pack --pack-destination "$pack_dir" --json | node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(data[0].filename);')"
tarball="$pack_dir/$tarball_name"

if [ ! -f "$tarball" ]; then
  echo "tarball not produced: $tarball" >&2
  exit 1
fi

file_count="$(tar tzf "$tarball" | wc -l | tr -d ' ')"
if [ "$file_count" -lt 30 ]; then
  echo "tarball file count $file_count < 30" >&2
  tar tzf "$tarball" >&2
  exit 1
fi

if tar tzf "$tarball" | grep -q "researchloop-dev/"; then
  echo "researchloop-dev/ should not be in tarball" >&2
  tar tzf "$tarball" | grep researchloop-dev/ >&2
  exit 1
fi
if tar tzf "$tarball" | grep -qE "^package/scripts/"; then
  echo "scripts/ should not be in tarball" >&2
  tar tzf "$tarball" | grep -E "^package/scripts/" >&2
  exit 1
fi
if tar tzf "$tarball" | grep -qE "^package/docs/competitors/"; then
  echo "docs/competitors/ should not be in tarball" >&2
  exit 1
fi
if tar tzf "$tarball" | grep -qE "^package/docs/startup/"; then
  echo "docs/startup/ should not be in tarball" >&2
  exit 1
fi

npm install --prefix "$prefix" "$tarball" >/tmp/researchloop-packed-install.log 2>&1
bin="$prefix/node_modules/.bin/autoresearch"
legacy_bin="$prefix/node_modules/.bin/researchloop"
package_bin="$prefix/node_modules/.bin/autoresearch-ai"

if [ ! -x "$bin" ]; then
  echo "autoresearch binary not installed at $bin" >&2
  ls -la "$prefix/node_modules/.bin/" >&2 || true
  exit 1
fi
test -x "$legacy_bin"
test -x "$package_bin"

"$bin" --version >/tmp/researchloop-packed-version.log
local_version="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("'"$repo_root"'/package.json","utf8")).version)')"
grep -q "^$local_version$" /tmp/researchloop-packed-version.log

"$bin" --help >/tmp/researchloop-packed-help.log
grep -q "AutoResearch-AI" /tmp/researchloop-packed-help.log
grep -q "autoresearch init" /tmp/researchloop-packed-help.log
grep -q "researchloop    legacy alias" /tmp/researchloop-packed-help.log

"$bin" init --agent codex --dir "$lab" >/tmp/researchloop-packed-init.log
test -f "$lab/.researchloop/AGENTS.md"
test -f "$lab/.researchloop/baseline.md"
test -f "$lab/.researchloop/goal.md"
test -f "$lab/.researchloop/plan.md"
test -f "$lab/.researchloop/scratchpad/runs.jsonl"
test -f "$lab/AGENTS.md"
grep -q "do not run initialization, training" "$lab/.researchloop/AGENTS.md"
grep -q "avoid summarizing package internals" "$lab/.researchloop/AGENTS.md"
grep -q "student or researcher starting AI research" "$lab/.researchloop/AGENTS.md"
grep -q "templates/prompts/first-contact.md" "$lab/.researchloop/AGENTS.md"
grep -q "ask for approval before running any init" "$lab/.researchloop/AGENTS.md"

"$bin" goal --dir "$lab" "lower validation loss" --metric val_loss --direction lower >/tmp/researchloop-packed-goal.log
"$bin" prompt --dir "$lab" --agent codex >/tmp/researchloop-packed-prompt.log
grep -q "lower validation loss" /tmp/researchloop-packed-prompt.log
grep -q "# First Contact" /tmp/researchloop-packed-prompt.log
grep -q "Do not install Docker" /tmp/researchloop-packed-prompt.log
grep -q "Do not run \`autoresearch run\`" /tmp/researchloop-packed-prompt.log
grep -q "Do not summarize package internals" /tmp/researchloop-packed-prompt.log
grep -q "student or researcher starting AI research" /tmp/researchloop-packed-prompt.log
grep -q "Do not install Docker" /tmp/researchloop-packed-prompt.log
grep -q "Act as an automated AI researcher" /tmp/researchloop-packed-prompt.log
grep -q "Do not lead with skill names or prompt names" /tmp/researchloop-packed-prompt.log
grep -q "Ask for approval before running any baseline" /tmp/researchloop-packed-prompt.log
grep -q "Check read-only whether a baseline already exists" /tmp/researchloop-packed-prompt.log
grep -q "Talk to the user about the baseline first" /tmp/researchloop-packed-prompt.log
grep -q "baseline markdown note" /tmp/researchloop-packed-prompt.log
grep -q "# Topic Intake" /tmp/researchloop-packed-prompt.log
grep -q "propose, novel, or autonomous" /tmp/researchloop-packed-prompt.log
grep -q "genuinely different hypotheses" /tmp/researchloop-packed-prompt.log

"$bin" record --dir "$lab" --id packed-001 --status complete --metric val_loss=1.23 --note "packed smoke" >/tmp/researchloop-packed-record.log
"$bin" report --dir "$lab" >/tmp/researchloop-packed-report.log
grep -q "runs: 1" /tmp/researchloop-packed-report.log

echo "autoresearch test:packed passed (version=$local_version, files=$file_count)"
