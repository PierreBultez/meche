# 07 — Import Standard Notes et écran de tri

Pierre a quelques dizaines de notes dans Standard Notes, de types texte, HTML, checklist et « Super ». Beaucoup sont jetables. L'import se fait en deux temps : **conversion** puis **tri rapide**.

## 1. Obtenir la sauvegarde (action de Pierre)

Dans Standard Notes (version desktop ou web) : **Préférences → Sauvegardes → télécharger une sauvegarde de données**, en choisissant l'option **non chiffrée (decrypted)**.

Constaté en phase 4 (sauvegarde réelle du 25/10/2026) : Standard Notes produit une **archive `.zip`** (« Standard Notes Backup - <date>.zip »). Elle contient :
- `Standard Notes Backup and Import File.txt` : la sauvegarde complète, en JSON. C'est le seul fichier utile ;
- un dossier `Items/<type>/` avec un fichier par élément (`Items/Note/<titre>-<uuid court>.txt`…) : doublons du fichier principal, ignorés.

> **Données personnelles** : la sauvegarde contient le texte de toutes les notes, et, pour chaque fichier joint, sa clé de déchiffrement (`key`). Elle reste dans `import-samples/` (ignoré par git) et n'en sort jamais. Les fixtures de test sont **anonymisées** (contenu remplacé, structure conservée).

## 2. Format constaté (version `004`, non chiffrée)

```json
{
  "version": "004",
  "items": [
    {
      "uuid": "…",                              // UUID v4 en minuscules
      "content_type": "Note",
      "created_at": "2024-03-01T10:00:00.250Z",  // ISO 8601 UTC, millisecondes
      "created_at_timestamp": 1709287200250000,  // le même instant en MICROsecondes
      "updated_at": "2025-06-12T08:30:04.512Z",  // heure du serveur Standard Notes (voir plus bas)
      "updated_at_timestamp": 1749717004512000,
      "deleted": false,
      "duplicate_of": null,                      // ou l'uuid de la note dont c'est une copie de conflit
      "content": {
        "title": "…",
        "text": "…",                             // format selon noteType, voir le tableau
        "noteType": "super",
        "editorIdentifier": "com.standardnotes.super-editor",
        "references": [],
        "preview_plain": "…",
        "preview_html": "…",                     // facultatif
        "spellcheck": true,                      // facultatif
        "trashed": true,                         // présent seulement quand la note est dans la corbeille
        "conflict_of": "…",                      // facultatif : copie de conflit de Standard Notes
        "appData": {
          "org.standardnotes.sn": {
            "client_updated_at": "2025-06-12T08:30:00.000Z",
            "pinned": true                       // présent seulement quand la note est épinglée
          },
          "org.standardnotes.sn.components": { "<éditeur>": {} }
        }
      }
    }
  ]
}
```

Corrections par rapport au format attendu au départ :
- **`pinned` et `archived` ne sont pas dans `content`** mais dans `appData["org.standardnotes.sn"]`, et seulement quand ils valent `true`. Lire les deux emplacements (les anciennes versions les mettaient dans `content`).
- **Date de modification** : `updated_at` est l'heure du serveur Standard Notes ; elle change aussi quand la note est synchronisée ou mise à la corbeille. La date de la dernière modification par l'utilisateur, celle qu'affiche Standard Notes, est `appData["org.standardnotes.sn"].client_updated_at` (quelques secondes d'écart d'habitude, plus d'une heure pour une note mise à la corbeille).
- `trashed` n'est présent que lorsqu'il vaut `true`.
- **Copies de conflit** de Standard Notes (`conflict_of`, `duplicate_of`) : la note d'origine n'est plus dans la sauvegarde. Ce sont des notes ordinaires. Plusieurs peuvent porter le même titre.
- `appData["org.standardnotes.sn.components"]` : données des éditeurs, vides en pratique.
- Identifiants : UUID v4 en minuscules. Le serveur accepte tout UUID en minuscules (`ChangeValidator`), pas seulement v7.
- Aucun élément `deleted: true` ni chiffré dans une sauvegarde non chiffrée ; une sauvegarde chiffrée se reconnaît à des `content` en chaîne (`"004:…"`) et à des clés `enc_item_key` / `keyParams`.

Types d'éléments rencontrés : `Note`, `SN|File` (fichiers joints : nom, type, taille et clé seulement, le fichier lui-même est sur les serveurs de Standard Notes et n'est **pas** dans la sauvegarde), `SN|Component` et `SN|Theme` (extensions installées), `SN|SmartTag` (vue enregistrée), `SN|UserPreferences`. Pas de `Tag`.

