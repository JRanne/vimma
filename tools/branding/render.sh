#!/usr/bin/env bash
# Renders the placeholder brand images Surfer needs from the SVG sources in
# configs/branding/vimma/ (spec m0-branding). Needs rsvg-convert and ImageMagick (magick).
# Re-run after editing logo.svg, wordmark.svg or document-pdf.svg, and commit the outputs.
set -euo pipefail
dir="$(cd "$(dirname "$0")/../../configs/branding/vimma" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$dir"

png() { rsvg-convert -w "$2" -h "$2" "$1" -o "$3"; }

# Linux icons (Surfer copies logoN.png to defaultN.png) and the about-logo source.
for s in 16 22 24 32 48 64 128 256 512; do png logo.svg "$s" "logo$s.png"; done
png logo.svg 1024 logo.png
png logo.svg 1024 logo-mac.png

# Windows icons Surfer requires (the Linux build packages document.ico too).
for s in 16 32 48 64 256; do png logo.svg "$s" "$tmp/i$s.png"; done
magick "$tmp"/i{16,32,48,256}.png firefox.ico
magick "$tmp"/i{16,32,48,64,256}.png firefox64.ico
png document-pdf.svg 16 "$tmp/d16.png"
png document-pdf.svg 32 "$tmp/d32.png"
magick "$tmp"/d16.png "$tmp"/d32.png document.ico

# chrome://branding/content/ overrides, so no file from browser/branding/unofficial is shown on Linux.
cp logo.svg content/about-logo.svg
cp wordmark.svg content/about-wordmark.svg
cp wordmark.svg content/firefox-wordmark.svg
cp document-pdf.svg content/document_pdf.svg
png logo.svg 192 content/about-logo-private.png
png logo.svg 384 content/about-logo-private@2x.png
png logo.svg 200 "$tmp/about-logo.png"
magick -size 300x236 xc:'#1a1b26' "$tmp/about-logo.png" -gravity center -composite content/about.png

# Strip timestamps so re-running does not churn the committed PNGs.
for f in logo*.png content/*.png; do magick "$f" -strip -define png:exclude-chunks=date,time "$f"; done
