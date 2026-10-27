# 09 — Environnement, builds, déploiement et installation

> Pierre n'a jamais développé ni installé d'application mobile hors store. Cette partie doit être accompagnée **pas à pas** par l'agent au moment de la phase concernée : expliquer chaque commande avant de la lancer et vérifier le résultat avec lui.

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
7. **TLS de la synchro** (relevé en phase 3, choix confirmé en phase 5) : conserver la vérification des certificats du système par `rustls-platform-verifier`. L'initialiser par JNI avant toute requête HTTPS et ajouter son composant Kotlin au projet Gradle. Sans cela, la première requête HTTPS peut faire planter l'application. La version verrouillée **0.7.1** utilise le composant Android **0.2.0**, désormais distribué par un dépôt Maven hébergé sur GitHub ; suivre la [documentation officielle](https://github.com/rustls/rustls-platform-verifier#android) et les [instructions de migration 0.7.1](https://github.com/rustls/rustls-platform-verifier/releases/tag/v%2F0.7.1).

**Décisions préparatoires validées avec Pierre le 27/10/2026** (mise en œuvre à venir ; aucune installation ni aucun essai Android encore validé avec lui) :

- Suivre les [prérequis officiels Tauri 2](https://v2.tauri.app/start/prerequisites/#android). Le CLI verrouillé est en **2.12.4** ; les versions exactes de Studio, du JDK, du SDK et du NDK seront consignées après l'installation guidée. `NDK_HOME` désignera une version précise, même si plusieurs NDK sont installés.
- Déclarer directement, pour Android seulement, `rustls-platform-verifier` **0.7.1**, `jni` **0.22.4** et `tauri-plugin-fs` **2.7.1**, déjà présents indirectement dans `Cargo.lock`. Leurs paquets officiels et le composant Android **0.2.0** déclarent **MIT OU Apache-2.0** (règle 3). Aucun ajout npm prévu. Vérifier aussi les dépendances Gradle, que le contrôle actuel des licences npm/Cargo ne couvre pas.
- Committer les sources et configurations utiles de `app/src-tauri/gen/android` (Kotlin, manifests, ressources, Gradle et wrapper), sans caches, builds, chemins locaux ni fichiers de signature.
- Développer et signer l'APK définitif **en local**. Prévoir une CI Android qui compile un APK de test signé avec une clé de débogage, sans recevoir la clé définitive de Pierre. `release.yml` reste en phase 6.
- Import : ouvrir l'URI `content://` choisie via l'API Rust de `tauri-plugin-fs`, sans transmettre de chemin au frontend ni lui donner de permission de lecture. Pour un ZIP dont le fournisseur ne permet pas l'accès aléatoire, prévoir une copie temporaire bornée dans le cache privé, supprimée après usage. La [documentation du sélecteur](https://docs.rs/crate/tauri-plugin-dialog/2.8.3/source/src/lib.rs) recommande le greffon de fichiers pour ces URI.
- Lire le JSON de manière typée, élément par élément, en ne conservant que les champs utiles des notes et les comptes des autres éléments. Plafond Android initial : **16 Mio**, pour l'archive comme pour le budget cumulé du JSON décompressé ; conserver 64 Mio sur desktop. Une sauvegarde plus grosse sera refusée sur Android ; ne relever ce plafond qu'après mesure de la mémoire.
- Essais avec des notes inventées, un compte de test et des profils locaux vierges **sur le PC et le téléphone**. Un profil existant ne doit pas être connecté au compte de test : ses notes lui seraient envoyées. Réserver le compte personnel à la vérification finale accompagnée, après les essais et revues.
- Permission réseau seule ; accès ponctuel au fichier choisi sans permission générale de stockage. Aucune télémétrie. Exclure notes, jeton et fichiers temporaires des sauvegardes automatiques Android vers le cloud, avec les règles adaptées aux versions Android ([documentation Android](https://developer.android.com/identity/data/autobackup)).
- Pierre génère lui-même la clé de signature définitive sur son PC, hors dépôt, et sauvegarde la clé et ses mots de passe (§ 5). Ne jamais les demander dans la conversation ni les afficher dans un journal. Passer de l'APK de débogage à l'APK définitif pendant que les profils ne contiennent encore que des données de test : leurs signatures différentes peuvent empêcher une mise à jour directe.
- Distribution retenue pour le moment : **construction du `.apk`, puis installation USB**. Obtainium est différé à une sous-phase dédiée (§ 6), avec explication de son intérêt et décisions de Pierre avant toute configuration.

## 2. Initialisation du projet

```bash
npm create tauri-app@latest app   # Vue + TypeScript, npm
cd app && npm run tauri dev
```
Le serveur Laravel est créé en **phase 3** (en phase 0, `server/` ne contient qu'un README). `composer create-project` refuse un dossier non vide : créer le projet dans un dossier temporaire puis déplacer son contenu dans `server/` (ou supprimer d'abord `server/README.md`), avec Laravel 13, puis `php artisan install:api` (Sanctum).

Nom affiché : **Mèche**. Identifiant d'application : `fr.pierrebultez.meche` (**ne plus le changer** une fois l'application Android installée : il identifie l'application et ses données). Nom du binaire / paquet : `meche`.

Un nom de paquet Debian ne peut pas contenir d'accent : `app/src-tauri/tauri.linux.conf.json` fixe donc le nom technique `meche` sous Linux (paquet `meche_x.y.z_amd64.deb`), et `app/src-tauri/linux/meche.desktop` garde « Mèche » comme nom affiché dans le menu des applications.

## 3. Serveur (API Laravel)

Mis en place en phase 3. Le VPS de Pierre : Ubuntu 26.04, Nginx, PHP-FPM 8.5, MariaDB 12.3, Certbot, fail2ban, Composer ; déploiement par `git pull` avec l'utilisateur `pierre` ; l'API tourne sous son propre utilisateur, `meche`. Les fichiers d'exemple sont dans `server/deploy/`. Aucune adresse IP, aucun mot de passe ni aucune clé n'est écrit dans ce dépôt public : ils vivent sur le serveur (`.env`) et dans les secrets GitHub.

### 3.1 Première installation (à la main, une fois)

Chaque étape est faite avec Claude Code, qui explique les commandes avant que Pierre les lance et vérifie le résultat. Les fichiers de `server/deploy/` sont installés avec `sudo install -m 0644 -o root -g root <source> <destination>` (propriétaire et droits explicites, plutôt qu'un `cp`). Installation faite le 25/10/2026.

1. **DNS** : une entrée `A` `meche.pierrebultez.com` vers l'adresse IPv4 du VPS (et `AAAA` s'il a une IPv6). Vérifier : `dig +short meche.pierrebultez.com`.
2. **Paquets PHP** : `php8.5-fpm php8.5-cli php8.5-mysql php8.5-mbstring php8.5-xml php8.5-curl php8.5-zip` (Laravel 13 demande PHP ≥ 8.3 ; Composer résout pour 8.4.1 au moins).
3. **Base MariaDB dédiée et utilisateur dédié**, limité à cette base :
   ```sql
   CREATE DATABASE meche CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'meche'@'localhost' IDENTIFIED BY '…mot de passe généré…';
   GRANT ALL PRIVILEGES ON meche.* TO 'meche'@'localhost';
   ```
4. **L'utilisateur et le code** : l'API tourne sous son propre utilisateur système, `meche` (PHP-FPM et planificateur) : les autres sites du serveur tournent en `www-data`, et une faille dans l'un d'eux ne doit donner accès ni au `.env` de Mèche (mot de passe de la base, donc toutes les notes) ni à son cache ou à ses journaux.
    - **Utilisateur** : `sudo useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /usr/sbin/nologin meche`, puis `sudo usermod -aG meche pierre` et se reconnecter (`id` doit citer `meche`). L'inverse est inutile : `meche` n'est dans aucun autre groupe, et `www-data` n'est ni dans le groupe `meche` ni dans le groupe `pierre`.
    - **Clone** public dans `/var/www/meche` (seul `server/` est utile sur le serveur : `git sparse-checkout set server`), **avec `umask 022`** : le code (`.git` compris) n'est modifiable que par `pierre`. Le umask par défaut d'Ubuntu (`002`) le rendrait modifiable par le groupe : un PHP compromis pourrait y glisser du code que `pierre` exécuterait au déploiement (dans `vendor/`, ou un hook de `.git`). `forced-command.sh` et `deploy.sh` imposent aussi `umask 022`.
    - **Droits** : propriétaire `pierre`, groupe `meche` (`chgrp -R meche /var/www/meche`), avec le bit setgid pour que les nouveaux fichiers gardent le groupe. `/var/www/meche` et `server/` en `2751` : les autres utilisateurs, dont Nginx (`www-data`), les traversent jusqu'à `server/public/` sans pouvoir lister leur contenu (le code est de toute façon public sur GitHub). `storage/` modifiable par le groupe et fermé aux autres (`chmod -R g+rwX,o-rwx` puis `find … -type d -exec chmod g+s {} +`). `bootstrap/cache/` en `2750` (lisible par le groupe, modifiable par `pierre` seul) : il contient des fichiers PHP que charge chaque `php artisan`, y compris ceux que `pierre` lance au déploiement, et Laravel n'y écrit qu'au déploiement (`composer install`, `optimize`). `.env` en `0640` (étape 5).
    - Les journaux sont créés en `0660` (`config/logging.php`) : `pierre` (déploiement) et `meche` (PHP-FPM, cron) y écrivent tous les deux. Le cache de l'application (limites d'essais, verrou du planificateur) n'est écrit que par `meche` : pas de permission imposée (Laravel la donnerait aussi aux dossiers qu'il crée, et `0660` sans bit d'exécution rendrait le cache inutilisable : toutes les routes répondraient 500). Les commandes qui touchent ce cache se lancent donc en `meche` : `sudo -u meche php artisan cache:clear`, `sudo -u meche php artisan schedule:run` (ou `schedule:test`).
    - **Vérifier** : rien d'autre que `storage/` n'est modifiable par le groupe (`find /var/www/meche -path /var/www/meche/server/storage -prune -o -perm -g+w ! -type l -print` n'affiche rien ; sinon `chmod -R g-w /var/www/meche`, puis de nouveau `chmod -R g+rwX /var/www/meche/server/storage`) ; `www-data` ne lit rien de secret (`sudo -u www-data ls /var/www/meche/server/storage` et, après l'étape 5, `sudo -u www-data cat /var/www/meche/server/.env` sont refusés).
    - Essayé avec Nginx 1.28, PHP-FPM 8.5 et MariaDB 12.3 (pool de Mèche en `meche`, un autre site en `www-data`) : l'API répond (santé, connexion, synchro, limites d'essais), le planificateur et `notes:maintenance` tournent en `meche`, un déploiement complet par la commande forcée réussit ; le site en `www-data` ne peut ni lister `/var/www/meche` et `storage/`, ni lire `.env`, `auth.log` ou `bootstrap/cache/config.php`, ni écrire dans le code, `bootstrap/cache/` ou `storage/`.
5. **`.env`** : copie de `.env.example` (`APP_ENV=production`, `APP_DEBUG=false`, `DB_CONNECTION=mariadb`, `CACHE_STORE=file`, `SESSION_DRIVER=array`), mot de passe de la base. `chmod 640` ; le groupe `meche` vient du bit setgid de `server/`.
6. `composer install --no-dev --optimize-autoloader`, `php artisan key:generate` (après Composer : `artisan` a besoin de `vendor/`), `php artisan migrate --force`, `(umask 027 && php artisan optimize)` (`bootstrap/cache/config.php` contient le mot de passe de la base et `APP_KEY` : lisible par `pierre` et le groupe `meche` seulement), puis **le premier compte** : `php artisan notes:create-user` (une phrase de passe générée par le gestionnaire de mots de passe : 12 caractères au moins, 72 octets au plus).
7. **PHP-FPM** : un pool dédié, pour ne rien changer aux autres sites servis par PHP 8.5 : `server/deploy/php-fpm-pool-meche.conf` → `/etc/php/8.5/fpm/pool.d/meche.conf` (utilisateur `meche` ; socket `/run/php/php8.5-fpm-meche.sock`, qui appartient à `www-data` pour que Nginx s'y connecte ; processus lancés à la demande, `post_max_size = 16M`, `memory_limit = 256M`, `expose_php` désactivé pour ce pool seulement). OPcache reste réglé globalement (actif par défaut sur Ubuntu), avec une ligne de plus : `server/deploy/php-opcache-isolation.ini` → `/etc/php/8.5/fpm/conf.d/99-opcache-isolation.ini` (`opcache.validate_permission = 1`). OPcache est partagé par tous les pools : sans cette ligne, le PHP d'un autre site peut inclure un fichier de Mèche déjà en cache, comme `bootstrap/cache/config.php`, sans avoir le droit de le lire (essayé : 40 fois sur 40 sans la ligne, jamais avec). Elle vaut pour tous les sites (une vérification de droits par fichier inclus) et protège aussi les autres sites isolés. Puis `sudo php-fpm8.5 -t` (test de la configuration) et `sudo systemctl reload php8.5-fpm` (suffit : le rechargement relit la configuration et vide OPcache).
8. **Nginx** : site `server/deploy/nginx-meche.conf` → `/etc/nginx/sites-available/meche`, lien dans `sites-enabled`, `sudo nginx -t` puis `sudo systemctl reload nginx`. `root` = `server/public` exactement (`.env`, le code et `.git` restent hors d'atteinte ; fichiers cachés refusés, seul `index.php` est exécuté) ; PHP-FPM 8.5 par le socket du pool de Mèche (`/run/php/php8.5-fpm-meche.sock`) ; `client_max_body_size 20m` ; gzip pour `application/json` ; `server_tokens off`. Essayé avec Nginx 1.28 et PHP-FPM 8.5 : routage vers `index.php` avec l'en-tête `Authorization`, réponses compressées, `.env` et `.git` en 403, autre `.php` en 404, requête de 21 Mo refusée (413).
9. **Certificat** : `sudo certbot --nginx -d meche.pierrebultez.com --redirect` (Certbot ajoute HTTPS et la redirection 80 → 443 dans le fichier du site ; il faut le greffon `python3-certbot-nginx`). Le fichier de `sites-available` diffère alors de celui du dépôt : ne plus l'écraser avec la version du dépôt (HTTPS disparaîtrait). Vérifier le renouvellement automatique : `sudo certbot renew --dry-run --cert-name meche.pierrebultez.com`.
10. **Vérification** : `curl -s https://meche.pierrebultez.com/api/health` répond `{"ok":true,…}` ; `curl -sI` montre l'en-tête `Server-Timing` (temps passé dans PHP).
11. **Planificateur** (`notes:maintenance` toutes les 10 minutes), dans la crontab de `meche` (`sudo crontab -u meche -e`), le même utilisateur que PHP-FPM (cron lance la ligne avec `/bin/sh`, le shell `nologin` de `meche` n'y change rien ; vérifier quelques minutes plus tard : `sudo journalctl --since '-5 min' | grep 'CMD (cd /var/www/meche'`, une ligne `(meche) CMD (…)` par minute ; le journal du système demande `sudo`) :
    ```
    * * * * * cd /var/www/meche/server && php artisan schedule:run >> /dev/null 2>&1
    ```
12. **fail2ban** : d'abord créer le journal, que l'API ne crée qu'au premier échec : `sudo install -m 0660 -o pierre -g meche /dev/null /var/www/meche/server/storage/logs/auth.log` (fail2ban refuse de démarrer, prison `sshd` comprise, si le fichier d'une de ses prisons manque : ne jamais le supprimer). Puis `server/deploy/fail2ban-filter.conf` → `/etc/fail2ban/filter.d/meche.conf`, `server/deploy/fail2ban-jail.conf` → `/etc/fail2ban/jail.d/meche.conf`, et `sudo fail2ban-client -t` (test de la configuration) avant `sudo systemctl reload fail2ban`. L'API écrit chaque échec de connexion ou de code d'invitation dans `storage/logs/auth.log` (un seul fichier, que fail2ban suit) ; 10 échecs en une heure bannissent l'adresse un jour. La prison impose `backend = auto`, pour lire le fichier quel que soit le réglage par défaut (`systemd` pour toutes les prisons sur Ubuntu 24.04). Vérifier :
    - le filtre : `fail2ban-regex /var/www/meche/server/storage/logs/auth.log /etc/fail2ban/filter.d/meche.conf` doit compter des lignes « matched » après un mauvais mot de passe ;
    - la prison : `sudo fail2ban-client status meche` doit citer `auth.log` dans « File list » ;
    - de bout en bout : un mauvais mot de passe envoyé **depuis une autre machine** fait passer « Currently failed » à 1. Un essai depuis le serveur lui-même est ignoré (`ignoreself`, réglage par défaut de fail2ban : le serveur ne se bannit jamais).
13. **Rotation du journal des échecs** : `server/deploy/logrotate-meche` → `/etc/logrotate.d/meche` (`auth.log` seulement, chaque semaine, 8 semaines gardées, `su meche meche` puisque le dossier est modifiable par ce groupe, `copytruncate` pour que PHP et fail2ban continuent sur le même fichier). Vérifier : `sudo logrotate -d /etc/logrotate.d/meche` (essai à blanc, sans erreur). Les journaux de Laravel sont des fichiers datés qu'il supprime lui-même.

### 3.2 Déploiement automatique (GitHub Actions)

`.github/workflows/deploy-server.yml` : déclenché par un push sur **`master`** touchant `server/**` (ou à la main depuis l'onglet Actions) → tests (Pint, Pest sur PHP 8.5 et MariaDB 12.3, licences Composer) → connexion SSH au serveur.

- **Une clé SSH dédiée au déploiement** (pas la clé personnelle de Pierre), créée sur le PC de Pierre sans phrase de passe (GitHub Actions ne peut pas en taper : c'est la commande forcée qui la limite) : `ssh-keygen -t ed25519 -f ~/.ssh/meche-deploy -N '' -C meche-deploy`. Sa ligne dans `~/.ssh/authorized_keys` impose une commande ; elle est ajoutée depuis le PC, après une copie de sauvegarde du fichier sur le serveur (`cp -p ~/.ssh/authorized_keys ~/.ssh/authorized_keys.bak`), avec `ssh -p <port> pierre@<hôte> 'cat >> ~/.ssh/authorized_keys' <<< "restrict,command=\"/home/pierre/bin/meche-deploy\" $(cat ~/.ssh/meche-deploy.pub)"` (`>>` : ajouter, jamais `>`) :
  ```
  restrict,command="/home/pierre/bin/meche-deploy" ssh-ed25519 AAAA… meche-deploy
  ```
  `/home/pierre/bin/meche-deploy` est une copie de `server/deploy/forced-command.sh` (`install -m 0755 server/deploy/forced-command.sh ~/bin/meche-deploy`, dans un `~/bin` modifiable par `pierre` seul, comme `~/.ssh`) : il lit l'identifiant de commit envoyé par GitHub, vérifie qu'il est déjà sur `origin/master` **et qu'il suit le commit déployé** (jamais de retour en arrière, même en relançant un ancien workflow), attend la fin d'un autre déploiement s'il y en a un (verrou `flock`), puis lance le `server/deploy/deploy.sh` de ce commit (un script illisible ou absent fait échouer le déploiement, au lieu d'un succès sans rien déployer). Une clé volée ne peut donc rien faire d'autre que déployer du code déjà sur `master`, plus récent que celui en place. Essais depuis le PC, avec cette clé seulement (`-o IdentitiesOnly=yes`, sinon `ssh` propose d'abord la clé personnelle) : `ssh -i ~/.ssh/meche-deploy -o IdentitiesOnly=yes -p <port> pierre@<hôte> id` répond `usage: …` (code 2) sans lancer `id` ; avec l'identifiant complet du dernier commit de `master` (`git ls-remote https://github.com/PierreBultez/meche refs/heads/master`) à la place de `id`, un vrai déploiement se termine par `✓ Deployed`.
- **`deploy.sh`** : `umask 022` (code modifiable par `pierre` seul), mode maintenance (`artisan down`, les appareils reçoivent 503 et réessaient), `git reset --hard` sur le commit (un dossier que git crée dans `storage/` est rendu modifiable par le groupe `meche`), `composer install --no-dev -o`, effacement des caches de configuration, routes et événements (pas le cache de l'application, écrit par `meche`), `migrate --force`, `optimize` avec `umask 027` (`bootstrap/cache/config.php` contient le mot de passe de la base et `APP_KEY` : lisible seulement par `pierre` et le groupe `meche`, comme `.env` ; le déploiement s'arrête si ce fichier n'est pas dans le groupe `meche`), rechargement de PHP-FPM, `artisan up`. Si une étape échoue, l'API reste en maintenance plutôt que de servir du code neuf sur une base ancienne.
- **sudo** : une seule commande autorisée sans mot de passe, dans `/etc/sudoers.d/meche-deploy` : `pierre ALL=(root) NOPASSWD: /usr/bin/systemctl reload php8.5-fpm`. La règle est écrite dans un fichier temporaire, vérifiée avec `sudo visudo -cf <fichier>` **avant** d'être installée (`sudo install -m 0440 -o root -g root <fichier> /etc/sudoers.d/meche-deploy`, nom sans point : `sudo` ignore les autres) ; une erreur dans `/etc/sudoers.d/` peut bloquer `sudo` entièrement. Vérifier : après `sudo -k`, `sudo -n systemctl reload php8.5-fpm` passe et `sudo -n true` est refusé (s'il passe aussi, une autre règle autorise déjà tout sans mot de passe et le test ne prouve rien).
- **Secrets GitHub** : environnement `production` (Settings › Environments ; règle de branche de déploiement `master` ; pas de relecteur obligatoire, le déploiement part seul après chaque fusion), secrets **de l'environnement** et non du dépôt : `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (clé privée de déploiement, lignes `BEGIN` et `END` comprises), `DEPLOY_KNOWN_HOSTS` (sortie de `ssh-keyscan -p <port> <hôte>`, l'identité du serveur). Avant de la donner à GitHub, comparer ses empreintes (`ssh-keygen -lf <fichier>`) avec celles que le serveur annonce (`for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done`) : elles doivent être identiques, type par type. Avec la CLI `gh`, `gh secret set DEPLOY_SSH_KEY --env production --repo PierreBultez/meche < ~/.ssh/meche-deploy` évite les erreurs de copier-coller. Le job de déploiement ne tourne de toute façon que sur `master`.
- **Premier déploiement** : Actions › Deploy server › Run workflow sur `master` (25/10/2026 : tests puis `✓ Deployed`). Ensuite, chaque fusion dans `master` qui touche `server/` déploie seule.

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
- Version unique de l'application, incrémentée à chaque release (voir « Numéro de version » ci-dessous).

### Numéro de version

- Une seule version, écrite à cinq endroits qui doivent concorder : `app/package.json` et `app/package-lock.json` ; `app/src-tauri/tauri.conf.json` (version affichée dans Réglages, nom des paquets, `versionCode` Android) ; `app/src-tauri/Cargo.toml` et `Cargo.lock` (version envoyée au serveur dans l'en-tête `User-Agent`). `node scripts/version.mjs 0.4.1` les change tous (avec `npm version` et `cargo update --workspace`, sans rien installer) ; sans argument, il vérifie qu'ils concordent, ce que fait la CI.
- Avant la V1 : `0.<phase>.<correctif>`. La version passe à `0.N.0` quand la phase N est terminée (`0.4.0` à la fin de la phase 4) ; chaque PR fusionnée ensuite qui change l'application livrée (code de `app/`, hors tests et documentation) ajoute 1 au dernier chiffre (`0.4.1`, `0.4.2`…). Le tag `v1.0.0` termine la phase 6 (`10-feuille-de-route.md`) ; après, versionnage sémantique classique.
- Pourquoi : `apt` n'installe pas un `.deb` dont la version est déjà installée (il répond « déjà la version la plus récente » et garde l'ancien build), Android refuse une mise à jour dont le `versionCode` n'augmente pas (Tauri le calcule à partir de la version : `0.4.1` donne 4001), et Réglages montre quelle version tourne. Jusqu'à la phase 4, la version était restée à `0.1.0`.

**En attendant (ajouté en phase 3)** : `.github/workflows/windows-build.yml` construit l'installateur Windows (NSIS, `-setup.exe`) pour essayer l'application sur un PC. À lancer à la main : Actions › Windows build › Run workflow (sur `master`) ; il tourne aussi à chaque modification du workflow. L'installateur est joint au run (artefact `meche-windows-x64`, un zip gardé 30 jours). Il n'est pas signé : au premier lancement, SmartScreen affiche « Windows a protégé votre ordinateur » → « Informations complémentaires » → « Exécuter quand même ». Installation pour l'utilisateur courant, sans droits d'administrateur ; WebView2 est déjà présent sur Windows 10 et 11. Données de l'application : `%APPDATA%\fr.pierrebultez.meche`. `release.yml` le remplacera en phase 6.

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

### Méthode retenue en phase 5 : câble USB

Décidé avec Pierre le 27/10/2026 : construire le `.apk`, puis l'installer par USB. Les étapes ci-dessous sont un repère ; chaque commande et chaque réglage seront expliqués avant exécution sur ses appareils, puis vérifiés avec lui.

1. Activer les options développeur (appuyer 7 fois sur « Numéro de build ») puis le débogage USB.
2. `adb install -r app-release.apk` depuis le PC.

### Vérification des développeurs Google — état vérifié le 27/10/2026

- Le déploiement du **30 septembre 2026** vise certains stores au Brésil, en Indonésie, à Singapour et en Thaïlande, sur les appareils certifiés Android 7+. La France n'est pas citée ; l'extension mondiale est annoncée pour **2027 et au-delà**, sans date française précise ([calendrier officiel](https://developer.android.com/developer-verification)).
- Le compte gratuit à diffusion limitée (« loisir ») est disponible pour **20 appareils explicitement autorisés**, sans pièce d'identité. Il demande néanmoins un compte Google, la validation en deux étapes et un profil Google Payments comportant nom légal et adresse ([conditions officielles](https://developer.android.com/developer-verification/guides/limited-distribution)).
- Les installations par **ADB restent possibles sans enregistrement du développeur**, sans l'attente de 24 h du parcours avancé. Aucun compte développeur Google n'est donc nécessaire pour commencer les essais USB ([FAQ officielle](https://developer.android.com/developer-verification/guides/faq)).

### Sous-phase dédiée, différée : Obtainium

À la demande de Pierre, ne pas installer ni configurer Obtainium pour le moment. Cette sous-phase expliquera son intérêt, les mises à jour et les contraintes de Google, puis recueillera ses décisions. Le [projet officiel](https://github.com/ImranR98/Obtainium) permet notamment de suivre les APK des GitHub Releases ; leur publication automatisée dans Mèche attend `release.yml` en phase 6.

Obtainium n'exempte pas des règles Android d'installation : après extension des contrôles, prévoir un enregistrement adapté ou le parcours avancé pour une application non enregistrée, lequel comporte une attente initiale de 24 h. Refaire le point dans la [FAQ Google](https://developer.android.com/developer-verification/guides/faq) au moment de cette sous-phase. L'installation USB reste la méthode retenue entre-temps.

## 7. Installer sur les PC

- **Ubuntu** : `sudo apt install ./meche_x.y.z_amd64.deb`. Format Linux retenu : **`.deb` uniquement**.
  - À version égale, `apt` garde le build déjà installé (« déjà la version la plus récente ») : pour réinstaller un build de la même version, `sudo apt install --reinstall ./meche_x.y.z_amd64.deb`.
  - Mises à jour : au moment de la phase 6, vérifier dans la documentation de `tauri-plugin-updater` si l'installation automatique d'un `.deb` est prise en charge.
  - Si oui : l'utiliser comme sur Windows.
  - Si non : au démarrage, l'application compare sa version à la dernière GitHub Release et affiche « Nouvelle version disponible » avec un bouton qui télécharge le `.deb` ; l'installation se fait avec `sudo apt install ./meche_….deb`. Ne pas réintroduire l'AppImage sans l'accord de Pierre.
- **Windows** : lancer le `.msi` ou le `-setup.exe`, accepter l'avertissement SmartScreen la première fois. Mises à jour intégrées.
