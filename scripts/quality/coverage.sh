#!/usr/bin/env bash
# Regenerate the JaCoCo XML and Vitest LCOV reports crapper reads.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=java-env.sh
source "$root/scripts/quality/java-env.sh"
prepare_nds4j "$root"

while IFS= read -r pom; do
  echo "JaCoCo: $pom"
  mvn -B -ntp -f "$pom" "${MVN_NDS4J[@]}" test
done < <(maven_poms "$root")

if [[ ! -d "$root/web/node_modules" ]]; then
  echo "web/node_modules is missing. Run npm ci in web/ first." >&2
  exit 1
fi

echo "Vitest coverage"
(cd "$root/web" && npm run coverage)
