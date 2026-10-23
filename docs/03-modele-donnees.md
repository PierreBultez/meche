# 03 — Modèle de données

Conventions :
- Dates : **millisecondes depuis l'epoch Unix (UTC)**, entiers 64 bits, partout (client, API, serveur).
- Identifiants : UUID v7 en chaîne (36 caractères), générés par le client.
- Les noms de colonnes sont identiques côté client et serveur pour simplifier la synchro.

## La note

| Champ | Type | Synchronisé | Description |
|---|---|---|---|
| `id` | UUID v7 | oui | Identifiant |
| `title` | texte | oui | Titre (peut être vide → l'interface affiche la première ligne du contenu) |
| `content` | texte | oui | Markdown GFM (`kind = rich`) ou code brut (`kind = code`) |
| `kind` | `rich` \| `code` | oui | Type de note |
| `code_language` | texte nullable | oui | Langage pour `kind = code` (`php`, `ts`, `rust`, `sql`…) |
| `pinned` | booléen | oui | Épinglée |
| `color` | texte | oui | Couleur de la note : `violet`, `rose`, `corail`, `orange`, `citron`, `pomme`, `turquoise`, `bleu` (voir `11-direction-artistique.md`) |
| `ephemeral_mode` | `delay` \| `on_complete` \| null | oui | null = mèche éteinte. Seul `delay` est utilisé en V1 ; `on_complete` reste autorisé par le schéma mais rien ne le crée (`06-autodestruction.md`) |
| `ephemeral_delay_hours` | entier nullable | oui | Délai avant destruction, copié du réglage `fuse_delay_hours` quand la mèche est allumée ; ne change plus ensuite |
| `ephemeral_started_at` | ms nullable | oui | Début du compte à rebours (allumage de la mèche) |
| `destroy_at` | ms nullable | oui | `started_at + delay`. null = pas armé |
| `trashed_at` | ms nullable | oui | Date de mise en corbeille |
| `trash_reason` | `manual` \| `self_destruct` \| null | oui | Origine de la mise en corbeille |
| `deleted` | booléen | oui | Tombstone : note supprimée définitivement (contenu vidé) |
| `created_at` | ms | oui | Création |
| `updated_at` | ms | oui | Dernière modification par l'utilisateur ou un automatisme |

Champs **locaux uniquement** (client) :
| Champ | Description |
|---|---|
| `seq` | Clé entière locale (`INTEGER PRIMARY KEY`) vers laquelle pointe l'index de recherche FTS5. Jamais synchronisée |
| `server_rev` | Dernière révision serveur connue (0 = jamais synchronisée) |
| `dirty` | 1 = modification locale pas encore envoyée |

Champ **serveur uniquement** :
| Champ | Description |
|---|---|
| `rev` | Numéro de séquence croissant, propre à chaque compte, attribué à chaque écriture |

## Client — SQLite

Ouvrir la base en mode WAL (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`).
Fichier : répertoire de données de l'application (`app_data_dir()` de Tauri) → `notes.db`.

```sql
-- Migration 001
CREATE TABLE notes (
  seq                    INTEGER PRIMARY KEY,   -- clé locale stable, utilisée par notes_fts
  id                     TEXT    NOT NULL UNIQUE,
  title                  TEXT    NOT NULL DEFAULT '',
  content                TEXT    NOT NULL DEFAULT '',
  kind                   TEXT    NOT NULL DEFAULT 'rich' CHECK (kind IN ('rich','code')),
  code_language          TEXT,
  pinned                 INTEGER NOT NULL DEFAULT 0,
  color                  TEXT    NOT NULL DEFAULT 'violet'
                         CHECK (color IN ('violet','rose','corail','orange','citron','pomme','turquoise','bleu')),
  ephemeral_mode         TEXT CHECK (ephemeral_mode IN ('delay','on_complete')),
  ephemeral_delay_hours  INTEGER,
  ephemeral_started_at   INTEGER,
  destroy_at             INTEGER,
  trashed_at             INTEGER,
  trash_reason           TEXT CHECK (trash_reason IN ('manual','self_destruct')),
  deleted                INTEGER NOT NULL DEFAULT 0,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  server_rev             INTEGER NOT NULL DEFAULT 0,
  dirty                  INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_notes_list    ON notes (deleted, trashed_at, pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_destroy ON notes (destroy_at) WHERE destroy_at IS NOT NULL AND trashed_at IS NULL;
CREATE INDEX idx_notes_dirty   ON notes (dirty) WHERE dirty = 1;

-- Recherche plein texte (table externe synchronisée par triggers)
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, content,
  content='notes', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.seq, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.seq, new.title, new.content);
END;

-- Réglages et état de synchro (clé / valeur JSON)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Clés : server_url, api_token, account_email, device_name, sync_cursor, last_sync_at,
--        server_sync_id, welcome_done (écran de premier lancement déjà répondu),
--        fuse_delay_hours (délai de la mèche : 1, 24, 72, 168 ou 720 ; 168 par défaut),
--        theme ('system'|'light'|'dark'),
--        list_width (largeur de la colonne des notes en px, 220 à 520, 280 par défaut),
--        code_line_wrap (retour à la ligne automatique des notes code, false par défaut)

-- Notes en attente de tri après import (local uniquement)
CREATE TABLE import_triage (
  note_id   TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL
);
```

Réglages de la synchro (phase 3, `sync/config.rs`) : `server_url` (adresse de base, sans `/api`), `api_token` (jeton de l'appareil : il ne quitte jamais Rust, ni `get_settings` ni `get_sync_status` ne le renvoient), `account_email` (gardé après une déconnexion, pour prévenir avant de synchroniser l'appareil avec un autre compte), `device_name`, `sync_cursor`, `last_sync_at`, `server_sync_id` (voir `04-synchronisation.md`, « Identité du serveur »). La phase 3 n'a pas demandé de migration 003 : les colonnes `server_rev`, `dirty` et `deleted` existent depuis la migration 001, les index en place suffisent, et les nouveaux réglages sont des clés de la table `settings`.

Réglage de la mèche (phase 2) : une seule clé, `fuse_delay_hours`. Une valeur stockée hors de la liste revient à 168 ; un `set_settings` hors liste est refusé (`invalid_input`). Le commentaire de la migration 001 cite encore les anciennes clés `default_delay_hours_delay` et `default_delay_hours_on_complete`, jamais utilisées : la migration étant publiée, il n'est pas modifié.

Pourquoi `seq` (décidé en phase 0) : l'index FTS5 « à contenu externe » retrouve ses lignes par un identifiant entier. Avec une clé primaire `TEXT`, cet identifiant serait le `rowid` implicite de SQLite, que la documentation ne garantit pas stable (un `VACUUM` peut le renuméroter). Une colonne `INTEGER PRIMARY KEY` explicite, elle, ne change jamais. L'identifiant de la note reste `id` (UUID), unique et synchronisé ; `seq` n'existe que dans la base locale.

Le schéma exact est dans `app/src-tauri/src/db/sql/001_initial.sql` (migration 001, à ne plus modifier une fois publiée : toute évolution passe par une nouvelle migration).

Requêtes de recherche :
```sql
SELECT n.id, n.title, snippet(notes_fts, -1, char(57344), char(57345), '…', 12) AS excerpt
FROM notes_fts
JOIN notes n ON n.seq = notes_fts.rowid
WHERE notes_fts MATCH :query AND n.deleted = 0 AND n.trashed_at IS NULL
ORDER BY bm25(notes_fts, 5.0, 1.0)
LIMIT 50;
```
La requête utilisateur est transformée en requête FTS en préfixe : chaque mot échappé entre guillemets suivi de `*` (`"cour"* "lidl"*`). Ne jamais injecter la saisie brute (les caractères spéciaux FTS provoquent des erreurs). Les mots sans lettre ni chiffre sont ignorés.

Depuis la migration 002 (`002_search_decoded_text.sql`), l'index ne lit plus la table `notes` directement mais la vue `notes_search`. Pour les notes riches, la vue passe le contenu à la fonction SQL `rich_search_text`, écrite en Rust (`db/search.rs`, fonctionnalité `functions` de rusqlite) et enregistrée sur chaque connexion avant les migrations. Elle décode les entités HTML que l'éditeur écrit (`&amp;`, `&lt;`, `&gt;`, `&nbsp;`, `&#32;`, `&#9;`), sauf dans le code (blocs clôturés et code en ligne), que l'éditeur stocke tel que tapé. Un `>` décodé est indexé `\>`, pour que l'extrait ne le prenne pas pour une citation. Avant, taper « amp » ou « gt » trouvait toutes les notes contenant un `&` ou un `>`. Les déclencheurs utilisent la même fonction que la vue : sinon FTS5 ne pourrait ni retirer une ancienne entrée, ni placer les surlignages d'un extrait. Les notes code sont indexées telles quelles.

L'extrait est pris dans la colonne qui correspond le mieux (`-1` : titre ou contenu). Les correspondances y sont entourées de U+E000 / U+E001 (et non de `<mark>`, voir `02-architecture.md`), puis Rust retire la syntaxe Markdown de l'extrait pour n'en garder qu'une ligne de texte.

## Serveur — MariaDB (migrations Laravel)

Production : MariaDB 12.3 (pilote `mariadb` de Laravel). Les tests Pest tournent sur SQLite en local et sur MariaDB dans la CI. Migrations dans `server/database/migrations/` :

```php
// users : pas de réinitialisation par e-mail ni de sessions (l'API ne connaît que des jetons)
Schema::create('users', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('email')->unique();
    $table->string('password');
    $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();  // qui a invité ce compte
    $table->timestamps();
});

// personal_access_tokens : migration de Sanctum, telle quelle (un jeton par appareil)

// Compteur de révision et identité de l'historique de synchro (une ligne par compte)
Schema::create('sync_counters', function (Blueprint $table) {
    $table->foreignId('user_id')->primary()->constrained()->cascadeOnDelete();
    $table->unsignedBigInteger('value')->default(0);
    $table->uuid('sync_id');
});

// Codes d'invitation (dates en ms, seule l'empreinte SHA-256 du code est gardée)
Schema::create('invitations', function (Blueprint $table) {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->char('code_hash', 64)->unique();
    $table->char('hint', 4);                       // 4 derniers caractères, pour la liste
    $table->unsignedBigInteger('created_at');
    $table->unsignedBigInteger('expires_at');
    $table->foreignId('used_by')->nullable()->constrained('users')->nullOnDelete();
    $table->unsignedBigInteger('used_at')->nullable();
    $table->index(['user_id', 'used_at']);
});

Schema::create('notes', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('title', 500)->default('');
    $table->longText('content');
    $table->enum('kind', ['rich', 'code'])->default('rich');
    $table->string('code_language', 50)->nullable();
    $table->boolean('pinned')->default(false);
    $table->enum('color', ['violet', 'rose', 'corail', 'orange', 'citron', 'pomme', 'turquoise', 'bleu'])->default('violet');
    $table->enum('ephemeral_mode', ['delay', 'on_complete'])->nullable();
    $table->unsignedInteger('ephemeral_delay_hours')->nullable();
    $table->unsignedBigInteger('ephemeral_started_at')->nullable();
    $table->unsignedBigInteger('destroy_at')->nullable();
    $table->unsignedBigInteger('trashed_at')->nullable();
    $table->enum('trash_reason', ['manual', 'self_destruct'])->nullable();
    $table->boolean('deleted')->default(false);
    $table->unsignedBigInteger('created_at');   // ms, pas les timestamps() Laravel
    $table->unsignedBigInteger('updated_at');
    $table->unsignedBigInteger('rev');
    $table->unique(['user_id', 'rev']);         // la réception lit `rev > cursor` le long de cet index
    $table->index('destroy_at');                // notes:maintenance
    $table->index('trashed_at');
});
```

Il n'y a pas de modèle Eloquent `Note` : le serveur ne lit et n'écrit les notes qu'avec le Query Builder (`server/app/Sync/`). `created_at` et `updated_at` sont fournis par le client, en millisecondes.

Attribution des révisions (décidé en phase 3, à la place de `LAST_INSERT_ID` note par note) : chaque transaction qui écrit commence par verrouiller la ligne du compteur, puis attribue toutes ses révisions en une fois :
```sql
SELECT value, sync_id FROM sync_counters WHERE user_id = ? FOR UPDATE;   -- verrou jusqu'à la fin
-- … n notes écrites avec les révisions value+1 … value+n …
UPDATE sync_counters SET value = value + n WHERE user_id = ?;
```
Même garantie (les écritures d'un compte se suivent, leurs révisions sont validées dans l'ordre), moins de requêtes, et cela fonctionne aussi sur SQLite pour les tests.

## Limites
- `content` : 2 Mo maximum par note, comptés en octets (validé côté client et serveur).
- `title` : 500 caractères.
- Une requête de synchro : 200 notes et environ 4 Mo dans chaque sens (`04-synchronisation.md`).
