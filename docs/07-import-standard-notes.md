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

Décidé en phase 4 (validé par Pierre) : **chaque convertisseur produit un document de l'éditeur riche** (JSON TipTap), puis **l'éditeur écrit lui-même le Markdown**, avec les règles de `05-editeur.md` (échappements, tableaux, clôtures de code). Le Markdown d'une note importée est donc exactement celui qu'écrirait l'éditeur : l'aller-retour est stable par construction, et aucune dépendance de conversion n'est ajoutée (pas de `turndown`). Code dans `app/src/import/`.

| `noteType` Standard Notes | `kind` Mèche | Conversion de `text` |
|---|---|---|
| `plain-text` ou absent | `rich` | **Pas du Markdown** : une ligne vide sépare deux paragraphes, chaque retour à la ligne est gardé, et l'éditeur échappe chaque caractère que Markdown lirait autrement (`*`, `_`, `<`, `#`, `|`, `[`…). Le texte s'affiche exactement comme dans Standard Notes (`plain-text.ts`) |
| `markdown` | `rich` | Lu par l'éditeur, puis réécrit à sa façon (`*` → `-`, `__` → `**`…). Le HTML brut hors du code n'est pas gardé par l'éditeur (`05-editeur.md`) : son texte reste et la note est signalée |
| `task` (Advanced Checklist) | `rich` | Un titre `##` par groupe, puis ses tâches à faire, puis ses tâches faites (l'ordre de l'extension). Une tâche tapée mais pas ajoutée (`draft`) devient une case à faire ; une tâche sur plusieurs lignes garde ses retours à la ligne (`checklists.ts`) |
| `task` (Simple Task Editor) | `rich` | Une case par ligne `- [ ]` / `- [x]` (aussi `*`, `[X]`) ; les autres lignes deviennent des paragraphes |
| `code` | `code` | Texte tel quel (fins de ligne `\r\n` ramenées à `\n`). Langage : celui que l'éditeur de code a gardé dans `appData` (`mode`, `language`… ; noms CodeMirror et types MIME reconnus), sinon une détection simple (`<?php`, `fn … ->`, `SELECT … FROM`, JSON valide…), à défaut `plaintext` (`code-language.ts`) |
| `super` | `rich` | État Lexical → document de l'éditeur (ci-dessous). S'il n'est pas du JSON Lexical : importé comme texte brut, et signalé |
| `rich-text` (éditeur Plus, HTML) | `rich` | HTML → document de l'éditeur, par les règles de lecture HTML de l'éditeur lui-même, après un nettoyage (ci-dessous) |
| autre (`spreadsheet`, `authentication`…) | `code` | Texte brut, langage `plaintext`, signalé dans le récapitulatif |

Les notes d'avant `noteType` sont reconnues par leur `editorIdentifier` (Plus, Bold, Simple Task, Advanced Checklist, Code Editor, éditeurs Markdown, Token Vault, Standard Sheets).

### Lexical → document (`lexical.ts`)

| Nœud Lexical | Document de l'éditeur |
|---|---|
| `paragraph` | paragraphe (les paragraphes vides, qui servaient d'espacement, disparaissent) |
| `heading` (`tag` h1…h6) | titre 1 à 3 (h4 et plus ramenés à 3) ; un `linebreak` dans un titre devient une espace |
| `list` (`bullet` / `number` / `check`) + `listitem` | liste à puces / numérotée / checklist (`checked` absent = à faire). La liste imbriquée, que Lexical range dans un élément à part, est rattachée à l'élément précédent (un texte vide lui est donné s'il n'y en a pas) |
| `quote` | citation |
| `code` (`language`) + `code-highlight`, `linebreak`, `tab` | bloc de code, langage ramené à la liste V1 (inconnu : sans langage) |
| `text` (`format` : 1 gras, 2 italique, 4 barré, 16 code) | marques correspondantes ; souligné (8), indice, exposant, surlignage : texte sans mise en forme |
| `link` / `autolink` (`url`) | lien, seulement `http:`, `https:` et `mailto:` ; sinon le texte seul |
| `hashtag`, `emoji`, `keyword`… | texte |
| `table` / `tablerow` / `tablecell` | tableau GFM : la première ligne devient l'en-tête (GFM en exige une, Lexical n'en met pas toujours) |
| nœud inconnu | son texte est gardé (sections repliables…), et il est signalé ; un nœud sans texte (`snfile`, image…) est ignoré et signalé |

### HTML → document (`html.ts`)

Le HTML est lu par `DOMParser` : un document jamais affiché, dont les scripts ne s'exécutent pas et dont les images ne se chargent pas (la CSP de l'application n'autorise de toute façon aucune adresse extérieure). Avant la lecture par l'éditeur :
- suppression des scripts, styles, formulaires, boutons, SVG (les boutons « Copier » des blocs de code collés) ;
- images, vidéos, `iframe`… supprimées et signalées ;
- cases à cocher : `<li><input type="checkbox">…` (Markdown rendu) devient une checklist de l'éditeur ; la forme de l'éditeur (`data-type="taskItem"`, `data-checked`) est lue telle quelle ; une liste qui mélange cases et puces garde ses puces, ses cases deviennent le texte `[ ]` / `[x]` ;
- `h4` à `h6` deviennent des `h3` ; un `<b>` ou `<strong>` de graisse normale (`font-weight: 400`, collé depuis certains éditeurs) n'est pas du gras ;
- bloc de code : le texte du `<pre>`, avec `<br>` et un élément par ligne comme retours à la ligne ; langage tiré de `class="language-…"` ;
- cellule de tableau : son contenu devient des paragraphes (sinon une liste dans une cellule sortait du tableau et le coupait en deux).

