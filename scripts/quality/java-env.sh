#!/usr/bin/env bash
# Install sibling Nds4j and set MVN_NDS4J. The Central 1.0.0 jar does not compile this tree.

prepare_nds4j() {
  local root="$1"
  local dir=""
  if [[ -n "${NDS4J_DIR:-}" && -f "$NDS4J_DIR/pom.xml" ]]; then
    dir="$NDS4J_DIR"
  elif [[ -f "$root/../Nds4j/pom.xml" ]]; then
    dir="$(cd "$root/../Nds4j" && pwd)"
  fi

  MVN_NDS4J=()

  if [[ -z "$dir" ]]; then
    echo "Nds4j checkout not found. Set NDS4J_DIR to a current Nds4j clone." >&2
    return 1
  fi

  echo "Installing Nds4j from $dir"
  mvn -B -ntp -f "$dir/pom.xml" -DskipTests install

  local version
  version="$(mvn -B -ntp -q -f "$dir/pom.xml" help:evaluate -Dexpression=project.version -DforceStdout | tail -n 1 | tr -d '[:space:]')"
  # Not exported: bash 3.2 drops an array that was exported from a function.
  MVN_NDS4J=(-Dnds4j.version="$version")
  echo "Nds4j version $version"
}

maven_poms() {
  local root="$1"
  find "$root" -name pom.xml \
    -not -path '*/target/*' \
    -not -path '*/.quality/*' \
    -not -path '*/Nds4j/*' | sort
}
