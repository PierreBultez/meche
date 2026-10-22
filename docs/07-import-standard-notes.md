# 07 — Import Standard Notes et écran de tri

Pierre a environ 100 notes dans Standard Notes, de types texte, checklist, code et « Super ». Beaucoup sont jetables. L'import se fait en deux temps : **conversion** puis **tri rapide**.

## 1. Obtenir la sauvegarde (action de Pierre)

Dans Standard Notes (version desktop ou web) : **Préférences → Sauvegardes → télécharger une sauvegarde de données**, en choisissant l'option **non chiffrée (decrypted)**. On obtient un fichier `.txt` ou `.json` contenant du JSON.

> Pour Claude Code : **avant d'écrire le convertisseur**, demander à Pierre de placer sa sauvegarde dans `import-samples/` (dossier ignoré par git) et l'analyser pour confirmer les formats ci-dessous. Les fixtures de test doivent être **anonymisées** (contenu remplacé, structure conservée).

## 2. Format attendu (à confirmer sur le vrai fichier)

```json
{
  "version": "004",
  "items": [
    {
      "uuid": "…",
      "content_type": "Note",
      "created_at": "2024-03-01T10:00:00.000Z",
      "updated_at": "2025-06-12T08:30:00.000Z",
      "content": {
        "title": "…",
        "text": "…",
        "noteType": "super",
        "editorIdentifier": "…",
        "pinned": false,
        "archived": false,
        "trashed": false,
        "preview_plain": "…",
        "appData": { "…": "…" }
      }
    }
  ]
}
```
- Ne retenir que `content_type == "Note"`. Ignorer les tags, composants, réglages, etc.
- Ignorer les notes `trashed: true`.
- Conserver `created_at` et `updated_at` d'origine (convertis en millisecondes).
- `pinned` → `pinned`. Les notes `archived` sont importées normalement (pas d'archive dans Mèche).
- `color` : attribuée en rotation sur les 8 couleurs (voir `11-direction-artistique.md`).

## 3. Conversion selon le type (`noteType`)

| `noteType` Standard Notes | `kind` Mèche | Conversion de `text` |
|---|---|---|
| `plain-text` ou absent | `rich` | Texte tel quel (c'est du Markdown valide dans la grande majorité des cas) |
| `markdown` | `rich` | Tel quel |
| `task` (checklist) | `rich` | Vérifier le format réel. Attendu : lignes `- [ ] …` / `- [x] …`, à normaliser en task list GFM |
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
| Mèche | `E` | bouton | Allume la mèche : mode `delay`, délai par défaut |
| Supprimer | `S` ou `←` | glisser à gauche | Corbeille (récupérable 7 jours) |
| Passer | `Espace` | bouton | Repoussée à la fin |

- Barre de progression (« 37 / 104 »), bouton **Annuler** la dernière action, et sortie possible à tout moment : la progression est conservée (`import_triage`).
- Écran final : « 61 gardées, 12 mèches allumées, 31 à la corbeille ».
