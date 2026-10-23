#!/usr/bin/env bash
# The only thing the deploy key can do (docs/09). Installed on the server as
# ~/bin/meche-deploy and named in ~/.ssh/authorized_keys:
#   restrict,command="/home/pierre/bin/meche-deploy" ssh-ed25519 AAAA… meche-deploy
# GitHub Actions connects with that key and sends a commit id; whatever else it sends is
# ignored. The commit must already be on origin/master: a stolen key can only redeploy code
# that is on master, never run a command of its own.
set -euo pipefail

repo_dir="${MECHE_REPO:-/var/www/meche}"
commit="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: ssh <host> <commit id (40 hex characters)>" >&2
  exit 2
fi

cd "$repo_dir"
git fetch --quiet origin master
if ! git merge-base --is-ancestor "$commit" origin/master; then
  echo "refused: $commit is not on origin/master" >&2
  exit 3
fi

# The deployment script of that commit (it is on master, so it was reviewed).
git show "$commit:server/deploy/deploy.sh" | bash -s -- "$repo_dir" "$commit"
