#!/usr/bin/env bash
# Packages the webOS receiver app into an .ipk.
#
# Requires LG's webOS CLI tools (ares-package). Nothing in this repository has
# been run against a real television; see webos/receiver-app/README.md.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v ares-package >/dev/null 2>&1; then
  echo "ares-package not found." >&2
  echo "Install the webOS CLI: https://webostv.developer.lge.com/develop/tools/cli-introduction" >&2
  exit 1
fi

mkdir -p webos/build

if [ ! -f webos/receiver-app/icon.png ]; then
  echo "note: webos/receiver-app/icon.png is missing; the app will use a default icon."
fi

ares-package webos/receiver-app --outdir webos/build

echo
echo "Packaged into webos/build/."
echo "Install with: ares-install --device <tv> webos/build/com.homesync.receiver_0.1.0_all.ipk"
