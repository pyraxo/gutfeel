#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "$0")/.." && pwd)
RUST_ROOT="$PROJECT_ROOT/vendor/dirplayer/vm-rust"

if [[ -d /Library/Developer/CommandLineTools ]]; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi

lib_list=$(mktemp "${TMPDIR:-/tmp}/gutfeel-parity-lib.XXXXXX")
alpha_list=$(mktemp "${TMPDIR:-/tmp}/gutfeel-parity-alpha.XXXXXX")
rect_list=$(mktemp "${TMPDIR:-/tmp}/gutfeel-parity-rect.XXXXXX")
node_log=$(mktemp "${TMPDIR:-/tmp}/gutfeel-parity-node.XXXXXX")
cargo_log=$(mktemp "${TMPDIR:-/tmp}/gutfeel-parity-cargo.XXXXXX")
trap 'rm -f "$lib_list" "$alpha_list" "$rect_list" "$node_log" "$cargo_log"' EXIT

require_test() {
  local listing=$1
  local test_name=$2
  if ! grep -Fqx -- "$test_name: test" "$listing"; then
    echo "Parity regression is missing from Cargo inventory: $test_name" >&2
    exit 1
  fi
}

inventory_target() {
  local output=$1
  shift
  if ! cargo test "$@" -- --list > "$output" 2>&1; then
    cat "$output" >&2
    exit 1
  fi
}

run_cargo_test() {
  local label=$1
  shift
  echo "Cargo: $label"
  if ! cargo test "$@" > "$cargo_log" 2>&1; then
    cat "$cargo_log" >&2
    exit 1
  fi
  grep -E 'running [0-9]+ test|test .* \.\.\. ok|test result:' "$cargo_log"
}

cd "$RUST_ROOT"

# Inventory first so Cargo's successful zero-test result cannot hide a renamed,
# gated, or omitted regression.
inventory_target "$lib_list" --lib
sound_test='director::chunks::sound::snds_pcm_parity_tests::snds_pcm_matches_the_recovered_native_bg_music_samples'
text_test='rendering_gpu::webgl2::empty_text_tests::empty_copy_text_keeps_its_background_but_transparent_text_stays_invisible'
alpha_identity_test='director::chunks::alpha_chunk_identity_tests::alfa_is_distinct_from_unrecognised_raw_chunk_data'
require_test "$lib_list" "$sound_test"
require_test "$lib_list" "$text_test"
require_test "$lib_list" "$alpha_identity_test"

performance_tests=(
  'rendering_gpu::webgl2::direct_flash_canvas_tests::direct_canvas_keeps_tints_masks_and_nested_players_on_pixel_path'
  'player::bitmap::manager::flash_frame_tests::identical_flash_capture_preserves_texture_version_and_allocation'
  'player::bitmap::manager::flash_frame_tests::changed_flash_pixels_alpha_and_dimensions_invalidate_only_their_owner'
  'rendering_gpu::webgl2::flash_rgba_parity_tests::flash_rgba_fast_path_matches_general_converter'
  'rendering_gpu::webgl2::flash_rgba_parity_tests::authored_alpha_and_tinted_flash_keep_existing_processing'
  'rendering::draw_pacing_tests::authored_fifty_hz_survives_display_refresh_quantization'
  'rendering::draw_pacing_tests::late_draws_skip_missed_deadlines_without_a_burst'
)
for performance_test in "${performance_tests[@]}"; do
  require_test "$lib_list" "$performance_test"
done

inventory_target "$alpha_list" --test gutfeel_alpha_assets
alpha_test='gutfeel_client_applies_external_alfa_to_copy_reset_assets'
notice_test='gutfeel_gnotice_mask_copy_preserves_the_banner_under_text'
teeth_test='gutfeel_biting_point_keeps_only_the_active_pair_after_two_steps'
require_test "$alpha_list" "$alpha_test"
require_test "$alpha_list" "$notice_test"
require_test "$alpha_list" "$teeth_test"

inventory_target "$rect_list" --test gutfeel_rect_coercion
rect_test='gutfeel_zero_hardness_accepts_void_rect_coordinates'
require_test "$rect_list" "$rect_test"

echo 'Running focused native parity regressions...'
run_cargo_test 'sndS PCM byte parity' --lib "$sound_test" -- --exact --nocapture
run_cargo_test 'empty Copy-ink Text background' --lib "$text_test" -- --exact --nocapture
run_cargo_test 'explicit ALFA chunk identity' --lib "$alpha_identity_test" -- --exact --nocapture
run_cargo_test 'external ALFA recovered assets' --test gutfeel_alpha_assets "$alpha_test" -- --exact --nocapture
run_cargo_test 'notice alpha-mask composition' --test gutfeel_alpha_assets "$notice_test" -- --exact --nocapture
run_cargo_test 'Biting_point active-pair repaint' --test gutfeel_alpha_assets "$teeth_test" -- --exact --nocapture
run_cargo_test 'zero-hardness rect coercion' --test gutfeel_rect_coercion "$rect_test" -- --exact --nocapture

for performance_test in "${performance_tests[@]}"; do
  run_cargo_test "$performance_test" --lib "$performance_test" -- --exact --nocapture
done

cd "$PROJECT_ROOT"
echo 'Running Node integration regressions...'
node --test --test-reporter=tap tests/*.test.mjs | tee "$node_log"
node_count=$(awk '/^# tests [0-9]+$/ { count=$3 } END { print count+0 }' "$node_log")
if (( node_count < 8 )); then
  echo "Expected at least 8 Node integration tests, runner reported $node_count" >&2
  exit 1
fi

echo 'Verifying preserved original installation files...'
node tools/verify-originals.mjs

echo "Parity checks passed: 14 focused Cargo regressions, $node_count Node tests, and original-file hashes."
