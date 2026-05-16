#!/usr/bin/env bash
set -euo pipefail

goal="reduce validation loss"

hyper="$(node ./bin/researchloop.js prompt --goal "$goal" --focus hyperparameters)"
arch="$(node ./bin/researchloop.js prompt --goal "$goal" --focus architecture)"
attn="$(node ./bin/researchloop.js prompt --goal "$goal" --focus attention)"
ladder="$(node ./bin/researchloop.js prompt --goal "$goal" --focus training-ladder)"

printf '%s' "$hyper" | grep -q "Hyperparameter Optimization Playbook"
printf '%s' "$hyper" | grep -q "muon_lr"
printf '%s' "$hyper" | grep -q "learning rate"

printf '%s' "$arch" | grep -q "Architecture Optimization Playbook"
printf '%s' "$arch" | grep -q "d_model"
printf '%s' "$arch" | grep -q "n_kv_heads"

printf '%s' "$attn" | grep -q "Attention Optimization Playbook"
printf '%s' "$attn" | grep -q "RoPE"
printf '%s' "$attn" | grep -q "n_kv_heads"

printf '%s' "$ladder" | grep -q "Training Ladder Playbook"
printf '%s' "$ladder" | grep -q "Stage 1"
printf '%s' "$ladder" | grep -q "Stage 4"
printf '%s' "$ladder" | grep -q "3-4 rounds total"
printf '%s' "$ladder" | grep -q "realistic time band"
printf '%s' "$ladder" | grep -q "How long do you usually want a typical experiment to run?"

if printf '%s' "$hyper" | grep -q '{{GOAL}}'; then
  echo "hyperparameter playbook still has GOAL placeholder" >&2
  exit 1
fi

echo "autoresearch test:focus-prompts passed"
