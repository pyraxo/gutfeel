#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUNTIME_ROOT="$PROJECT_ROOT/vendor/dirplayer"
RUNTIME_BASE=68376fbb4494a6bbad4c70081ecdcb99814a74c9
RUNTIME_PATCH="$PROJECT_ROOT/recovered/runtime.patch"
if [[ ! -d "$RUNTIME_ROOT/.git" ]]; then
  [[ -f "$RUNTIME_PATCH" ]] || { echo 'Missing recovered/runtime.patch; snapshot the development runtime first.' >&2; exit 1; }
  mkdir -p "$PROJECT_ROOT/vendor"
  git clone https://github.com/igorlira/dirplayer-rs "$RUNTIME_ROOT"
  git -C "$RUNTIME_ROOT" checkout --detach "$RUNTIME_BASE"
fi
[[ "$(git -C "$RUNTIME_ROOT" rev-parse HEAD)" == "$RUNTIME_BASE" ]] || { echo 'Unexpected runtime base; preserve this checkout and resolve its version before building.' >&2; exit 1; }
if [[ -z "$(git -C "$RUNTIME_ROOT" status --porcelain)" ]]; then
  [[ -s "$RUNTIME_PATCH" ]] || { echo 'Missing migration patch; refusing to build an unadapted player.' >&2; exit 1; }
  git -C "$RUNTIME_ROOT" apply --check "$RUNTIME_PATCH"
  git -C "$RUNTIME_ROOT" apply "$RUNTIME_PATCH"
else
  echo 'Building the existing runtime working tree without modifying its source.'
fi
if [[ -d /Library/Developer/CommandLineTools ]]; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
cd "$RUNTIME_ROOT/vm-rust"
# wasm-pack packages from its output directory. A prior interrupted or
# differently-versioned bindgen run can leave a partial package manifest there;
# start from the ignored generated directory so this build is self-contained.
rm -rf "$RUNTIME_ROOT/vm-rust/pkg"
case "${GUTFEEL_BUILD_PROFILE:-release}" in
  dev) wasm-pack build --target web --dev --no-opt ;;
  release) wasm-pack build --target web --release --no-opt ;;
  *) echo 'GUTFEEL_BUILD_PROFILE must be dev or release.' >&2; exit 1 ;;
esac
cd "$RUNTIME_ROOT"
npm ci --ignore-scripts --legacy-peer-deps
./node_modules/.bin/vite build -c vite.config.polyfill.js
mkdir -p "$PROJECT_ROOT/web/public/runtime"
cp dist-polyfill/dirplayer-polyfill.js "$PROJECT_ROOT/web/public/runtime/dirplayer-polyfill.js"
echo "Built Gut Feel runtime from $RUNTIME_BASE plus local migration source. Existing Ruffle assets are retained."
