#!/bin/sh
# Downloads appimagetool and the AppImage type-2 runtime, pinned by release and SHA-256
# (spec m6-packaging). Both are MIT; the runtime statically links libfuse 3 (LGPL-2.1+),
# squashfuse (BSD-2-Clause), musl (MIT) and zstd (BSD-3-Clause) and becomes part of our AppImage.
# Renovate does not track these: bump the release and checksum together, from the release page's
# asset digests (gh release view <tag> -R AppImage/<repo> --json assets).
# Usage: tools/package/fetch-appimagetool.sh <dir>   -> <dir>/appimagetool, <dir>/runtime-x86_64
set -eu

APPIMAGETOOL_RELEASE=1.9.1
APPIMAGETOOL_SHA256=ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0
RUNTIME_RELEASE=20251108
RUNTIME_SHA256=2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d

dir=${1:?usage: fetch-appimagetool.sh <dir>}
mkdir -p "$dir"

fetch() { # url file sha256
  curl --fail --silent --show-error --location --retry 3 --output "$2.part" "$1"
  echo "$3  $2.part" | sha256sum --check --quiet
  mv "$2.part" "$2"
}

fetch "https://github.com/AppImage/appimagetool/releases/download/${APPIMAGETOOL_RELEASE}/appimagetool-x86_64.AppImage" \
  "$dir/appimagetool" "$APPIMAGETOOL_SHA256"
chmod 755 "$dir/appimagetool"
fetch "https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_RELEASE}/runtime-x86_64" \
  "$dir/runtime-x86_64" "$RUNTIME_SHA256"
echo "appimagetool ${APPIMAGETOOL_RELEASE}, runtime ${RUNTIME_RELEASE} -> $dir"
