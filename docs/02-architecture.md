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
┌──────────────────────── Serveur dédié Ubuntu (Apache, PHP-FPM, MySQL) ──────────────────▼┐
│  API Laravel 13                                                                          │
│   POST /api/auth/token   → token Sanctum par appareil                                    │
│   POST /api/sync         → push + pull en un seul aller-retour                           │
│   GET  /api/health                                                                       │
│  Planificateur : notes:maintenance (autodestruction + purge corbeille + tombstones)     │
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
- Pierre maîtrise Laravel et administre déjà un serveur Ubuntu avec Apache, PHP, MySQL et le déploiement par GitHub Actions.
- L'API est minuscule (3 routes). Elle doit répondre **vite** : voir les consignes de performance dans `04-synchronisation.md`.

### D6 — Recherche dans SQLite FTS5
- Index plein texte natif de SQLite, insensible aux accents (`remove_diacritics 2`), classement bm25.
- Instantané sur des milliers de notes. Aucune dépendance JS de recherche.

### D7 — Identifiants UUID v7 générés côté client
- Permet de créer des notes hors ligne sans collision. UUID v7 = triable par date de création.

### D8 — Utilisateur unique
- Pas d'inscription. L'utilisateur est créé par commande artisan. Chaque appareil obtient son propre token Sanctum (révocable).

## Stack détaillée

### Client — Rust (`app/src-tauri`)
| Crate | Usage |
|---|---|
| `tauri` 2 | Framework applicatif |
| `rusqlite` (feature `bundled`) | SQLite embarqué, FTS5 inclus |
| `rusqlite_migration` | Migrations versionnées du schéma local |
| `serde`, `serde_json` | Sérialisation |
| `uuid` (feature `v7`) | Identifiants |
| `reqwest` (features `json`, `gzip`, `rustls-tls`, sans OpenSSL) | Client HTTP de synchro |
| `tokio` | Async (fourni par Tauri) |
| `thiserror` | Erreurs typées |
| `tauri-plugin-opener` | Ouvrir un lien dans le navigateur du système (`Ctrl+clic`) |
| `tauri-plugin-dialog` | Sélection du fichier d'import |
| `tauri-plugin-updater` | Mises à jour automatiques desktop |

Organisation des modules :
```
src-tauri/src/
├── main.rs / lib.rs        # setup Tauri, état partagé, maintenance au démarrage, fil de fond
├── commands/               # une fonction #[tauri::command] par action
├── db/                     # connexion, migrations, requêtes
├── sync/                   # client API, moteur push/pull, résolution de conflits
├── ephemeral/              # destroy_at, autodestruction, purge (mod.rs) ; fil de maintenance et événement (watcher.rs)
└── error.rs
```

État partagé : une connexion SQLite protégée par `Mutex` (suffisant pour un utilisateur ; SQLite en mode WAL). Le fil de maintenance de la mèche (phase 2) prend le même verrou, quelques millisecondes par minute.

### Client — Frontend (`app/src`)
| Paquet | Usage |
|---|---|
| Vue 3 + TypeScript + Vite | Interface |
| Pinia | État (liste, note active, statut de synchro) |
| Vue Router | Navigation (indispensable sur mobile : liste → note, bouton retour Android) |
| Tailwind CSS 4 | Styles |
| `@tiptap/vue-3` v3 + extensions MIT | Éditeur riche |
| `@tiptap/markdown` + `marked` (MIT) | Lecture et écriture du Markdown des notes riches (un analyseur `marked` par éditeur, voir `05-editeur.md`) |
| `lowlight` | Coloration des blocs de code dans TipTap |
| CodeMirror 6 (`@codemirror/*`, `@codemirror/lang-*`) | Notes code |
| `lucide-vue-next` | Icônes |
| `@fontsource/jetbrains-mono` (OFL-1.1) | Police du code, embarquée (sous-ensemble latin, 400 et 700) |
| `@tauri-apps/api`, `@tauri-apps/plugin-opener` | `invoke`, événements, ouverture des liens |

