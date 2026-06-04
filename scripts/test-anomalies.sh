#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-anom-init.log

# Run that yields a spike: 0.5, 0.55, 0.52, 0.6, 12.0, 0.58
spike_cmd="printf 'val_loss=0.5\nval_loss=0.55\nval_loss=0.52\nval_loss=0.6\nval_loss=12.0\nval_loss=0.58\n'"
"${cli[@]}" run --dir "$tmpdir" --id spike --command "$spike_cmd" --metric val_loss >/tmp/autoresearch-anom-spike.log

# Run that plateaus: 10 values within 0.1% of each other.
plateau_cmd="printf 'val_loss=0.500\nval_loss=0.5001\nval_loss=0.5002\nval_loss=0.5001\nval_loss=0.5000\nval_loss=0.5002\nval_loss=0.5001\nval_loss=0.5000\nval_loss=0.5001\nval_loss=0.5000\n'"
"${cli[@]}" run --dir "$tmpdir" --id plat --command "$plateau_cmd" --metric val_loss >/tmp/autoresearch-anom-plat.log

# Run that diverges (NaN): emit nan token.
nan_cmd="printf 'val_loss=0.5\nval_loss=0.4\nval_loss=NaN\n'"
"${cli[@]}" run --dir "$tmpdir" --id diverge --command "$nan_cmd" --metric val_loss >/tmp/autoresearch-anom-nan.log

# Anomaly scan for spike run.
"${cli[@]}" anomalies --dir "$tmpdir" --id spike >/tmp/autoresearch-anom-spike-out.log
grep -q "run: spike" /tmp/autoresearch-anom-spike-out.log
grep -q "spike at step" /tmp/autoresearch-anom-spike-out.log

# Anomaly scan for plateau run.
"${cli[@]}" anomalies --dir "$tmpdir" --id plat >/tmp/autoresearch-anom-plat-out.log
grep -q "plateau:" /tmp/autoresearch-anom-plat-out.log

# JSON format.
"${cli[@]}" anomalies --dir "$tmpdir" --id spike --format json >/tmp/autoresearch-anom-spike-json.log
grep -qE '"kind":\s*"spike"' /tmp/autoresearch-anom-spike-json.log
grep -qE '"run_id":\s*"spike"' /tmp/autoresearch-anom-spike-json.log

echo "autoresearch test:anomalies passed"
