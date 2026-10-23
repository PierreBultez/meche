# Mèche — serveur

API Laravel 13 de synchronisation, auto-hébergée sur `https://meche.pierrebultez.com/api`.
Conception : [`docs/04-synchronisation.md`](../docs/04-synchronisation.md) ; déploiement :
[`docs/09-build-et-deploiement.md`](../docs/09-build-et-deploiement.md).

Prérequis : PHP ≥ 8.4.1 (8.5 en production), Composer, MariaDB (ou MySQL).

```bash
composer install
cp .env.example .env          # puis renseigner la base de données
php artisan key:generate
php artisan migrate
php artisan test              # tests Pest (SQLite en mémoire par défaut)
```
