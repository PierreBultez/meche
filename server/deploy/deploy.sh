#!/usr/bin/env bash
# Deploys commit $2 of the repository cloned in $1, on the server (docs/09).
# Run by server/deploy/forced-command.sh (the deploy key of GitHub Actions can run nothing
# else), or by hand: bash server/deploy/deploy.sh /var/www/meche "$(git rev-parse origin/master)"
set -euo pipefail

repo_dir="$1"
commit="$2"
php_fpm_service="${PHP_FPM_SERVICE:-php8.5-fpm}"

cd "$repo_dir/server"
# Devices get 503 meanwhile: they retry later, nothing is lost (docs/04). If a step fails, the
# API stays in maintenance: better than new code running on an old database.
php artisan down --retry=30 || true

echo "→ Code: $commit"
git fetch --quiet origin master
git checkout --quiet master
git reset --quiet --hard "$commit"

echo "→ Dependencies"
composer install --no-dev --optimize-autoloader --no-interaction --no-progress
echo "→ Database"
php artisan optimize:clear
php artisan migrate --force
echo "→ Caches (config, routes, events)"
php artisan optimize
echo "→ PHP-FPM reload (fresh OPcache)"
sudo -n systemctl reload "$php_fpm_service"
php artisan up
echo "✓ Deployed"
