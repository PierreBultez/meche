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
# The cached config, routes and events go (the application cache, written by www-data only,
# stays: it holds the limits of tries and the scheduler's lock).
php artisan config:clear
php artisan route:clear
php artisan event:clear
php artisan migrate --force
echo "→ Caches (config, routes, events)"
# umask 027: bootstrap/cache/config.php holds the database password and APP_KEY; readable by
# its owner and the www-data group only (setgid folder), like .env.
(umask 027 && php artisan optimize)
# PHP-FPM reads it through the www-data group (setgid folder): without it, every request would
# fail; the API then stays in maintenance.
if [[ "$(stat -c %G bootstrap/cache/config.php)" != "www-data" ]]; then
  echo "bootstrap/cache/config.php is not in the www-data group (setgid missing on bootstrap/cache?)" >&2
  exit 1
fi
echo "→ PHP-FPM reload (fresh OPcache)"
sudo -n systemctl reload "$php_fpm_service"
php artisan up
echo "✓ Deployed"