### Types de notes rencontrés

| `noteType` | `editorIdentifier` | Contenu de `text` |
|---|---|---|
| `rich-text` | `org.standardnotes.plus-editor` | HTML |
| `super` | `com.standardnotes.super-editor` | État de l'éditeur Lexical, en JSON |
| `task` | `com.sncommunity.advanced-checklist` | JSON de l'extension « Advanced Checklist » (ci-dessous) |
| `task` | `org.standardnotes.simple-task-editor` | Une tâche par ligne : `- [ ] texte` / `- [x] texte` |
| `plain-text` | `com.standardnotes.plain-text` | Texte libre |

Absents de la sauvegarde réelle : `markdown`, `code` (l'extension de code est installée mais aucune note ne s'en sert), `spreadsheet`, `authentication`. Ils restent gérés d'après le tableau de la section 3, avec des fixtures construites à la main.

**HTML (`rich-text`)** : beaucoup de contenu collé depuis des pages web et des assistants de discussion. `p`, `div` et `span` avec des styles en ligne (polices, couleurs, variables Tailwind), `font`, `b` / `strong`, `i` / `em`, `code`, `br`, `hr`, `a`, `h2` à `h4`, `ul` / `li`, `pre` (parfois coloré par des `span class="token …"` avec `code class="language-bash"`, parfois vide), un `table` avec `colgroup` et une ligne d'en-tête de `th` vides, des boutons « Copier » (`button`, `svg`). Deux formes de cases à cocher : `li` > `input type="checkbox"` (Markdown rendu, case cochée = attribut `checked`) et la forme de TipTap, `ul[data-type="taskList"] > li[data-type="taskItem"][data-checked]`. Entités `&nbsp;` très fréquentes. Pas d'image.

**Lexical (`super`)** : sous `root.children`, `paragraph`, `heading` (`h1` à `h3`), `list` (`bullet`, `number`, `check`), `table`, `horizontalrule` ; en ligne, `text`, `link`, `autolink`, `linebreak`, `hashtag`. Précisions :
- **Liste imbriquée** : Lexical ne la met pas dans les enfants de l'élément parent, mais dans un élément de liste **à part**, qui ne contient que la liste et suit l'élément parent. Elle se rattache donc à l'élément précédent.
- `checked` : sur les éléments d'une liste `check` (absent = non cochée).
- `tablecell.headerState` : 0 aucun, 1 ligne d'en-tête, 2 colonne, 3 les deux. Le tableau rencontré n'a pas d'en-tête, alors que GFM en exige une.
- `hashtag` : texte `#mot`, sans lien.
- `linebreak` rencontré dans un titre ; paragraphes vides utilisés comme espacement ; espaces insécables dans le texte.
- `text.format` rencontrés : 0, 1 (gras), 2 (italique), 16 (code).
- Pas de bloc de code, de citation, d'image ni de fichier joint (`snfile`) : gérés quand même d'après le tableau de la section 3.

**Advanced Checklist (`task`)** :
```json
{
  "schemaVersion": "1.0.0",
  "groups": [
    {
      "name": "…", "collapsed": false, "lastActive": "…",
      "draft": "…",                              // facultatif : tâche tapée mais pas ajoutée
      "sections": [ { "id": "open-tasks", "name": "…", "collapsed": false },
                    { "id": "completed-tasks", "name": "…", "collapsed": false } ],
      "tasks": [ { "id": "…", "description": "…", "completed": true,
                   "createdAt": "…", "updatedAt": "…", "completedAt": "…" } ]
    }
  ],
  "defaultSections": [ { "id": "open-tasks", "name": "…" }, { "id": "completed-tasks", "name": "…" } ]
}
```
Un groupe peut ne contenir aucune tâche. Les sections ne sont que l'affichage « à faire / faites » : une tâche est classée par `completed`.

**Texte (`plain-text`)** : texte libre, pas du Markdown. Il peut contenir des caractères que Markdown interpréterait (`*`, `_`, `<`, `#`, `|`, `[`…) : du code collé, des suites de caractères sans signification, etc.

## 3. Conversion selon le type (`noteType`)

