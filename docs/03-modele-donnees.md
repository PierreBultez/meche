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
| `ephemeral_mode` | `delay` \| `on_complete` \| null | oui | null = autodestruction désactivée |
| `ephemeral_delay_hours` | entier nullable | oui | Délai avant destruction |
| `ephemeral_started_at` | ms nullable | oui | Début du compte à rebours (activation ou complétion) |
| `destroy_at` | ms nullable | oui | `started_at + delay`. null = pas armé |
| `trashed_at` | ms nullable | oui | Date de mise en corbeille |
| `trash_reason` | `manual` \| `self_destruct` \| null | oui | Origine de la mise en corbeille |
| `deleted` | booléen | oui | Tombstone : note supprimée définitivement (contenu vidé) |
| `created_at` | ms | oui | Création |
| `updated_at` | ms | oui | Dernière modification par l'utilisateur ou un automatisme |

Champs **locaux uniquement** (client) :
| Champ | Description |
|---|---|
| `server_rev` | Dernière révision serveur connue (0 = jamais synchronisée) |
| `dirty` | 1 = modification locale pas encore envoyée |

Champ **serveur uniquement** :
| Champ | Description |
|---|---|
| `rev` | Numéro de séquence global, croissant, attribué à chaque écriture |

## Client — SQLite

Ouvrir la base en mode WAL (`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`).
Fichier : répertoire de données de l'application (`app_data_dir()` de Tauri) → `notes.db`.

```sql
-- Migration 001
CREATE TABLE notes (
  id                     TEXT PRIMARY KEY,
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
  content='notes', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
END;
CREATE TRIGGER notes_au AFTER UPDATE OF title, content ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.rowid, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

-- Réglages et état de synchro (clé / valeur JSON)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Clés : server_url, api_token, device_name, sync_cursor, last_sync_at,
--        default_delay_hours_delay (168), default_delay_hours_on_complete (24),
--        theme ('system'|'light'|'dark')

-- Notes en attente de tri après import (local uniquement)
CREATE TABLE import_triage (
  note_id   TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL
);
```

Requêtes de recherche :
```sql
SELECT n.id, n.title, snippet(notes_fts, 1, '<mark>', '</mark>', '…', 12) AS excerpt
FROM notes_fts
JOIN notes n ON n.rowid = notes_fts.rowid
WHERE notes_fts MATCH :query AND n.deleted = 0 AND n.trashed_at IS NULL
ORDER BY bm25(notes_fts, 5.0, 1.0)
LIMIT 50;
```
La requête utilisateur est transformée en requête FTS en préfixe : chaque mot échappé entre guillemets suivi de `*` (`"cour"* "lidl"*`). Ne jamais injecter la saisie brute (les caractères spéciaux FTS provoquent des erreurs).

## Serveur — MySQL (migration Laravel)

```php
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
    $table->index(['user_id', 'rev']);
    $table->index(['destroy_at']);
    $table->index(['trashed_at']);
});

// Compteur de révision global (une ligne par utilisateur)
Schema::create('sync_counters', function (Blueprint $table) {
    $table->foreignId('user_id')->primary()->constrained()->cascadeOnDelete();
    $table->unsignedBigInteger('value')->default(0);
});
```

Le modèle Eloquent `Note` désactive les timestamps automatiques (`public $timestamps = false;`) : `created_at` et `updated_at` sont fournis par le client en millisecondes.

Attribution d'une révision (dans la transaction de synchro) :
```sql
UPDATE sync_counters SET value = LAST_INSERT_ID(value + 1) WHERE user_id = ?;
SELECT LAST_INSERT_ID();
```

## Limites
- `content` : 2 Mo maximum par note (validé côté client et serveur).
- `title` : 500 caractères.
