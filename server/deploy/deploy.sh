#!/usr/bin/env bash
# Deploys commit $2 of the repository cloned in $1, on the server (docs/09).
# Sent through SSH by .github/workflows/deploy-server.yml; can also be run by hand:
#   bash server/deploy/deploy.sh ~/meche "$(git rev-parse origin/master)"
set -euo pipefail

repo_dir="$1"
commit="$2"
php_fpm_service="${PHP_FPM_SERVICE:-php8.5-fpm}"

cd "$repo_dir"
echo "→ Code: $commit"
git fetch --quiet origin master
git checkout --quiet master
git reset --quiet --hard "$commit"

cd server
echo "→ Dependencies"
composer install --no-dev --optimize-autoloader --no-interaction --no-progress
echo "→ Database"
php artisan migrate --force
echo "→ Caches (config, routes, events)"
php artisan optimize
echo "→ PHP-FPM reload (fresh OPcache)"
sudo -n systemctl reload "$php_fpm_service"
echo "✓ Deployed"
