#!/usr/bin/env bash
# Runs every automated check: formatting, lints, Rust tests, browser tests and
# the headless checkpoint-1 clock simulation.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> cargo fmt"
cargo fmt --all --check

echo "==> cargo clippy"
cargo clippy --all-targets -- -D warnings

echo "==> cargo test (unit and integration)"
# The integration tests drive the real binary over a socket, so the binary has
# to exist before they run.
cargo build --quiet
cargo test

if command -v node >/dev/null 2>&1; then
  echo "==> browser unit tests"
  node --test 'web/test/*.test.mjs'

  echo "==> browser end-to-end (skipped without Playwright)"
  node web/test/e2e.mjs
else
  echo "==> browser tests SKIPPED (node not found)"
fi

echo "==> checkpoint 1 (headless, 20 s)"
# A short run for CI. Use --simulate-seconds 1800 for the real 30-minute check.
cargo run --quiet -- \
  --bind 127.0.0.1 --port 18099 \
  --room-code CHECK1 --room-secret checkpoint \
  --simulate 3 --simulate-seconds 20 --simulate-then-exit

echo
echo "All automated checks passed."
echo "Checkpoints 2 and 3 need two physical devices; see docs/checkpoints.md."
