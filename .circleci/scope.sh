#!/usr/bin/env bash
# Works out what a pipeline has to check from what its commit changes, for the
# jobs in config.yml: writes $1/scope.env, which they source, and the changed
# paths to $1/changed. SCOPE_CHECK, SCOPE_TEST and SCOPE_SERVER say whether the
# job of that name has work; SCOPE_CLIENT whether the Aldo client is built.
#
# A branch is measured from where it left aldo/cloud-platform, so its checks
# cover the whole pull request. CircleCI's GitHub App pipelines don't say which
# commit a trunk push replaced, so a merge commit is measured from its first
# parent, the tip it was merged onto, and any other push is checked in full. A
# merge whose tree is its pull request's head, unchanged, was checked on that
# branch and isn't checked again.
#
# Paths map onto jobs by what they can break. The T3 server depends on
# @t3tools/web only to bundle it, so web changes don't reach the server's
# typecheck; the few server tests that import client code run with the test
# job's, by what their imports reach. Shared config and dependencies run
# everything.
set -euo pipefail

out=$1
trunk=aldo/cloud-platform
mkdir -p "$out"
git fetch --quiet origin "+refs/heads/$trunk:refs/remotes/origin/$trunk"

check=0 full=0 test=0 server=0 client=0 tested=0
packages=()
if [ "${CIRCLE_BRANCH-}" = "$trunk" ]; then
  base=$(git rev-parse HEAD^1)
  if ! git rev-parse --quiet --verify HEAD^2 >/dev/null; then
    full=1
  elif [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD^2^{tree}')" ]; then
    tested=1
  fi
else
  base=$(git merge-base "origin/$trunk" HEAD)
fi
changed=$(git diff --name-only --no-renames "$base" HEAD)

while IFS= read -r file; do
  [[ -z $file || $file == .repos/* ]] || check=1
  case "$file" in
    # Vendored references: nothing builds, lints or tests them.
    "" | .repos/*) ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .npmrc | vite.config.ts | tsconfig*.json | \
      patches/* | .circleci/* | oxlint-plugin-t3code/* | */package.json)
      full=1 ;;
    # Tests aren't in the client's bundle.
    apps/web/src/*.test.ts | apps/web/src/*.test.tsx)
      test=1 packages+=(apps/web) ;;
    # Anything else the web app or client-runtime holds can reach the client, and an
    # import can grow the home screen's first download, which the build is held to
    # (apps/web/scripts/check-first-screen-size.ts). When only styles and assets
    # built it, a source change over the budget was found when Aldo pinned the client.
    apps/web/* | third-party-licenses.config.json)
      test=1 client=1 packages+=(apps/web) ;;
    packages/client-runtime/*)
      test=1 client=1 packages+=(packages/client-runtime apps/web) ;;
    packages/contracts/* | packages/shared/*)
      test=1 server=1 packages+=(all) ;;
    packages/*)
      test=1 server=1 packages+=("$(cut -d/ -f1-2 <<<"$file")" apps/server) ;;
    # The server's tsconfig and build read scripts/lib, and its build the icons in assets/.
    apps/server/* | scripts/* | assets/*)
      server=1 packages+=(apps/server) ;;
    # The server's projection tests import mobile's thread feed.
    apps/mobile/*)
      test=1 ;;
  esac
done <<<"$changed"

if [ "$full" = 1 ] || [[ " ${packages[*]-} " == *" all "* ]]; then
  typecheck="--filter t3..."
else
  typecheck=$(printf '%s\n' "${packages[@]-}" | sed '/^$/d' | sort -u | sed 's|^|--filter ./|' | paste -sd' ' -)
fi

if [ "$full" = 1 ]; then test=1 server=1 client=1; fi
# The server's build bundles the client, so it builds both.
if [ "$server" = 1 ]; then client=1; fi
if [ "$tested" = 1 ]; then check=0 test=0 server=0 client=0; fi

printf '%s\n' "$changed" | sed '/^$/d' > "$out/changed"
cat > "$out/scope.env" <<EOF
export SCOPE_BASE=$base
export SCOPE_FULL=$full
export SCOPE_TYPECHECK="$typecheck"
export SCOPE_CHECK=$check
export SCOPE_TEST=$test
export SCOPE_SERVER=$server
export SCOPE_CLIENT=$client
EOF

echo "$(wc -l < "$out/changed") file(s) changed since $(git rev-parse --short "$base")."
if [ "$tested" = 1 ]; then
  echo "This merge is its pull request's head, unchanged, so it was checked there."
fi
cat "$out/scope.env"
