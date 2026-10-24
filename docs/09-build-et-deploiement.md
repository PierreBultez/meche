# 09 — Environnement, builds, déploiement et installation

> Pierre n'a jamais développé ni installé d'application mobile hors store. Cette partie doit être accompagnée **pas à pas** par Claude Code au moment de la phase concernée : expliquer chaque commande avant de la lancer et vérifier le résultat avec lui.

## 1. Environnement de développement (Ubuntu 26.10)

Suivre la page « Prerequisites » de la documentation officielle Tauri 2 au moment de l'installation (les noms de paquets peuvent évoluer). Pour Linux, à titre indicatif :

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

# Rust
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
. "$HOME/.cargo/env"          # ou ouvrir un nouveau terminal
rustc --version && cargo --version

# Node.js LTS (déjà présent chez Pierre normalement)
node -v && npm -v
```

Versions minimales (vérifiées en phase 0) :
- **Rust ≥ 1.95** (`rust-version` dans `app/src-tauri/Cargo.toml`, imposé par `rusqlite_migration`). `rustup` installe `clippy` et `rustfmt` avec le profil par défaut.
- **Node.js ≥ 22.12**, de préférence une version **LTS** (24) : les versions impaires comme la 25 n'ont pas de support long terme, et Vitest 5 ne déclare pas les prendre en charge (`^22.12 || ^24 || >=26`). La CI utilise Node 24.

### Android (phase 5)
1. Installer **Android Studio** (le plus simple pour obtenir SDK, NDK et émulateur).
2. Dans le SDK Manager : Android SDK Platform (version recommandée par Tauri), Platform-Tools, Build-Tools, Command-line Tools, **NDK (Side by side)**.
3. JDK : utiliser celui fourni avec Android Studio (`JAVA_HOME`).
4. Variables dans `~/.bashrc` (ou config Warp) : `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`.
5. Cibles Rust :
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
6. `npm run tauri android init` puis `npm run tauri android dev` (émulateur ou téléphone branché en USB avec le débogage USB activé).
7. **TLS de la synchro** (relevé en phase 3) : reqwest vérifie les certificats avec `rustls-platform-verifier`, qui doit être initialisé sur Android (appel JNI au démarrage et composant Kotlin ajouté au projet Gradle, voir sa documentation). Sans cela, la première requête HTTPS fait planter l'application. Alternative : sur Android seulement, des racines fournies à reqwest (`tls_certs_only`), en vérifiant leur licence (règle 3).

## 2. Initialisation du projet

```bash
npm create tauri-app@latest app   # Vue + TypeScript, npm
cd app && npm run tauri dev
```
Le serveur Laravel est créé en **phase 3** (en phase 0, `server/` ne contient qu'un README). `composer create-project` refuse un dossier non vide : créer le projet dans un dossier temporaire puis déplacer son contenu dans `server/` (ou supprimer d'abord `server/README.md`), avec Laravel 13, puis `php artisan install:api` (Sanctum).

Nom affiché : **Mèche**. Identifiant d'application : `fr.pierrebultez.meche` (**ne plus le changer** une fois l'application Android installée : il identifie l'application et ses données). Nom du binaire / paquet : `meche`.

Un nom de paquet Debian ne peut pas contenir d'accent : `app/src-tauri/tauri.linux.conf.json` fixe donc le nom technique `meche` sous Linux (paquet `meche_x.y.z_amd64.deb`), et `app/src-tauri/linux/meche.desktop` garde « Mèche » comme nom affiché dans le menu des applications.

## 3. Serveur (API Laravel)

Mis en place en phase 3. Le VPS de Pierre : Ubuntu 26.04, Apache, PHP-FPM 8.5, MariaDB 12.3, Certbot, fail2ban, Composer ; déploiement par `git pull` avec l'utilisateur `pierre`. Les fichiers d'exemple sont dans `server/deploy/`. Aucune adresse IP, aucun mot de passe ni aucune clé n'est écrit dans ce dépôt public : ils vivent sur le serveur (`.env`) et dans les secrets GitHub.

### 3.1 Première installation (à la main, une fois)

Chaque étape est faite avec Claude Code, qui explique les commandes avant que Pierre les lance et vérifie le résultat.

1. **DNS** : une entrée `A` `meche.pierrebultez.com` vers l'adresse IPv4 du VPS (et `AAAA` s'il a une IPv6). Vérifier : `dig +short meche.pierrebultez.com`.
2. **Paquets PHP** : `php8.5-fpm php8.5-cli php8.5-mysql php8.5-mbstring php8.5-xml php8.5-curl php8.5-zip` (Laravel 13 demande PHP ≥ 8.3 ; Composer résout pour 8.4.1 au moins).
3. **Base MariaDB dédiée et utilisateur dédié**, limité à cette base :
   ```sql
   CREATE DATABASE meche CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'meche'@'localhost' IDENTIFIED BY '…mot de passe généré…';
   GRANT ALL PRIVILEGES ON meche.* TO 'meche'@'localhost';
   ```
4. **Le code** : clone public dans `/var/www/meche` (seul `server/` est utile sur le serveur : `git sparse-checkout set server`). Propriétaire `pierre`, groupe `www-data` ; `storage/` et `bootstrap/cache/` modifiables par le groupe, avec le bit setgid pour que les nouveaux fichiers gardent le groupe (`chmod -R g+rwX` puis `find … -type d -exec chmod g+s {} +`). Les journaux sont créés en `0664` (`config/logging.php`) : `pierre` (déploiement) et `www-data` (PHP-FPM, cron) y écrivent tous les deux. Le cache de l'application (limites d'essais, verrou du planificateur) n'est écrit que par `www-data` : pas de permission imposée (Laravel la donnerait aussi aux dossiers qu'il crée, et `0664` sans bit d'exécution rendrait le cache inutilisable : toutes les routes répondraient 500).
5. **`.env`** : copie de `.env.example` (`APP_ENV=production`, `APP_DEBUG=false`, `DB_CONNECTION=mariadb`, `CACHE_STORE=file`, `SESSION_DRIVER=array`), mot de passe de la base, puis `php artisan key:generate`. `chmod 640`, groupe `www-data`.
6. `composer install --no-dev --optimize-autoloader`, `php artisan migrate --force`, `php artisan optimize`, puis **le premier compte** : `php artisan notes:create-user` (une phrase de passe générée par le gestionnaire de mots de passe : 12 caractères au moins, 72 octets au plus).
7. **PHP-FPM** : `server/deploy/php-fpm-meche.ini` dans `/etc/php/8.5/fpm/conf.d/90-meche.ini` (`post_max_size = 16M`, `memory_limit = 256M`, `expose_php = Off`, OPcache), puis `sudo systemctl reload php8.5-fpm`.
8. **Apache** : modules `proxy_fcgi`, `setenvif`, `rewrite`, `deflate` ; vhost `server/deploy/apache-meche.conf` (DocumentRoot = `server/public` exactement : `.env`, le code et `.git` restent hors d'atteinte ; `LimitRequestBody` 20 Mo ; `AddOutputFilterByType DEFLATE application/json`). Dans `/etc/apache2/conf-available/security.conf` : `ServerTokens Prod`, `ServerSignature Off`.
9. **Certificat** : `sudo certbot --apache -d meche.pierrebultez.com` (Certbot crée le vhost HTTPS et la redirection 80 → 443).
10. **Vérification** : `curl -s https://meche.pierrebultez.com/api/health` répond `{"ok":true,…}` ; `curl -sI` montre l'en-tête `Server-Timing` (temps passé dans PHP).
11. **Planificateur** (`notes:maintenance` toutes les 10 minutes), dans la crontab de `www-data` (`sudo crontab -u www-data -e`), le même utilisateur que PHP-FPM :
    ```
    * * * * * cd /var/www/meche/server && php artisan schedule:run >> /dev/null 2>&1
    ```