### Nettoyage commun (`doc.ts`)

Ce que Markdown ne sait pas écrire est retiré, pour que le Markdown se relise en exactement le même document :
- espaces insécables → espaces ; pour le HTML seulement, suites d'espaces réduites à une (comme la page les affichait) ; le texte tapé (texte brut, Lexical, checklists) garde ses espaces, y compris en début de ligne ;
- espaces sortis des marques (`** b**` n'est pas du gras en Markdown), pas d'espace en fin de ligne ni de retour à la ligne en début ou fin de paragraphe ; deux retours à la ligne de suite (une ligne vide) séparent deux paragraphes ;
- un code en ligne ne porte pas d'autre marque (avec un lien, le lien l'emporte) ;
- éléments de liste vides supprimés ; un élément qui ne contient qu'une sous-liste reçoit un texte vide ;
- blocs de code vides supprimés, lignes vides autour du code retirées ;
- tableaux : en-tête en première ligne, même nombre de cellules sur chaque ligne, cellules en texte seul.

### Vérification de chaque note (`markdown-writer.ts`)

Une seule instance de l'éditeur, sans fenêtre, sert à tout l'import. Pour chaque note riche, le Markdown écrit est relu : il doit redonner **exactement** le document converti, se réécrire à l'identique, et garder **tout le texte** de la note d'origine (espaces mis à part). Sinon la note est importée quand même, et signalée « à vérifier » dans le récapitulatif. Cette vérification a trouvé trois défauts de l'éditeur lui-même, corrigés en phase 4 (`05-editeur.md`) : un sur la vraie sauvegarde de Pierre (une ligne de tirets espacés), deux sur les fixtures. Après correction, les 25 notes de Pierre passent toutes.

### Dates, épinglage, titres, tailles

