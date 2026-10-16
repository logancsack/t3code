#!/usr/bin/env bash
# Works out what a pipeline has to check from what its commit changes, for the
# jobs in config.yml: writes $1/scope.env, which they source, and the changed
# paths to $1/changed. SCOPE_CHECK, SCOPE_TEST and SCOPE_SERVER say whether the
# job of that name has work; SCOPE_CLIENT whether the Aldo client is built.
#
# A branch is measured from where it left aldo/cloud-platform, so its checks
# cover the whole pull request. A trunk push is measured from the tip it
# replaced (PUSHED_ONTO, CircleCI's pipeline.git.base_revision); a merge whose
# tree is its pull request's head, unchanged, was checked on that branch and
# isn't checked again.
#
# Paths map onto jobs by what they can break. The T3 server depends on
# @t3tools/web only to bundle it, so web changes don't reach the server's
# typecheck or tests. Shared config and dependencies run everything.
set -euo pipefail

out=$1
trunk=aldo/cloud-platform
mkdir -p "$out"
git fetch --quiet origin "+refs/heads/$trunk:refs/remotes/origin/$trunk"

tested=0
if [ "${CIRCLE_BRANCH-}" = "$trunk" ]; then
  base=$(git rev-parse HEAD^1)
  if [ -n "${PUSHED_ONTO-}" ] && git merge-base --is-ancestor "$PUSHED_ONTO" HEAD 2>/dev/null; then
    base=$(git rev-parse "$PUSHED_ONTO")
  fi
  if [ "$base" = "$(git rev-parse HEAD^1)" ] && git rev-parse --quiet --verify HEAD^2 >/dev/null &&
    [ "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD^2^{tree}')" ]; then
    tested=1
  fi
else
  base=$(git merge-base "origin/$trunk" HEAD)
fi
changed=$(git diff --name-only --no-renames "$base" HEAD)

check=0 full=0 test=0 server=0 client=0
packages=()
while IFS= read -r file; do
  [[ -z $file || $file == .repos/* ]] || check=1
  case "$file" in
    # Vendored references: nothing builds, lints or tests them.
    "" | .repos/*) ;;
    package.json | pnpm-lock.yaml | pnpm-workspace.yaml | .npmrc | vite.config.ts | tsconfig*.json | \
      patches/* | .circleci/* | oxlint-plugin-t3code/* | */package.json)
      full=1 ;;
    apps/web/src/*.ts | apps/web/src/*.tsx)
      test=1 packages+=(apps/web) ;;
    # Styles, assets, HTML and Vite's config reach the client's build.
    apps/web/*)
      test=1 client=1 packages+=(apps/web) ;;
    packages/client-runtime/*)
      test=1 packages+=(packages/client-runtime apps/web) ;;
    packages/contracts/* | packages/shared/*)
      test=1 server=1 packages+=(all) ;;
    packages/*)
      test=1 server=1 packages+=("$(cut -d/ -f1-2 <<<"$file")" apps/server) ;;
    # The server's tsconfig and build read scripts/lib.
    apps/server/* | scripts/*)
      server=1 packages+=(apps/server) ;;
    # The server's projection tests import mobile's thread feed.
    apps/mobile/*)
      server=1 ;;
  esac
done <<<"$changed"

# Source that newly imports a stylesheet, an asset or a Vite-only module is
# checked by building the client too.
if [ "$client" = 0 ] && [ "$test" = 1 ] &&
  git diff -U0 "$base" HEAD -- 'apps/web/src/*.ts' 'apps/web/src/*.tsx' |
  grep -Eq '^\+.*(import\.meta\.(glob|env)|\.(css|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|json|wasm)(\?[a-z]+)?["'\'']|\?(url|raw|inline|worker)["'\''])'; then
  client=1
fi

if [ "$full" = 1 ] || [[ " ${packages[*]-} " == *" all "* ]]; then
  typecheck="--filter t3..."
else
  typecheck=$(printf '%s\n' "${packages[@]-}" | sed '/^$/d' | sort -u | sed 's|^|--filter ./|' | paste -sd' ' -)
fi

if [ "$full" = 1 ]; then test=1 server=1 client=1; fi
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
