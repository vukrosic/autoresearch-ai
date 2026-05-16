#!/usr/bin/env bash
set -euo pipefail

goal="reduce validation loss"

out="$(node ./bin/researchloop.js prompt --goal "$goal")"
printf '%s' "$out" | grep -q "$goal"
printf '%s' "$out" | grep -q ".researchloop/AGENTS.md"
printf '%s' "$out" | grep -q ".researchloop/plan.md"
printf '%s' "$out" | grep -q ".researchloop/scratchpad/runs.jsonl"
printf '%s' "$out" | grep -q "Use that history first"
printf '%s' "$out" | grep -q "How long do you usually want a typical experiment to run?"
printf '%s' "$out" | grep -q "quick / standard / long"
printf '%s' "$out" | grep -q "target explicit"
printf '%s' "$out" | grep -q "Use this folder, point me at a GitHub repo, or spin up a demo research repo?"
printf '%s' "$out" | grep -q "learning-rate or hyperparameter sweeps"
printf '%s' "$out" | grep -q "# First Contact"
printf '%s' "$out" | grep -q "# Topic Intake"
printf '%s' "$out" | grep -q "Do not install Docker"
printf '%s' "$out" | grep -q "Do not run \`autoresearch run\`"
printf '%s' "$out" | grep -q "Do not summarize package internals"
printf '%s' "$out" | grep -q "student or researcher starting AI research"
printf '%s' "$out" | grep -q "Do not install Docker"
printf '%s' "$out" | grep -q "Act as an automated AI researcher"
printf '%s' "$out" | grep -q "Do not lead with skill names or prompt names"
printf '%s' "$out" | grep -q "Ask for approval before running any baseline"
printf '%s' "$out" | grep -q "Check read-only whether a baseline already exists"
printf '%s' "$out" | grep -q "Talk to the user about the baseline first"
printf '%s' "$out" | grep -q "baseline markdown note"
printf '%s' "$out" | grep -q "propose, novel, or autonomous"
printf '%s' "$out" | grep -q "genuinely different hypotheses"
if printf '%s' "$out" | grep -q '{{GOAL}}'; then
  echo "prompt template still has GOAL placeholder" >&2
  exit 1
fi

echo "autoresearch test:prompts passed"
