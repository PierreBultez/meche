# 05 — Éditeurs

Deux types de notes, deux éditeurs :

| `kind` | Éditeur | Contenu stocké |
|---|---|---|
| `rich` | TipTap v3 | Markdown GFM |
| `code` | CodeMirror 6 | Texte brut + `code_language` |

## Note riche (TipTap)

Une seule note peut tout mélanger : texte mis en forme, checklists, blocs de code, tableaux. C'est l'équivalent du type « Super » de Standard Notes.

### Règle absolue sur les licences
N'utiliser que des paquets `@tiptap/*` publiés sur npm sous licence **MIT**. Interdit : Tiptap Pro, Tiptap Cloud, le registre privé `registry.tiptap.dev`, tout ce qui demande une clé ou un compte. Vérifier la licence de chaque extension avant de l'ajouter.

### Éléments supportés et syntaxe Markdown

| Élément | Markdown | Extension TipTap |
|---|---|---|
| Titres 1 à 3 | `#`, `##`, `###` | StarterKit (Heading, niveaux 1-3) |
| Gras, italique, barré | `**x**`, `*x*`, `~~x~~` | StarterKit |
| Code en ligne | `` `x` `` | StarterKit |
| Lien | `[texte](url)` | Link (StarterKit v3) |
| Liste à puces / numérotée | `-`, `1.` | StarterKit |
| **Checklist** (imbriquable) | `- [ ]`, `- [x]` | TaskList + TaskItem (`nested: true`) |
| Citation | `>` | StarterKit |
| Séparateur | `---` | StarterKit |
| **Bloc de code coloré** | ```` ```php ```` | CodeBlockLowlight (remplace le CodeBlock du StarterKit) |
| Tableau | GFM | Table, TableRow, TableHeader, TableCell |
| Texte indicatif | — | Placeholder (« Écris quelque chose… ») |

Pas de souligné (n'existe pas en Markdown), pas de couleurs, pas d'images en V1.

### Conversion Markdown
- Utiliser l'extension officielle `@tiptap/markdown` si elle est sous licence MIT et couvre les éléments ci-dessus (en particulier les task lists et les tableaux GFM). Sinon, se rabattre sur `prosemirror-markdown` + `markdown-it` (MIT) avec des règles pour les task lists et les tableaux.
- **Aller-retour stable obligatoire** : `serialize(parse(md)) === md` pour le Markdown produit par l'éditeur. Sinon chaque ouverture de note la marquerait comme modifiée et déclencherait des synchros inutiles.
- Tests Vitest avec un jeu de fixtures (`app/src/editor/__fixtures__/*.md`) couvrant chaque élément, l'imbrication des checklists, les blocs de code avec langage, les caractères spéciaux.

### Sauvegarde
- À chaque modification : anti-rebond de **400 ms**, puis sérialisation en Markdown.
- N'appeler `update_note` que si le Markdown a réellement changé.
- Sauvegarde forcée immédiate en quittant la note, en fermant la fenêtre, en passant l'application en arrière-plan (Android).
- Le titre est un champ séparé, au-dessus de l'éditeur (une ligne, gros caractères). `Entrée` dans le titre place le curseur dans l'éditeur.

### Ergonomie
- **Raccourcis Markdown en frappe** (inclus dans TipTap) : `# ` → titre, `- ` → liste, `[] ` → case à cocher, ```` ``` ```` → bloc de code, `> ` → citation.
- **Menu « / »** : en tapant `/` en début de ligne, liste filtrable : Titre 1/2/3, Liste, Liste numérotée, Checklist, Bloc de code, Citation, Tableau, Séparateur. Construit avec `@tiptap/suggestion` (MIT).
- **Menu de sélection** (BubbleMenu, desktop) : gras, italique, barré, code, lien.
- **Barre d'outils mobile** : au-dessus du clavier virtuel, défilante horizontalement : Checklist, Titre, Liste, Code, Gras, Italique, Lien, Annuler/Rétablir.
- Bloc de code : sélecteur de langage dans le coin du bloc, bouton « Copier ».
- Clic sur un lien : `Ctrl+clic` (desktop) / appui long (mobile) pour l'ouvrir dans le navigateur système.

### Comptage des cases à cocher (pour l'autodestruction)
Fait en **Rust** (`markdown/` module, avec `pulldown-cmark` et l'option task lists), à chaque `update_note` :
- `total` = nombre d'éléments de tâche, `checked` = nombre d'éléments cochés.
- Les `- [ ]` situés dans un bloc de code **ne comptent pas** (c'est pourquoi on utilise un vrai parseur, pas une regex).
- Tests unitaires : listes imbriquées, cases dans du code, `[X]` majuscule, aucune case.

## Note code (CodeMirror 6)

- Éditeur plein écran, numéros de ligne, coloration, indentation automatique, recherche `Ctrl+F` dans la note, repli de blocs.
- Sélecteur de langage dans l'en-tête de la note. Langages V1 : texte brut, PHP, JavaScript, TypeScript, Vue/HTML, CSS, SQL, Rust, Bash, JSON, YAML, Markdown, XML, Python. Chargement à la demande (`import()` dynamique) pour garder le démarrage rapide.
- Thème clair/sombre aligné sur l'application.
- Pas de retour à la ligne automatique par défaut (bascule dans le menu de la note).
- Même logique de sauvegarde que la note riche.

## Conversion entre types (menu de la note)
- **Riche → code** : le contenu Markdown brut devient le code, langage `markdown`.
- **Code → riche** : le code est placé dans un bloc de code clôturé avec son langage.