- `created_at` ← `created_at` (à défaut `created_at_timestamp`, en microsecondes) ; `updated_at` ← `appData["org.standardnotes.sn"].client_updated_at` (la date qu'affiche Standard Notes), à défaut `updated_at`, puis `updated_at_timestamp`. Sans aucune date : maintenant. Une date dans le futur est ramenée à maintenant par Rust.
- `pinned` ← `appData["org.standardnotes.sn"].pinned` ou `content.pinned`. Les notes archivées sont importées normalement.
- Titre sur une seule ligne ; plus de 500 caractères : coupé et signalé.
- Plus de 2 Mo une fois convertie : la note n'est pas importée (signalée en rouge dans le récapitulatif).
- `color` : attribuée par Rust, dans l'ordre des nouvelles notes (`COLOR_ORDER`), en continuant après la couleur de la dernière note, les notes prises de la plus ancienne à la plus récente : deux voisines dans la liste n'ont jamais la même couleur.

## 4. Déroulement dans l'application

1. Réglages › Import › « Importer depuis Standard Notes » (aussi dans la palette `Ctrl+K`) → écran `/import`.
2. « Choisir la sauvegarde… » → commande Rust `read_import_file` : **Rust ouvre lui-même** la fenêtre de choix de fichier (`tauri-plugin-dialog`, utilisé seulement depuis Rust : l'interface n'a ni chemin ni permission sur les fichiers), lit le `.zip` (`Standard Notes Backup and Import File.txt`, sinon le premier `.txt` / `.json` à la racine qui est une sauvegarde) ou le `.txt` / `.json` choisi, 64 Mo au plus même à l'intérieur d'un zip, reconnaît une sauvegarde chiffrée, et **n'envoie à l'interface que les notes** (les fichiers joints et leurs clés, les extensions et les réglages sont seulement comptés). Erreurs : `backup_invalid`, `backup_encrypted`, `backup_too_large`, `backup_location` (une adresse sans chemin, les `content://` d'Android : phase 5).
3. Conversion en TypeScript (`plan.ts`, chargé à la demande avec l'éditeur) → **récapitulatif** : « 25 notes trouvées : 3 textes, 9 textes enrichis, 6 Super, 7 checklists. », « Tout a été converti à l'identique. » ou la liste des notes non converties parfaitement et pourquoi, puis ce qui n'est pas importé (notes de la corbeille de Standard Notes, fichiers joints, étiquettes, extensions et réglages). Rien n'est écrit avant « Importer ».
4. « Importer 25 notes » → commande Rust `import_notes(notes[])` (`db/import.rs`) : chaque note est vérifiée (titre, contenu, langage, dates), puis toutes sont écrites **en une transaction** (toutes ou aucune), `server_rev = 0`, `dirty = 1` (elles partent au serveur à la prochaine synchro), et ajoutées à `import_triage`, les plus anciennes d'abord.
5. « Faire le tri maintenant ? (environ 3 min) » → écran de tri ; ou « Plus tard » : le tri reste proposé dans les réglages (« Reprendre le tri (n notes) ») et la palette.

**Pas de doublons.** L'identifiant Standard Notes devient l'`id` de la note (en minuscules ; un identifiant qui n'est pas un UUID donne un nouvel UUID v7). La table locale `imported_notes` (migration 003) retient chaque note importée par son identifiant dans la sauvegarde : relancer l'import avec le même fichier n'importe que les nouvelles, et **ne fait jamais revenir une note supprimée** pendant le tri. Une note déjà dans Mèche (reçue d'un autre appareil, ou tombstone) est aussi ignorée. Le résultat le dit : « Rien de nouveau : ces notes sont déjà dans Mèche. » Limite connue : sur un autre appareil, qui n'a pas fait l'import, une note supprimée partout puis purgée de la base locale reviendrait si cet appareil importait la même sauvegarde ; le serveur garde alors son tombstone et la synchro en fait une copie « (conflit du …) ».

## 5. Écran de tri (`/tri`)

Objectif : faire le ménage de 100 notes en ~10 minutes.

- Une note à la fois, en **carte** aux couleurs de la note : titre, « Modifiée il y a 2 ans », et la note elle-même en lecture seule (éditeur riche ou CodeMirror, chargés à la demande), repliée sur ses premières lignes, avec « Afficher toute la note » / « Replier » quand elle dépasse.
- Ordre : **les plus anciennes d'abord** (`updated_at` croissant, fixé à l'import ; une note passée va à la fin).
- Quatre actions, en boutons et au clavier (desktop), et par glissement sur un écran tactile :

| Action | Clavier | Tactile | Effet |
|---|---|---|---|
| Garder | `G` ou `→` | glisser à droite | Rien |
| Mèche | `E` | bouton | Allume la mèche, avec le délai du réglage `fuse_delay_hours` |
| Supprimer | `S` ou `←` | glisser à gauche | Corbeille (récupérable 7 jours) |
| Passer | `Espace` | bouton | Repoussée à la fin |
| Annuler | `Ctrl+Z` | bouton | Reprend le dernier choix, autant de fois que voulu pendant la séance |

- Une touche maintenue ne décide qu'une fois ; `Espace` et `Entrée` sur un bouton qui a le focus le pressent, comme partout. `Échap` quitte le tri.
- Barre de progression (« 7 / 25 », notes décidées sur le total), et sortie possible à tout moment : la progression est conservée. Les notes en attente sont les lignes de `import_triage` ; les comptes (gardées, mèches, corbeille) sont dans le réglage `triage_counts` (`db/triage.rs`), si bien que l'écran final ne change pas quand une note supprimée est purgée de la corbeille. Une note mise à la corbeille ailleurs pendant le tri compte comme « Supprimer » ; une note supprimée définitivement quitte la file.
- **Annuler** (`triage_undo`) remet la note à sa place dans la file, mèche éteinte ou hors de la corbeille, avec sa date de modification d'avant (la carte dit toujours « il y a 2 ans »). Refusé si la note a changé depuis (restaurée, modifiée ailleurs) : on n'écrase pas ce changement.
- Chaque choix est une seule transaction Rust (la note et la file ensemble). Mesuré dans le build release : 12 à 28 ms entre la touche et la carte suivante.
- Écran final : « 9 gardées, 8 mèches allumées, 8 à la corbeille. » → « Voir mes notes » remet les comptes à zéro (`finish_triage`). Un nouvel import pendant un tri inachevé rejoint la même file.

## 6. Données personnelles et tests

- La sauvegarde reste dans `import-samples/` (ignoré par git). Elle a été analysée par des scripts hors du dépôt, qui n'affichent que des structures et des comptes.
- Aucun journal ne contient le texte d'une note : les erreurs de Rust donnent l'indice et le champ de la note, jamais son contenu ; les erreurs de conversion ne sont pas journalisées.
- Fixture anonymisée : `app/src/import/__fixtures__/backup.ts` reproduit la structure de la vraie sauvegarde (HTML collé, états Lexical, checklists des deux éditeurs, copies de conflit, fichiers joints…) avec un contenu inventé, plus les types absents (code, Markdown, tableur).
- Tests Vitest (`app/src/import/*.test.ts`, `views/ImportView.test.ts`, `views/TriageView.test.ts`) : chaque convertisseur, le récapitulatif, et l'**aller-retour dans TipTap** de chaque note convertie (ouverte puis enregistrée sans changement : Markdown identique). Le texte brut est vérifié caractère par caractère après réouverture.
- Tests Rust (`db/import.rs`, `db/triage.rs`, `db/migrations.rs`, `backup.rs`) : transaction tout ou rien, pas de doublon à la relance, pas de retour d'une note supprimée, couleurs, ordre du tri, chaque décision et son annulation, comptes qui survivent à la purge, migration 003 sur une base de la phase 3, lecture du zip, sauvegarde chiffrée, limite de taille (même pour un zip qui se décompresse beaucoup).
