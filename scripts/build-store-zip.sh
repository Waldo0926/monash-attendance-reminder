#!/usr/bin/env bash
# Builds the Chrome Web Store package from extension/ and refuses to finish if the
# package contains anything the store's remote-code scan (Blue Argon) would flag.
# Usage: scripts/build-store-zip.sh            -> store/monash-attendance-helper-<version>.zip
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$root/extension/manifest.json" | head -1)"
out="$root/store/monash-attendance-helper-$version.zip"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

rm -f "$out"
(cd "$root/extension" && zip -qrX "$out" . -x '*.DS_Store' -x '__MACOSX/*')
unzip -q "$out" -d "$tmp"

fail=0
flag() { echo "FAIL: $1"; fail=1; }

[ -f "$tmp/manifest.json" ] || flag "manifest.json is not at the zip root"

# No CDN hosts anywhere in code or pages.
if grep -rIlE 'jsdelivr|unpkg\.com|cdnjs|googleapis\.com/|gstatic\.com|esm\.sh|skypack' "$tmp" --include='*.js' --include='*.mjs' --include='*.html' --include='*.json'; then
  flag "CDN host found in the files above"
fi

# Bundled third-party executable code must not carry any URL literal, used or not.
for f in vendor/tesseract.esm.min.js vendor/worker.min.js vendor/tesseract-core-lstm.wasm.js; do
  if grep -Eq 'https?://' "$tmp/$f"; then flag "$f contains an http(s) URL"; fi
done

# Pages may only load scripts and styles from the package.
if grep -rIEn '<script[^>]+src="(https?:)?//|<link[^>]+href="(https?:)?//' "$tmp" --include='*.html'; then
  flag "remote <script> or <link> in a page"
fi

# Our own code may not import, importScripts or eval code from a URL.
if grep -rIEn 'import\(?\s*["'\''](https?:)?//|importScripts\(\s*["'\'']https?:|new Function\(|\beval\(' "$tmp" --include='*.js' --exclude-dir=vendor; then
  flag "remote import or eval in extension code"
fi

# CSP may only allow the package itself.
if grep -Eq '"extension_pages": *"[^"]*https?:' "$tmp/manifest.json"; then
  flag "content_security_policy allows a remote origin"
fi

if [ "$fail" -ne 0 ]; then
  rm -f "$out"
  exit 1
fi

echo "OK  $out ($(du -h "$out" | cut -f1), version $version)"
