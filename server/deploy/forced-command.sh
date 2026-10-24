#!/usr/bin/env bash
# The only thing the deploy key can do (docs/09). Installed on the server as
# ~/bin/meche-deploy and named in ~/.ssh/authorized_keys:
#   restrict,command="/home/pierre/bin/meche-deploy" ssh-ed25519 AAAA… meche-deploy
# GitHub Actions connects with that key and sends a commit id; whatever else it sends is
# ignored. The commit must already be on origin/master and come after the deployed one: a
# stolen key (or a re-run of an old workflow) can neither run a command of its own nor bring
# back older code over a newer database.
set -euo pipefail
# `git fetch` writes into .git: with Ubuntu's default umask (002) its files would be writable by
# the www-data group (PHP of every site on the server), which could then plant a hook or a
# setting run as pierre. The code is written by pierre only (docs/09, step 4).
umask 022

repo_dir="${MECHE_REPO:-/var/www/meche}"
commit="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: ssh <host> <commit id (40 hex characters)>" >&2
  exit 2
fi

cd "$repo_dir"
# One deployment at a time: a second one waits for the first (5 minutes at most).
exec 9>"$HOME/.meche-deploy.lock"
flock -w 300 9 || { echo "refused: another deployment is running" >&2; exit 4; }

git fetch --quiet origin master
if ! git merge-base --is-ancestor "$commit" origin/master; then
  echo "refused: $commit is not on origin/master" >&2
  exit 3
fi
if ! git merge-base --is-ancestor HEAD "$commit"; then
  echo "refused: $commit does not follow the deployed $(git rev-parse --short HEAD)" >&2
  exit 5
fi

# The deployment script of that commit (it is on master, so it was reviewed), run from a
# string rather than through a pipe: a step reading its input cannot swallow the next ones.
# Read on its own line first: `set -e` stops here if it cannot be read (an empty script would
# "succeed" without deploying anything).
script="$(git show "$commit:server/deploy/deploy.sh")"
if [[ -z "$script" ]]; then
  echo "refused: no server/deploy/deploy.sh in $commit" >&2
  exit 6
fi
bash -c "$script" deploy "$repo_dir" "$commit" < /dev/null
