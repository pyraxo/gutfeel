#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNTIME_ROOT="$PROJECT_ROOT/vendor/dirplayer"
PATCH_FILE="$PROJECT_ROOT/recovered/runtime.patch"
RUNTIME_BASE=68376fbb4494a6bbad4c70081ecdcb99814a74c9
[[ "$(git -C "$RUNTIME_ROOT" rev-parse HEAD)" == "$RUNTIME_BASE" ]] || { echo 'Unexpected runtime base.' >&2; exit 1; }
mkdir -p "$PROJECT_ROOT/recovered"
git -C "$RUNTIME_ROOT" diff --binary -- src vm-rust dirplayer-js-api/index.d.ts ':!package-lock.json' ':!node_modules' > "$PATCH_FILE"
while IFS= read -r -d '' relative; do
  case "$relative" in
    src/*.js|src/*.mjs|src/*.ts|src/*.tsx|vm-rust/src/*.rs|vm-rust/tests/*.rs|vm-rust/tests/fixtures/gutfeel/*) ;;
    *) continue ;;
  esac
  result=0
  git -C "$RUNTIME_ROOT" diff --binary --no-index /dev/null "$relative" >> "$PATCH_FILE" || result=$?
  [[ "$result" -le 1 ]] || exit "$result"
done < <(git -C "$RUNTIME_ROOT" ls-files --others --exclude-standard -z -- src vm-rust/src vm-rust/tests)
echo "Saved runtime source patch to $PATCH_FILE"
