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
rustup default stable

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

## 2. Initialisation du projet

```bash
npm create tauri-app@latest app   # Vue + TypeScript, npm
cd app && npm run tauri dev
```
Puis `composer create-project laravel/laravel server` (Laravel 13) et `php artisan install:api` (Sanctum).

Nom affiché : **Mèche**. Identifiant d'application : `fr.pierrebultez.meche` (**ne plus le changer** une fois l'application Android installée : il identifie l'application et ses données). Nom du binaire / paquet : `meche`.

Un nom de paquet Debian ne peut pas contenir d'accent : `app/src-tauri/tauri.linux.conf.json` fixe donc le nom technique `meche` sous Linux (paquet `meche_x.y.z_amd64.deb`), et `app/src-tauri/linux/meche.desktop` garde « Mèche » comme nom affiché dans le menu des applications.

## 3. Serveur (API Laravel)

- Sous-domaine dédié **`meche.pierrebultez.com`** (API sous `/api`, la racine reste libre pour une future page de présentation), vhost Apache + certificat Certbot.
- Base MySQL dédiée et utilisateur MySQL dédié.
- Déploiement par GitHub Actions, sur le modèle de ses autres projets : déclenché par un push sur `main` touchant `server/**` → tests Pest → déploiement SSH (`git pull` ou rsync, `composer install --no-dev -o`, `php artisan migrate --force`, `php artisan optimize`, rechargement PHP-FPM).
- Cron système : `* * * * * cd /chemin/server && php artisan schedule:run >> /dev/null 2>&1` (pour `notes:maintenance`).
- `mod_deflate` actif pour `application/json`, OPcache actif.

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
