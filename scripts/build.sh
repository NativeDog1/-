#!/bin/bash
# Build for @dsh-external/dsh-boot-animation.
#
# Three artifacts, none of them a media file:
#   lib/index.js            the host half, copied verbatim from src/host.js
#                           (plain JS, no compiler, no DSH checkout needed)
#   lib/client.js           the browser half, built by tsdown into the
#                           window.__ModuleLoader__ factory format
#   lib/clips.{meta,data}.js  the two built-in clips as base64, generated from
#                           media/*.mp4 by scripts/embed-clips.mjs
#
# The clips are embedded so nothing about them can go wrong at runtime: no
# `files` entry to forget, no stale copy in an install, no container shipped
# without faststart. media/ holds the sources and is NOT published.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== host half: copying src/host.js -> lib/index.js (no compile needed) ==="
mkdir -p lib
cp src/host.js lib/index.js

echo "=== built-in clips: embedding media/*.mp4 as base64 ==="
node scripts/embed-clips.mjs

echo "=== browser half: tsdown (lib/client.js) ==="
if [ -x node_modules/.bin/tsdown ] || [ -f node_modules/.bin/tsdown.cmd ]; then
  npm run build:client
else
  echo "build: tsdown is not installed - run 'npm install' first" >&2
  exit 1
fi

[ -f lib/index.js ] || { echo "build: lib/index.js missing" >&2; exit 1; }
[ -f lib/client.js ] || { echo "build: lib/client.js missing" >&2; exit 1; }
[ -f lib/clips.meta.js ] || { echo "build: lib/clips.meta.js missing" >&2; exit 1; }
[ -f lib/clips.data.js ] || { echo "build: lib/clips.data.js missing" >&2; exit 1; }
echo "=== Build complete ==="
