#!/usr/bin/env bash
# Run PIT and Stryker, then the score ratchet. QUALITY_MODE is changed or full.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source-path=SCRIPTDIR
# shellcheck source=java-env.sh
source "$root/scripts/quality/java-env.sh"

mode="${QUALITY_MODE:-${1:-full}}"
base="${QUALITY_BASE:-${2:-origin/main}}"
if [[ "$mode" != "changed" && "$mode" != "full" ]]; then
  echo "mode must be changed or full" >&2
  exit 2
fi

java_globs=()
ts_files=()
if [[ "$mode" == "changed" ]]; then
  while IFS= read -r file; do
    case "$file" in
      */src/main/java/*.java)
        qualified="${file#*/src/main/java/}"
        qualified="${qualified%.java}"
        java_globs+=("${qualified//\//.}*")
        ;;
      web/src/*.ts|web/src/*.tsx)
        case "$file" in
          *.d.ts|*.test.ts|*.test.tsx) ;;
          *) ts_files+=("${file#web/}") ;;
        esac
        ;;
    esac
  done < <(git -C "$root" diff --name-only "${base}...HEAD")
fi

run_java=0
run_ts=0
if [[ "$mode" == "full" ]]; then
  run_java=1
  run_ts=1
fi
if [[ ${#java_globs[@]} -gt 0 ]]; then
  run_java=1
fi
if [[ ${#ts_files[@]} -gt 0 ]]; then
  run_ts=1
fi

if [[ "$run_java" -eq 1 ]]; then
  prepare_nds4j "$root"
  while IFS= read -r pom; do
    echo "PIT: $pom"
    # pitest reads target/classes and does not compile on its own.
    if [[ "$mode" == "changed" ]]; then
      joined="$(IFS=,; echo "${java_globs[*]}")"
      mvn -B -ntp -f "$pom" "${MVN_NDS4J[@]}" test-compile org.pitest:pitest-maven:mutationCoverage \
        -DtargetClasses="$joined"
    else
      mvn -B -ntp -f "$pom" "${MVN_NDS4J[@]}" test-compile org.pitest:pitest-maven:mutationCoverage
    fi
  done < <(maven_poms "$root")
fi

if [[ "$run_ts" -eq 1 ]]; then
  if [[ ! -d "$root/web/node_modules" ]]; then
    echo "web/node_modules is missing. Run npm ci in web/ first." >&2
    exit 1
  fi

  echo "Stryker"
  if [[ "$mode" == "changed" ]]; then
    joined="$(IFS=,; echo "${ts_files[*]}")"
    # An untested changed file should not fail the pull request.
    (cd "$root/web" && npx stryker run --mutate "$joined" --allowEmpty)
  else
    (cd "$root/web" && npx stryker run)
  fi
fi

export PYTHONPATH="$root/scripts/quality${PYTHONPATH:+:$PYTHONPATH}"
if [[ "${QUALITY_WRITE:-}" == "1" ]]; then
  exec python3 "$root/scripts/quality/check_mutation.py" --root "$root" --write
fi
exec python3 "$root/scripts/quality/check_mutation.py" --root "$root" --scope "$mode" --base "$base"