### Serveur (`server/`)
- Laravel 13 (dernière version stable), PHP requis par Laravel 13, MySQL.
- Laravel Sanctum (tokens API uniquement, pas de cookies/SPA).
- Pest pour les tests.
- Pas d'interface web, pas d'Inertia, pas de Livewire.

## Commandes Tauri (contrat frontend ↔ Rust)

| Commande | Rôle |
|---|---|
| `list_notes(filter)` | `filter` = `all` / `pinned` / `ephemeral` / `trash`. Retourne des résumés (id, titre ou à défaut première ligne, aperçu en texte brut, kind, code_language, pinned, color, ephemeral_mode, destroy_at, trashed_at, updated_at). Exécute d'abord la maintenance de la mèche (`06-autodestruction.md`) et émet `notes-changed` si elle a modifié des notes. `ephemeral` trie par explosion la plus proche |
| `get_note(id)` | Note complète (`not_found` si elle n'existe pas ou a été supprimée définitivement) |
| `create_note(kind, fused?)` | `rich` ou `code`, retourne la note. La couleur est choisie par Rust (`11-direction-artistique.md`, « Attribution »). `fused = true` : mèche déjà allumée, avec le délai du réglage (« Nouvelle note à mèche ») |
| `update_note(id, patch)` | Patch partiel (title, content, kind, code_language, pinned, color), retourne la note. Changer `kind` convertit le contenu (`05-editeur.md`). Un patch qui ne change rien n'écrit rien (pas de nouvelle `updated_at`). Ne touche jamais à la mèche ni à la corbeille ; accepte une note de la corbeille (dernière sauvegarde d'une note qui vient d'exploser) |
| `set_ephemeral(id, enabled)` | Allume la mèche (délai du réglage `fuse_delay_hours`, à partir de maintenant) ou l'éteint, puis retourne la note. Allumer une mèche déjà allumée ne change rien. Refusé (`invalid_input`) pour une note de la corbeille |
| `trash_note(id)` / `restore_note(id)` | Corbeille |
| `delete_note_forever(id)` / `empty_trash()` | Suppression définitive (tombstone synchronisé) |
| `search(query)` | Recherche FTS5 (50 résultats max), avec un extrait d'une ligne où chaque correspondance est entourée des caractères U+E000 et U+E001. Chaque résultat porte aussi `destroy_at` |
| `login(server_url, email, password)` / `logout()` | Gestion du token |
| `sync_now()` / `get_sync_status()` | Synchro manuelle et état |
| `import_notes(notes[])` | Insertion en lot (import Standard Notes) |
| `get_settings()` / `set_settings(patch)` | Réglages locaux |

Événements émis par Rust :
- `notes-changed` (sans charge utile) : après une autodestruction ou une purge de la corbeille (fil de maintenance toutes les 60 s, ou `list_notes`), plus tard après une synchro qui a modifié des notes → le frontend recharge la liste et la note ouverte. Une note explosée reste affichée en lecture seule ; une note purgée est fermée.
- `sync-status` : `idle` / `syncing` / `offline` / `error` (+ message).

Erreurs : une commande qui échoue renvoie `{ kind, message }`. `kind` est un code stable (`database`, `migration`, `io`, `json`, `not_found`, `invalid_input`, `database_lock`) ; le frontend affiche son propre message en français et garde `message` pour la console.

Extraits de recherche : les correspondances sont marquées par deux caractères Unicode « à usage privé » (U+E000 au début, U+E001 à la fin) plutôt que par des balises `<mark>`. Le frontend découpe l'extrait sur ces caractères et crée lui-même les éléments surlignés : le texte des notes n'est jamais interprété comme du HTML (aucune injection possible, même si une note contient `<script>`).

Types partagés : les structures Rust sont annotées `serde(rename_all = "camelCase")`. Les types TS correspondants sont écrits à la main dans `app/src/types/` (ou générés avec `specta` si cela reste simple).

## Sécurité
- HTTPS obligatoire (Certbot sur le serveur).
- Token Sanctum par appareil, stocké dans la table `settings` locale (répertoire de données privé de l'application). Amélioration V2 : trousseau système.
- CSP Tauri stricte : aucune connexion réseau depuis la WebView.
- Limitation de débit sur `/api/auth/token`.
