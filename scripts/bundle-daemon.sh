#!/usr/bin/env bash
set -euo pipefail

# Build emergentd and copy to Tauri's externalBin location.
# Run this before `tauri build` for release builds.
#
# Usage:
#   ./scripts/bundle-daemon.sh          # just build and copy
#   ./scripts/bundle-daemon.sh --build  # also run tauri build with externalBin

TARGET_TRIPLE=$(rustc -vV | grep host | cut -d' ' -f2)
echo "Building emergentd for ${TARGET_TRIPLE}..."

cargo build -p emergent-core --release

mkdir -p src-tauri/binaries
cp "target/release/emergentd" "src-tauri/binaries/emergentd-${TARGET_TRIPLE}"
echo "Copied to src-tauri/binaries/emergentd-${TARGET_TRIPLE}"

if [[ "${1:-}" == "--build" ]]; then
  echo "Running tauri build with externalBin..."
  bunx tauri build --config '{"bundle":{"externalBin":["binaries/emergentd"]}}'
fi
