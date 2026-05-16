#!/usr/bin/env bash
set -euo pipefail

base_default="${TMPDIR:-/tmp}"
base="$base_default"

while [ $# -gt 0 ]; do
  case "$1" in
    --base)
      shift
      base="$1"
      ;;
    --base=*)
      base="${1#--base=}"
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: create-lab.sh [--base PATH]

Creates a fresh empty lab folder for AutoResearch-AI onboarding tests.
Defaults to $TMPDIR (or /tmp).

Set --base to a different parent directory if you want labs grouped
somewhere persistent.
USAGE
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [ ! -d "$base" ]; then
  mkdir -p "$base"
fi

stamp="$(date +%Y-%m-%dT%H-%M-%S)"
lab="$base/autoresearch-onboarding-lab-$stamp"

mkdir -p "$lab"
printf '%s\n' "$lab"
