#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_file="$repo_root/docs/site/index.html"

if [ ! -f "$site_file" ]; then
  echo "site file missing: $site_file" >&2
  exit 1
fi

site="$(cat "$site_file")"

printf '%s' "$site" | grep -q 'AutoResearch-AI - 用一个 prompt 启动自主 AI 研究'
printf '%s' "$site" | grep -q 'npm install -g autoresearch-ai'
printf '%s' "$site" | grep -q '自动化 AI 研究。'
printf '%s' "$site" | grep -q '人类定范围，agents 运行。'
printf '%s' "$site" | grep -q '由一组 agents 自主处理实验'
printf '%s' "$site" | grep -q 'autoresearch dashboard'
printf '%s' "$site" | grep -q '仅本地。无 auth。无 cloud。'
! printf '%s' "$site" | grep -q 'Placeholder'

echo "autoresearch test:site passed"
