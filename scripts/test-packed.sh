#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pack_dir="$(mktemp -d)"
prefix="$(mktemp -d)"
lab="$(mktemp -d)"
trap 'rm -rf "$pack_dir" "$prefix" "$lab"' EXIT

cd "$repo_root"
pack_json="$pack_dir/npm-pack.json"
npm pack --pack-destination "$pack_dir" --json > "$pack_json"
tarball_name="$(node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(data[0].filename || ""));' "$pack_json")"
unpacked_size="$(node -e 'const fs=require("node:fs");const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(data[0].unpackedSize || 0));' "$pack_json")"
tarball="$pack_dir/$tarball_name"

if [ ! -f "$tarball" ]; then
  echo "tarball not produced: $tarball" >&2
  exit 1
fi

packed_list="$pack_dir/packed-files.txt"
tar tzf "$tarball" | sort > "$packed_list"

file_count="$(wc -l < "$packed_list" | tr -d ' ')"
if [ "$file_count" -lt 30 ]; then
  echo "tarball file count $file_count < 30" >&2
  cat "$packed_list" >&2
  exit 1
fi
if [ "$unpacked_size" -le 0 ]; then
  echo "npm pack did not report a positive unpackedSize" >&2
  cat "$pack_json" >&2
  exit 1
fi

# Review thresholds, not tight limits: these catch accidental bulk additions.
max_file_count=260
max_unpacked_size=2500000
if [ "$file_count" -gt "$max_file_count" ]; then
  echo "tarball file count $file_count exceeds review threshold $max_file_count" >&2
  cat "$packed_list" >&2
  exit 1
fi
if [ "$unpacked_size" -gt "$max_unpacked_size" ]; then
  echo "tarball unpackedSize $unpacked_size exceeds review threshold $max_unpacked_size" >&2
  cat "$pack_json" >&2
  exit 1
fi

echo "packed tarball: files=$file_count unpacked_size=$unpacked_size"

for forbidden in \
  "^package/researchloop-dev/" \
  "^package/scripts/" \
  "^package/docs/competitors/" \
  "^package/docs/startup/"
do
  if grep -qE "$forbidden" "$packed_list"; then
    echo "forbidden tarball path matched: $forbidden" >&2
    grep -E "$forbidden" "$packed_list" >&2
    exit 1
  fi
done

required_manifest="$pack_dir/required-files.txt"
cat > "$required_manifest" <<'FILES'
package/README.md
package/CHANGELOG.md
package/docs/getting-started.md
package/assets/autoresearch-banner.webp
package/bin/researchloop.js
package/templates/AGENTS.md
package/templates/adapters/generic.md
package/templates/base/AGENTS.md
package/templates/base/baseline.md
package/templates/base/eval.yaml
package/templates/base/goal.md
package/templates/base/plan.md
package/templates/base/safety.yaml
package/templates/base/scratchpad/runs.jsonl
package/templates/dashboard/index.html
package/templates/prompts/first-contact.md
package/templates/prompts/researchloop.md
package/templates/prompts/topic-intake.md
package/templates/team/README.md
package/skills/AGENTS.md
package/skills/README.md
package/skills/researchloop-autoresearch/baseline-first/SKILL.md
package/skills/researchloop-autoresearch/codex/SKILL.md
package/skills/researchloop-autoresearch/onboarding-and-demo/SKILL.md
package/skills/researchloop-autoresearch/release-proof/SKILL.md
package/skills/researchloop-autoresearch/references/core-loop.md
package/skills/researchloop-training-ladder/SKILL.md
FILES

node - "$repo_root" >> "$required_manifest" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const entry = path.join(root, "bin", "researchloop.js");
const source = fs.readFileSync(entry, "utf8");
const required = new Set();
for (const match of source.matchAll(/from\s+["'](\.\/researchloop-[^"']+\.js)["']/g)) {
  required.add(`package/bin/${match[1].slice(2)}`);
}
for (const file of [...required].sort()) {
  console.log(file);
}
NODE

missing_required=0
while IFS= read -r required_file; do
  [ -z "$required_file" ] && continue
  if ! grep -Fxq "$required_file" "$packed_list"; then
    echo "missing required tarball file: $required_file" >&2
    missing_required=$((missing_required + 1))
  fi
done < "$required_manifest"
if [ "$missing_required" -gt 0 ]; then
  echo "required tarball manifest failed with $missing_required missing file(s)" >&2
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
grep -q "autoresearch baseline-status" /tmp/researchloop-packed-help.log
grep -q "autoresearch baseline --lock" /tmp/researchloop-packed-help.log
grep -q "autoresearch paper-read" /tmp/researchloop-packed-help.log
grep -q "autoresearch eval" /tmp/researchloop-packed-help.log
grep -q "autoresearch priors" /tmp/researchloop-packed-help.log
grep -q "autoresearch propose" /tmp/researchloop-packed-help.log
grep -q "autoresearch rank" /tmp/researchloop-packed-help.log
grep -q "autoresearch next-experiment" /tmp/researchloop-packed-help.log
grep -q "autoresearch topic" /tmp/researchloop-packed-help.log
grep -q "autoresearch hypothesis" /tmp/researchloop-packed-help.log
grep -q "autoresearch sweep generate|status|run" /tmp/researchloop-packed-help.log
grep -q "autoresearch tasks" /tmp/researchloop-packed-help.log
grep -q "autoresearch summary" /tmp/researchloop-packed-help.log
grep -q "repair-plan" /tmp/researchloop-packed-help.log
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

echo "autoresearch test:packed passed (version=$local_version, files=$file_count, unpacked_size=$unpacked_size)"
