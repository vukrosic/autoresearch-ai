#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

cli=(node "$repo_root/bin/researchloop.js")

# Build a fake repo with multiple multi-GPU launchers visible to inspect.
mkdir -p "$tmpdir/src"
cat > "$tmpdir/src/train.py" <<'PY'
import torch
import accelerate
from accelerate import Accelerator
acc = Accelerator()
PY

cat > "$tmpdir/launch.sh" <<'SH'
#!/usr/bin/env bash
torchrun --nproc-per-node=8 src/train.py "$@"
SH

cat > "$tmpdir/ds_train.py" <<'PY'
import deepspeed
deepspeed.initialize(...)
PY

cat > "$tmpdir/lt_train.py" <<'PY'
import pytorch_lightning as pl
PY

cat > "$tmpdir/requirements.txt" <<'REQ'
torch
accelerate
deepspeed
pytorch_lightning
REQ

"${cli[@]}" init --agent codex --dir "$tmpdir" >/tmp/autoresearch-mgpu-init.log
"${cli[@]}" inspect --dir "$tmpdir" >/tmp/autoresearch-mgpu-inspect.log

# Verify each launcher detected.
grep -q '"tool": "torchrun"' /tmp/autoresearch-mgpu-inspect.log
grep -q '"tool": "accelerate"' /tmp/autoresearch-mgpu-inspect.log
grep -q '"tool": "deepspeed"' /tmp/autoresearch-mgpu-inspect.log
grep -q '"tool": "pytorch-lightning"' /tmp/autoresearch-mgpu-inspect.log

# Verify launch suggestions present.
grep -q "torchrun --nproc-per-node" /tmp/autoresearch-mgpu-inspect.log
grep -q "accelerate launch --num_processes" /tmp/autoresearch-mgpu-inspect.log
grep -q "deepspeed --num_gpus" /tmp/autoresearch-mgpu-inspect.log

# Repo-profile.json persisted with multi_gpu block.
test -f "$tmpdir/.researchloop/repo-profile.json"
grep -q '"multi_gpu":' "$tmpdir/.researchloop/repo-profile.json"

echo "autoresearch test:multi-gpu-detect passed"
