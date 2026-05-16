#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="node $repo_root/bin/researchloop.js"

tmp_empty="$(mktemp -d)"
tmp_filenames="$(mktemp -d)"
tmp_pytorch="$(mktemp -d)"
tmp_hf="$(mktemp -d)"
tmp_llm_partial="$(mktemp -d)"
tmp_llm_full="$(mktemp -d)"
trap 'rm -rf "$tmp_empty" "$tmp_filenames" "$tmp_pytorch" "$tmp_hf" "$tmp_llm_partial" "$tmp_llm_full"' EXIT

# Case 1: empty dir → generic only.
$cli inspect --dir "$tmp_empty" >/tmp/researchloop-adapters-empty.log
grep -q '"generic"' /tmp/researchloop-adapters-empty.log
if grep -q '"pytorch"' /tmp/researchloop-adapters-empty.log; then
  echo "empty dir should not detect pytorch" >&2
  cat /tmp/researchloop-adapters-empty.log >&2
  exit 1
fi
if grep -q '"huggingface"' /tmp/researchloop-adapters-empty.log; then
  echo "empty dir should not detect huggingface" >&2
  exit 1
fi

# Case 2: filename substrings ("train" but not a train script) → no pytorch.
mkdir -p "$tmp_filenames/training" "$tmp_filenames/data"
echo "{}" > "$tmp_filenames/training_metadata.json"
echo "note" > "$tmp_filenames/train_data.txt"
echo "name = \"example\"" > "$tmp_filenames/pyproject.toml"
echo "import sys" > "$tmp_filenames/entrainment.py"
$cli inspect --dir "$tmp_filenames" >/tmp/researchloop-adapters-filenames.log
if grep -q '"pytorch"' /tmp/researchloop-adapters-filenames.log; then
  echo "filename substrings (entrainment.py, train_data.txt) should not trigger pytorch" >&2
  cat /tmp/researchloop-adapters-filenames.log >&2
  exit 1
fi
if grep -q '"huggingface"' /tmp/researchloop-adapters-filenames.log; then
  echo "no transformers dep should not trigger huggingface" >&2
  exit 1
fi

# Case 3: real train.py → pytorch.
echo "import torch" > "$tmp_pytorch/train.py"
$cli inspect --dir "$tmp_pytorch" >/tmp/researchloop-adapters-pytorch.log
grep -q '"pytorch"' /tmp/researchloop-adapters-pytorch.log
grep -q '"train.py"' /tmp/researchloop-adapters-pytorch.log

# Case 4: transformers in deps → huggingface (without train script).
echo "transformers==4.0.0" > "$tmp_hf/requirements.txt"
$cli inspect --dir "$tmp_hf" >/tmp/researchloop-adapters-hf.log
grep -q '"huggingface"' /tmp/researchloop-adapters-hf.log

# Case 5a: llm-research-kit requires BOTH train_llm.py and configs/llm_config.py.
mkdir -p "$tmp_llm_partial/configs"
touch "$tmp_llm_partial/train_llm.py"
$cli inspect --dir "$tmp_llm_partial" >/tmp/researchloop-adapters-llm-partial.log
if grep -q '"llm-research-kit"' /tmp/researchloop-adapters-llm-partial.log; then
  echo "llm-research-kit should require both files" >&2
  cat /tmp/researchloop-adapters-llm-partial.log >&2
  exit 1
fi

# Case 5b: both files present → llm-research-kit detected.
mkdir -p "$tmp_llm_full/configs"
touch "$tmp_llm_full/train_llm.py" "$tmp_llm_full/configs/llm_config.py"
$cli inspect --dir "$tmp_llm_full" >/tmp/researchloop-adapters-llm-full.log
grep -q '"llm-research-kit"' /tmp/researchloop-adapters-llm-full.log

echo "autoresearch test:adapters passed"