12. **fail2ban** : `server/deploy/fail2ban-filter.conf` → `/etc/fail2ban/filter.d/meche.conf`, `server/deploy/fail2ban-jail.conf` → `/etc/fail2ban/jail.d/meche.conf`. L'API écrit chaque échec de connexion ou de code d'invitation dans `storage/logs/auth.log` (un seul fichier, que fail2ban suit) ; 10 échecs en une heure bannissent l'adresse un jour. La prison impose `backend = auto` : Ubuntu met `backend = systemd` par défaut, qui ignorerait le fichier. Vérifier :
    - le filtre : `fail2ban-regex /var/www/meche/server/storage/logs/auth.log /etc/fail2ban/filter.d/meche.conf` doit compter des lignes « matched » après un mauvais mot de passe ;
    - la prison : `sudo fail2ban-client status meche` doit citer `auth.log` dans « File list ».
13. **Rotation des journaux** : `server/deploy/logrotate-meche` → `/etc/logrotate.d/meche` (chaque semaine, 8 semaines gardées, `copytruncate` pour que PHP et fail2ban continuent sur le même fichier).

### 3.2 Déploiement automatique (GitHub Actions)

`.github/workflows/deploy-server.yml` : déclenché par un push sur **`master`** touchant `server/**` (ou à la main depuis l'onglet Actions) → tests (Pint, Pest sur PHP 8.5 et MariaDB 12.3, licences Composer) → connexion SSH au serveur.

- **Une clé SSH dédiée au déploiement** (pas la clé personnelle de Pierre), dont la ligne dans `~/.ssh/authorized_keys` impose une commande :
  ```
  restrict,command="/home/pierre/bin/meche-deploy" ssh-ed25519 AAAA… meche-deploy
  ```
  `/home/pierre/bin/meche-deploy` est une copie de `server/deploy/forced-command.sh` : il lit l'identifiant de commit envoyé par GitHub, vérifie qu'il est déjà sur `origin/master` **et qu'il suit le commit déployé** (jamais de retour en arrière, même en relançant un ancien workflow), attend la fin d'un autre déploiement s'il y en a un (verrou `flock`), puis lance le `server/deploy/deploy.sh` de ce commit. Une clé volée ne peut donc rien faire d'autre que déployer du code déjà sur `master`, plus récent que celui en place.
- **`deploy.sh`** : mode maintenance (`artisan down`, les appareils reçoivent 503 et réessaient), `git reset --hard` sur le commit, `composer install --no-dev -o`, effacement des caches de configuration, routes et événements (pas le cache de l'application, écrit par `www-data`), `migrate --force`, `optimize` avec `umask 027` (`bootstrap/cache/config.php` contient le mot de passe de la base et `APP_KEY` : lisible seulement par `pierre` et le groupe `www-data`, comme `.env`), rechargement de PHP-FPM, `artisan up`. Si une étape échoue, l'API reste en maintenance plutôt que de servir du code neuf sur une base ancienne.
- **sudo** : une seule commande autorisée sans mot de passe, dans `/etc/sudoers.d/meche-deploy` : `pierre ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.5-fpm`.
- **Secrets GitHub** (environnement `production`, limité à la branche `master` dans Settings › Environments) : `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (clé privée de déploiement), `DEPLOY_KNOWN_HOSTS` (sortie de `ssh-keyscan -p <port> <hôte>`, l'identité du serveur). Le job de déploiement ne tourne de toute façon que sur `master`.

### 3.3 Sauvegardes et restauration

- Sauvegarde quotidienne de la base (`mariadb-dump --single-transaction meche`), hors du serveur. Les notes ne sont pas chiffrées : la sauvegarde non plus.
- **Après une restauration** : `php artisan notes:rotate-sync-ids`. Les appareils connaissent des révisions que la base restaurée a perdues ; avec une nouvelle identité de synchro, chacun renvoie toutes ses notes et retélécharge tout à sa prochaine synchro (`04-synchronisation.md`, « Identité du serveur »).

### 3.4 Administration

Commandes artisan (`04-synchronisation.md`) : `notes:users`, `notes:devices`, `notes:revoke-device`, `notes:reset-password`, `notes:delete-user`, `notes:create-user`, `notes:rotate-sync-ids`.

## 4. Releases des applications (GitHub Actions)

Workflow `release.yml` déclenché par un tag `v*` (ex. `v0.3.0`), qui crée une GitHub Release avec :

| Job | Runner | Artefacts |
|---|---|---|
| Linux | `ubuntu-22.04` (ancienne glibc = compatible avec plus de distributions) | `.deb` uniquement (décidé) |
| Windows | `windows-latest` | `.msi` et/ou `-setup.exe` (NSIS) |
| Android | `ubuntu-latest` + SDK/NDK | `.apk` signé (universel ou arm64) |

- Desktop : action officielle `tauri-apps/tauri-action`.
- Version unique dans `app/src-tauri/tauri.conf.json`, incrémentée à chaque release (le `versionCode` Android en découle et doit toujours augmenter, sinon la mise à jour est refusée).

### Visibilité du dépôt : **public** (décidé)
- Le code est visible, mais les notes ne sont jamais dans le dépôt. Les mises à jour desktop (`latest.json` dans les GitHub Releases) et Obtainium fonctionnent sans configuration.
- Conséquence : **aucun secret dans le code**. Clés de signature, mots de passe, `.env` et token de déploiement passent uniquement par les secrets GitHub Actions. Vérifier le `.gitignore` avant le premier push.

## 5. Signature et mises à jour

### Android : signer l'APK (obligatoire pour l'installer)
1. Générer une clé une seule fois :
   ```bash
   keytool -genkey -v -keystore meche-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias meche
   ```
2. **Sauvegarder ce fichier et son mot de passe en lieu sûr** (gestionnaire de mots de passe + sauvegarde). Si la clé est perdue, les mises à jour ne pourront plus s'installer par-dessus l'application existante : il faudra désinstaller, ce qui efface les données locales non synchronisées.
3. Ne jamais committer la clé. La CI la reçoit via des secrets GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) et la configure dans `src-tauri/gen/android` (`keystore.properties`, voir la doc Tauri « Android code signing »).

### Desktop : mises à jour automatiques
- `tauri-plugin-updater` : au démarrage, vérifie un manifeste `latest.json` (publié dans la Release par `tauri-action`), propose la mise à jour.
- Nécessite une paire de clés de signature du programme de mise à jour (`npm run tauri signer generate`). La clé privée va dans les secrets GitHub (`TAURI_SIGNING_PRIVATE_KEY`, et son mot de passe).
- Pas de certificat de signature de code Windows (payant) : au premier lancement, Windows SmartScreen affiche un avertissement → « Informations complémentaires » → « Exécuter quand même ». C'est normal.

## 6. Installer l'application sur Android sans le Play Store

Deux méthodes :

**A. Obtainium (recommandée, mises à jour automatiques)**
1. Installer Obtainium sur le téléphone (APK depuis sa page GitHub officielle, ou via F-Droid).
2. Autoriser Obtainium à installer des applications (Android le demande la première fois : « Installer des applis inconnues »).
3. Dans Obtainium : « Ajouter une application » → coller l'URL du dépôt GitHub de Mèche.
4. Obtainium télécharge le dernier `.apk` des Releases et l'installe. Il prévient à chaque nouvelle version.

**B. Câble USB (développement, ou si A est bloqué)**
1. Activer les options développeur (appuyer 7 fois sur « Numéro de build ») puis le débogage USB.
2. `adb install -r app-release.apk` depuis le PC.

**Point de vigilance** : Google déploie une vérification d'identité des développeurs, y compris pour les applications installées hors Play Store. Au moment de la phase 5, Claude Code doit **vérifier l'état actuel de cette règle** (calendrier pour la France, compte gratuit « loisir », exception pour `adb`) et adapter la méthode d'installation.

## 7. Installer sur les PC

- **Ubuntu** : `sudo apt install ./meche_x.y.z_amd64.deb`. Format Linux retenu : **`.deb` uniquement**.
  - Mises à jour : au moment de la phase 6, vérifier dans la documentation de `tauri-plugin-updater` si l'installation automatique d'un `.deb` est prise en charge.
  - Si oui : l'utiliser comme sur Windows.
  - Si non : au démarrage, l'application compare sa version à la dernière GitHub Release et affiche « Nouvelle version disponible » avec un bouton qui télécharge le `.deb` ; l'installation se fait avec `sudo apt install ./meche_….deb`. Ne pas réintroduire l'AppImage sans l'accord de Pierre.
- **Windows** : lancer le `.msi` ou le `-setup.exe`, accepter l'avertissement SmartScreen la première fois. Mises à jour intégrées.
