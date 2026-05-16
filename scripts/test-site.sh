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

echo "autoresearch test:site passed"
