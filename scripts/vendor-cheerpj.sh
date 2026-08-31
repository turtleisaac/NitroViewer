#!/usr/bin/env bash
# Download a self-hosted CheerpJ 4.3 runtime (Java 8) for the Electron app.
#
# The website still uses the CDN. The desktop bundle serves this tree from
# /cheerpj/ so cheerpjInit never hits the network. Java 11/17, Tailscale, and
# the large Noto CJK/emoji fonts are omitted (NitroViewer is library-mode Java 8;
# missing files 204 like the official CDN).
set -euo pipefail

VERSION="${CHEERPJ_VERSION:-4.3}"
BASE="https://cjrtnc.leaningtech.com/${VERSION}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${CHEERPJ_DEST:-$here/web/vendor/cheerpj}"
UA="NitroViewer-vendor-cheerpj/1.0"

skip() {
  case "$1" in
    11|11/*|17|17/*|tun|tun/*|cj3n11.wasm|cj3n17.wasm) return 0 ;;
    fc/ttf/Noto*|fc/ttf/Noto*) return 0 ;;
  esac
  return 1
}

# Returns 0 if $1/index.list exists (directory).
is_dir() {
  local code
  code="$(curl -sS -o /tmp/cj-index.list -w '%{http_code}' -A "$UA" "$BASE/$1/index.list")"
  [[ "$code" == "200" && -s /tmp/cj-index.list ]]
}

download_tree() {
  local rel="$1"
  local dest="$DEST${rel:+/$rel}"
  mkdir -p "$dest"
  local list_url="$BASE${rel:+/$rel}/index.list"
  echo "  list ${rel:-/}"
  curl -fsSL -A "$UA" -o "$dest/index.list" "$list_url"
  local name child
  while IFS= read -r name || [[ -n "$name" ]]; do
    name="${name%$'\r'}"
    [[ -z "$name" ]] && continue
    if [[ -n "$rel" ]]; then child="$rel/$name"; else child="$name"; fi
    if skip "$child"; then
      echo "  skip $child"
      continue
    fi
    if is_dir "$child"; then
      download_tree "$child"
    else
      mkdir -p "$(dirname "$DEST/$child")"
      if [[ -s "$DEST/$child" ]]; then
        echo "  have $child"
        continue
      fi
      echo "  get  $child"
      curl -fL --retry 8 --retry-all-errors --retry-delay 2 -C - -A "$UA" -o "$DEST/$child" "$BASE/$child"
    fi
  done < "$dest/index.list"
}

if [[ -f "$DEST/.vendor-version" ]] && [[ "$(cat "$DEST/.vendor-version")" == "$VERSION" ]] \
    && [[ -f "$DEST/loader.js" ]] && [[ -f "$DEST/8/jre/lib/rt.jar" ]]; then
  echo "==> CheerpJ $VERSION already vendored in $DEST"
  exit 0
fi

echo "==> Vendoring CheerpJ $VERSION into $DEST"
mkdir -p "$DEST"
download_tree ""
printf '%s\n' "$VERSION" > "$DEST/.vendor-version"
echo "Done. $(du -sh "$DEST" | awk '{print $1}') in $DEST"