| `noteType` Standard Notes | `kind` Mèche | Conversion de `text` |
|---|---|---|
| `plain-text` ou absent | `rich` | Texte tel quel (c'est du Markdown valide dans la grande majorité des cas) |
| `markdown` | `rich` | Tel quel |
| `task` (checklist) | `rich` | Deux formats selon l'éditeur (section 2) : JSON de l'Advanced Checklist, ou lignes `- [ ] …` / `- [x] …` → task list GFM |
| `code` | `code` | Texte tel quel. Langage : lire `appData` si l'éditeur l'y stocke, sinon détection simple (`<?php`, `fn `, `SELECT`, `{`…), à défaut `plaintext` |
| `super` | `rich` | `text` contient un **état d'éditeur Lexical sérialisé en JSON** → convertisseur Lexical → Markdown (voir ci-dessous) |
| `rich-text` (ancien éditeur HTML) | `rich` | HTML → Markdown avec `turndown` + plugin GFM (MIT) |
| autre (`spreadsheet`, `authentication`…) | `code` | Texte brut, langage `plaintext`, signalé dans le rapport d'import |

### Convertisseur Lexical → Markdown (`app/src/import/lexical-to-markdown.ts`)
Parcours récursif de `root.children`. Nœuds à gérer :

| Nœud Lexical | Markdown |
|---|---|
| `paragraph` | texte + ligne vide |
| `heading` (`tag`: h1…h6) | `#` × niveau (h4+ ramenés à `###`) |
| `list` (`listType`: `bullet` / `number` / `check`) | `-` / `1.` / `- [ ]` |
| `listitem` (`checked`: bool, listes imbriquées dans `children`) | élément, indentation 2 espaces par niveau |
| `quote` | `> ` |
| `code` (`language`) + enfants `code-highlight` / `linebreak` | bloc clôturé ```` ```lang ```` |
| `text` (`format` = masque de bits : 1 gras, 2 italique, 4 barré, 8 souligné, 16 code) | `**`, `*`, `~~`, (souligné ignoré), `` ` `` |
| `link` / `autolink` (`url`) | `[texte](url)` |
| `linebreak` | saut de ligne |
| `horizontalrule` | `---` |
| `table` / `tablerow` / `tablecell` | tableau GFM |
| nœud inconnu | texte brut des descendants + compteur d'avertissement |

Tests Vitest sur des fixtures anonymisées issues de la vraie sauvegarde. Le Markdown produit doit ensuite s'ouvrir dans TipTap et passer le test d'aller-retour de `05-editeur.md`.

## 4. Déroulement dans l'application

1. Réglages → « Importer depuis Standard Notes » → sélection du fichier (`tauri-plugin-dialog`).
2. Analyse en TypeScript (frontend) → **récapitulatif** : « 104 notes trouvées : 52 texte, 21 checklists, 9 code, 22 Super. 3 éléments non convertibles parfaitement. »
3. Bouton « Importer » → commande Rust `import_notes(notes[])` : insertion en une transaction, `dirty = 1` (elles partiront au serveur à la prochaine synchro). Les notes importées sont ajoutées à la table `import_triage`.
4. Proposition immédiate : « Faire le tri maintenant ? (environ 10 minutes) » → écran de tri. Possible aussi plus tard depuis les réglages.

Un import relancé avec le même fichier ne doit pas créer de doublons : conserver l'UUID Standard Notes comme `id` s'il est valide, et ignorer les ID déjà présents.

## 5. Écran de tri

Objectif : faire le ménage de 100 notes en ~10 minutes.

- Une note à la fois, en **carte** : titre, date de dernière modification (« modifiée il y a 2 ans »), aperçu des premières lignes (repliable / dépliable).
- Ordre : **les plus anciennes d'abord** (`updated_at` croissant), car ce sont les plus susceptibles d'être jetables.
- Quatre actions, avec raccourcis clavier (desktop) et gestes (mobile) :

| Action | Clavier | Mobile | Effet |
|---|---|---|---|
| Garder | `G` ou `→` | glisser à droite | Rien |
| Mèche | `E` | bouton | Allume la mèche, avec le délai du réglage `fuse_delay_hours` |
| Supprimer | `S` ou `←` | glisser à gauche | Corbeille (récupérable 7 jours) |
| Passer | `Espace` | bouton | Repoussée à la fin |

- Barre de progression (« 37 / 104 »), bouton **Annuler** la dernière action, et sortie possible à tout moment : la progression est conservée (`import_triage`).
- Écran final : « 61 gardées, 12 mèches allumées, 31 à la corbeille ».
