# 02 — Architecture

## Vue d'ensemble

```
┌──────────────────────── Appareil (Linux / Windows / Android) ────────────────────────┐
│                                                                                       │
│  ┌──────────── Interface (WebView système) ────────────┐                              │
│  │ Vue 3 + TS + Tailwind 4                             │                              │
│  │  - Liste des notes, recherche, palette Ctrl+K       │                              │
│  │  - Éditeur riche TipTap (Markdown)                  │                              │
│  │  - Éditeur code CodeMirror 6                        │                              │
│  │  - Import Standard Notes + écran de tri             │                              │
│  └───────────────┬─────────────────────▲───────────────┘                              │
│        invoke()  │                     │  events ("notes-changed", "sync-status")     │
│  ┌───────────────▼─────────────────────┴───────────────┐                              │
│  │ Cœur Rust (Tauri 2)                                  │                              │
│  │  - commands/ : API exposée au frontend              │                              │
│  │  - db/       : SQLite + migrations + FTS5           │                              │
│  │  - sync/     : client HTTP, moteur de synchro       │──── HTTPS (JSON, gzip) ─────┐│
│  │  - ephemeral/: autodestruction, purge corbeille     │                              ││
│  └──────────────────────────────────────────────────────┘                              ││
└────────────────────────────────────────────────────────────────────────────────────────┘│
                                                                                          │
┌───────────────────────── VPS Ubuntu (Nginx, PHP-FPM 8.5, MariaDB) ──────────────────────▼┐
│  API Laravel 13                                                                          │
│   POST /api/auth/token, /api/auth/register  → jeton Sanctum par appareil                 │
│   POST /api/sync         → push + pull en un seul aller-retour                           │
│   GET  /api/health, /api/devices, /api/invitations                                       │
│  Planificateur : notes:maintenance (autodestruction + purge corbeille + jetons inactifs)│
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Décisions et raisons

### D1 — Tauri 2 plutôt que Rust pur ou Electron
- Pierre veut une application **native et installable**, avec un cœur en **Rust**, sur Linux, Windows et Android.
- Aucun framework d'interface Rust pur (Iced, Slint, egui) n'offre un éditeur riche comparable à TipTap. Développer un tel éditeur serait un projet à lui seul.
- Tauri 2 compile un cœur Rust natif et affiche l'interface dans la **WebView du système** (WebKitGTK sur Linux, WebView2 sur Windows, Android System WebView). Binaires légers (quelques Mo), démarrage rapide, une seule base de code pour les trois plateformes.
- Electron est exclu : trop lourd, pas de cœur Rust, pas d'Android.

### D2 — Local d'abord (local-first)
- Toutes les lectures et écritures se font sur la base SQLite locale. Latence ≈ 0, fonctionne hors ligne.
- La synchro tourne en tâche de fond et ne bloque jamais l'interface.
- C'est la réponse directe au problème n°1 (lenteur).

### D3 — Rust est le seul propriétaire des données côté client
- Le frontend n'accède ni au disque ni au réseau : il appelle des **commandes Tauri**.
- Avantages : une seule logique métier testable (`cargo test`), pas de duplication TS/Rust, sécurité (CSP stricte, pas de `fetch` sortant depuis la WebView).

### D4 — Markdown (GFM) comme format de stockage
- Lisible, portable, durable : pas d'enfermement propriétaire (leçon de Standard Notes).
- TipTap convertit Markdown ↔ document éditable. Voir `05-editeur.md`.

### D5 — Serveur Laravel
- Pierre maîtrise Laravel et administre déjà un serveur Ubuntu avec Nginx, PHP, MariaDB et le déploiement par GitHub Actions.
- L'API est petite (synchro, comptes, appareils, invitations). Elle doit répondre **vite** : voir les consignes de performance dans `04-synchronisation.md`.

### D6 — Recherche dans SQLite FTS5
- Index plein texte natif de SQLite, insensible aux accents (`remove_diacritics 2`), classement bm25.
- Instantané sur des milliers de notes. Aucune dépendance JS de recherche.

### D7 — Identifiants UUID v7 générés côté client
- Permet de créer des notes hors ligne sans collision. UUID v7 = triable par date de création.

### D8 — Plusieurs comptes, sur invitation (décidé en phase 3)
- Prévu au départ pour un seul utilisateur ; Pierre veut que sa famille puisse s'en servir.
- Le premier compte est créé par commande artisan (`notes:create-user`). Ensuite, **chaque compte peut créer des codes d'invitation** (usage unique, 7 jours) pour une personne de confiance, qui peut à son tour inviter quelqu'un. Pas d'inscription libre : le code et l'adresse du serveur sont publics.
- Les notes de chaque compte sont isolées (`user_id`). Pas de quota d'espace.
- Chaque appareil obtient son propre jeton Sanctum (révocable depuis un autre appareil). Voir `04-synchronisation.md`, « Comptes et authentification ».

## Stack détaillée

### Client — Rust (`app/src-tauri`)
| Crate | Usage |
|---|---|
| `tauri` 2 | Framework applicatif |
| `rusqlite` (feature `bundled`) | SQLite embarqué, FTS5 inclus |
| `rusqlite_migration` | Migrations versionnées du schéma local |
| `serde`, `serde_json` | Sérialisation |
| `uuid` (feature `v7`) | Identifiants |
| `reqwest` 0.13 (features `rustls-no-provider`, `json`, `gzip`, `system-proxy`, sans OpenSSL) | Client HTTP de synchro. La fonctionnalité `rustls-tls` des versions 0.12 n'existe plus : rustls est le choix par défaut, avec les certificats du système (`rustls-platform-verifier`) |
| `rustls` (feature `ring`) | Cryptographie de TLS : `ring` se compile avec un simple compilateur C sur Linux, Windows et Android (`aws-lc`, le choix par défaut de reqwest, peut demander CMake ou NASM). Installé une fois au démarrage (`sync/api.rs`) |
| `tokio` (feature `time`) | Async : le moteur tourne sur le runtime tokio de Tauri, qui n'active pas les minuteries (`time`) |
| `chrono` (feature `clock`) | Heure locale du titre « (conflit du 22/10 14:05) » : la bibliothèque standard ne connaît pas les fuseaux horaires |
| `thiserror` | Erreurs typées |
| `tauri-plugin-opener` | Ouvrir un lien dans le navigateur du système (`Ctrl+clic`) |
| `tauri-plugin-dialog` 2.8 | Sélection du fichier d'import. Utilisé seulement depuis Rust (`read_import_file`) : l'interface n'a aucune permission du greffon (phase 4). Attention : sur desktop, le greffon remplace `window.alert` et `window.confirm` ; `confirm()` y rend une promesse, toujours vraie. Ne jamais les utiliser : les confirmations passent par les boîtes de dialogue de l'interface |
| `zip` 9.0 (sans les fonctions par défaut, lecture deflate seulement) | Lecture de la sauvegarde `.zip` de Standard Notes (phase 4) |
| `tauri-plugin-updater` | Mises à jour automatiques desktop |

Organisation des modules :
```
src-tauri/src/
├── main.rs / lib.rs        # setup Tauri, état partagé, maintenance au démarrage, fil de fond
├── commands/               # une fonction #[tauri::command] par action
├── db/                     # connexion, migrations, requêtes
├── sync/                   # protocol (JSON), config (serveur, jeton, curseur), apply (côté SQLite),
│                           # api (client HTTP), schedule (quand synchroniser), engine (la tâche)
├── ephemeral/              # destroy_at, autodestruction, purge (mod.rs) ; fil de maintenance et événement (watcher.rs)
└── error.rs
```

État partagé : une connexion SQLite protégée par `Mutex` (suffisant pour un utilisateur ; SQLite en mode WAL). Le fil de maintenance de la mèche (phase 2) prend le même verrou, quelques millisecondes par minute. Le moteur de synchro (phase 3, une tâche tokio) aussi, seulement pour lire les notes à envoyer et appliquer la réponse, jamais pendant la requête réseau. `AppState` contient aussi le `SyncHandle` : les commandes l'utilisent pour parler au moteur (envoi de messages par un canal tokio).

### Client — Frontend (`app/src`)
| Paquet | Usage |
|---|---|
| Vue 3 + TypeScript + Vite | Interface |
| Pinia | État (liste, note active, statut de synchro) |
| Vue Router | Navigation (indispensable sur mobile : liste → note, bouton retour Android) |
| Tailwind CSS 4 | Styles |
| `@tiptap/vue-3` v3 + extensions MIT | Éditeur riche |
| `@tiptap/markdown` + `marked` 18 (MIT) | Lecture et écriture du Markdown des notes riches (un analyseur `marked` par éditeur, voir `05-editeur.md`). `@tiptap/markdown` déclare `marked` ^17 : la règle `overrides` de `app/package.json` lui donne le `marked` 18 de l'application, plus rapide (`05-editeur.md`) ; à retirer quand TipTap déclarera `marked` 18 |
| `lowlight` | Coloration des blocs de code dans TipTap |
| CodeMirror 6 (`@codemirror/*`, `@codemirror/lang-*`) | Notes code |
| `lucide-vue-next` | Icônes |
| `@fontsource/jetbrains-mono` (OFL-1.1) | Police du code, embarquée (sous-ensemble latin, 400 et 700) |
| `@tauri-apps/api`, `@tauri-apps/plugin-opener` | `invoke`, événements, ouverture des liens |

### Serveur (`server/`)
- Laravel 13 (13.38 en phase 3), qui demande PHP ≥ 8.3. Production : **PHP 8.5** et **MariaDB 12.3** ; Composer résout les dépendances pour PHP 8.4.1 au moins (`config.platform.php`).
- Laravel Sanctum 4 (jetons API uniquement, pas de cookies/SPA).
- Pest 5 pour les tests (il demande PHP 8.4), sur SQLite en local et sur MariaDB dans la CI.
- Pas d'interface web, pas d'Inertia, pas de Livewire, pas de Vite ni de npm : la racine du domaine reste libre.

## Commandes Tauri (contrat frontend ↔ Rust)

| Commande | Rôle |
|---|---|
| `list_notes(filter)` | `filter` = `all` / `pinned` / `ephemeral` / `trash`. Retourne des résumés (id, titre ou à défaut première ligne, aperçu en texte brut, kind, code_language, pinned, color, ephemeral_mode, destroy_at, trashed_at, updated_at). Exécute d'abord la maintenance de la mèche (`06-autodestruction.md`) et émet `notes-changed` si elle a modifié des notes. `ephemeral` trie par explosion la plus proche |
| `get_note(id)` | Note complète (`not_found` si elle n'existe pas ou a été supprimée définitivement) |
| `create_note(kind, fused?)` | `rich` ou `code`, retourne la note. La couleur est choisie par Rust (`11-direction-artistique.md`, « Attribution »). `fused = true` : mèche déjà allumée, avec le délai du réglage (« Nouvelle note à mèche ») |
| `update_note(id, patch)` | Patch partiel (title, content, kind, code_language, pinned, color), retourne la note. Changer `kind` convertit le contenu (`05-editeur.md`). Un patch qui ne change rien n'écrit rien (pas de nouvelle `updated_at`). Ne touche jamais à la mèche ni à la corbeille ; accepte une note de la corbeille (dernière sauvegarde d'une note qui vient d'exploser). `expectedTitle` / `expectedContent` (phase 3) : le texte que l'éditeur croit enregistré ; si la note en contient un autre (changé sur un autre appareil), elle est renvoyée inchangée et le nouveau texte part dans une copie « (conflit du …) » (`04-synchronisation.md`) |
| `set_ephemeral(id, enabled)` | Allume la mèche (délai du réglage `fuse_delay_hours`, à partir de maintenant) ou l'éteint, puis retourne la note. Allumer une mèche déjà allumée ne change rien. Refusé (`invalid_input`) pour une note de la corbeille. Lance d'abord la maintenance de la mèche : une mèche déjà brûlée explose, et la note revient dans la corbeille, sans erreur (`06-autodestruction.md`) |
| `trash_note(id)` / `restore_note(id)` | Corbeille. `trash_note` lance d'abord la maintenance : une note dont la mèche vient de brûler y est déjà |
| `delete_note_forever(id)` / `empty_trash()` | Suppression définitive (tombstone synchronisé) |
| `search(query)` | Recherche FTS5 (50 résultats max), avec un extrait d'une ligne où chaque correspondance est entourée des caractères U+E000 et U+E001. Chaque résultat porte aussi `destroy_at` |
| `login(serverUrl, email, password, deviceName)` / `register(serverUrl, invitationCode, email, password, deviceName)` / `logout()` | Connexion, création de compte avec un code d'invitation, déconnexion (les notes restent sur l'appareil). Retournent l'état de la synchro |
| `check_server(serverUrl)` | « Tester la connexion » (`GET /api/health`) : retourne l'adresse telle qu'elle sera utilisée (`https://` ajouté, `/api` retiré) |
| `sync_now()` / `get_sync_status()` | Synchro manuelle (attend la fin et retourne l'état) et état courant |
| `list_devices()` / `revoke_device(id)` | Appareils connectés au compte, déconnexion d'un autre appareil |
| `list_invitations()` / `create_invitation()` / `delete_invitation(id)` | Codes d'invitation (le code n'est renvoyé qu'à sa création) |
| `read_import_file()` | Ouvre la fenêtre de choix de fichier (dans Rust), lit la sauvegarde Standard Notes (`.zip`, `.txt` ou `.json`) et renvoie ses notes seulement, avec le compte des autres éléments ; `null` si la fenêtre est fermée (`07-import-standard-notes.md`) |
| `import_notes(notes[])` | Insertion en une transaction des notes converties, sans doublon, et ajout au tri ; retourne `{ imported, alreadyImported }` |
| `get_triage()` / `triage_decide(id, decision)` / `triage_undo(undo)` / `finish_triage()` | Écran de tri : notes en attente et comptes ; une décision (`keep`, `fuse`, `trash`, `skip`) retourne de quoi l'annuler ; fin du tri |
| `get_settings()` / `set_settings(patch)` | Réglages locaux |

Événements émis par Rust :
- `notes-changed` (sans charge utile) : après une autodestruction ou une purge de la corbeille (fil de maintenance toutes les 60 s, `list_notes`, `set_ephemeral`, `trash_note`), ou une synchro qui a modifié des notes visibles → le frontend recharge la liste et la note ouverte. Une note explosée reste affichée en lecture seule ; une note purgée est fermée ; une note dont le texte a changé sur un autre appareil affiche la nouvelle version sur place (docs/04).
- `sync-status` : l'état complet de la synchro, à chaque changement : `{ state: idle | syncing | offline | error, errorKind, message, loggedIn, serverUrl, email, deviceName, lastSyncAt, clockSkewMs, conflicts }`. `conflicts` (copies de conflit créées) n'est présent que dans l'événement de la synchro qui vient de finir.

Erreurs : une commande qui échoue renvoie `{ kind, message }`. `kind` est un code stable (`database`, `migration`, `io`, `json`, `not_found`, `invalid_input`, `database_lock` ; depuis la phase 4 : `backup_invalid`, `backup_encrypted`, `backup_too_large`, `backup_location` ; depuis la phase 3 : `network`, `server`, et les codes d'erreur de l'API connus du frontend : `invalid_credentials`, `invalid_invitation`, `invalid_email`, `email_taken`, `weak_password`, `too_many_invitations`, `unauthorized`, `rate_limited`, `not_meche_server`) ; le frontend affiche son propre message en français (`utils/sync-messages.ts` pour la synchro) et garde `message` pour la console.

Extraits de recherche : les correspondances sont marquées par deux caractères Unicode « à usage privé » (U+E000 au début, U+E001 à la fin) plutôt que par des balises `<mark>`. Le frontend découpe l'extrait sur ces caractères et crée lui-même les éléments surlignés : le texte des notes n'est jamais interprété comme du HTML (aucune injection possible, même si une note contient `<script>`).

Types partagés : les structures Rust sont annotées `serde(rename_all = "camelCase")`. Les types TS correspondants sont écrits à la main dans `app/src/types/` (ou générés avec `specta` si cela reste simple).

## Sécurité
Le dépôt est public : la sécurité repose sur des secrets (mots de passe, jetons, `APP_KEY`, `.env`, clé de déploiement), jamais sur le code.
- HTTPS obligatoire (Certbot sur le serveur). Le client refuse `http://`, sauf vers `localhost` / `127.0.0.1` pour le développement. TLS avec rustls et les certificats du système.
- Jeton Sanctum par appareil (le serveur n'en garde que l'empreinte SHA-256, préfixe `meche_`), stocké dans la table `settings` locale (répertoire de données privé de l'application) et jamais transmis au frontend. Amélioration V2 : trousseau système.
- Inscription seulement avec un code d'invitation d'un compte existant ; mot de passe de 12 caractères au moins.
- Liste des appareils avec déconnexion à distance ; jetons inutilisés depuis 180 jours supprimés.
- CSP Tauri stricte : aucune connexion réseau depuis la WebView. CORS fermé côté serveur (aucun navigateur n'appelle l'API).
- Limitation de débit : 5 essais par minute et par IP pour la connexion et l'inscription, 300 synchros par minute et par compte (contre un client qui boucle).
- Production : `APP_DEBUG=false`, utilisateur MariaDB limité à sa base, `.env` hors du dossier public, PHP sous son propre utilisateur système `meche` (les autres sites du serveur ne lisent ni `.env`, ni le cache, ni les journaux ; OPcache vérifie les droits), code modifiable par l'utilisateur de déploiement seul, fail2ban sur les refus de connexion (voir `09-build-et-deploiement.md`).
