#!/usr/bin/env bash
# Build the Nds4j snapshot + the NitroViewer facade jar and stage both for CheerpJ.
#
# CheerpJ runs these two jars unmodified in the browser. Nds4j has no runtime dependencies,
# so a plain `package` yields a self-contained jar (no shading needed).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Nds4j source lives beside this repo by default; CI can override with NDS4J_DIR.
nds4j="$(cd "${NDS4J_DIR:-$here/../Nds4j}" && pwd)"

echo "==> Installing Nds4j (feature/3d-formats) from $nds4j"
mvn -q -f "$nds4j/pom.xml" -DskipTests install

echo "==> Packaging nitroviewer-core"
mvn -q -f "$here/nitroviewer-core/pom.xml" -DskipTests package

core_jar="$(ls "$here"/nitroviewer-core/target/nitroviewer-core-*.jar | head -1)"
nds4j_jar="$(ls "$nds4j"/target/Nds4j-*.jar | head -1)"

for dest in "$here/spike/jars" "$here/web/public/jars"; do
  mkdir -p "$dest"
  cp "$core_jar"  "$dest/nitroviewer-core.jar"
  cp "$nds4j_jar" "$dest/Nds4j.jar"
  echo "==> Staged jars in $dest"
done

echo "Done."
