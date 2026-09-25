#!/bin/bash
# Build for @dsh-external/dsh-boot-animation.
#
# The host half is plain JavaScript with no DSH SDK imports, so it needs no
# compiler and no DSH source checkout: it is copied verbatim into lib/. Only the
# browser half needs building, and tsdown does that (`npm run build:client`),
# emitting lib/client.js in the window.__ModuleLoader__ factory format.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== host half: copying src/host.js -> lib/index.js (no compile needed) ==="
mkdir -p lib
cp src/host.js lib/index.js

echo "=== browser half: tsdown (lib/client.js) ==="
if [ -x node_modules/.bin/tsdown ] || [ -f node_modules/.bin/tsdown.cmd ]; then
  npm run build:client
else
  echo "build: tsdown is not installed - run 'npm install' first" >&2
  exit 1
fi

[ -f lib/index.js ] || { echo "build: lib/index.js missing" >&2; exit 1; }
[ -f lib/client.js ] || { echo "build: lib/client.js missing" >&2; exit 1; }
[ -f assets/boot.mp4 ] || { echo "build: assets/boot.mp4 missing" >&2; exit 1; }
echo "=== Build complete ==="
