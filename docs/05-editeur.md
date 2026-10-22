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

**Choix faits en phase 1** (`app/src/editor/extensions.ts`) :
- `@tiptap/markdown` (MIT, s'appuie sur `marked`) couvre tous les éléments du tableau : il est retenu. Indentation des listes : 2 espaces.
- Chaque éditeur a son propre analyseur `marked`. Avec l'analyseur partagé par défaut, `@tiptap/markdown` y ajoutait ses règles à chaque note ouverte : elles s'empilaient (600 après 200 notes) et l'ouverture ralentissait au fil de la journée.
- Une ligne de paragraphe qui commence comme un bloc Markdown (`1. `, `- ` ou `-` seul, `+`, `# `, `> `, ```` ``` ````, `---`, `--` ou `=` après un retour à la ligne) est échappée à l'écriture (`1\. `, `\- `…). Une ligne qui commence par des espaces ou une tabulation voit son premier caractère écrit `&#32;` ou `&#9;` : relue, elle aurait perdu son indentation, ou serait devenue un bloc de code à partir de 4 espaces. Sans ces échappements, du texte collé serait relu comme une liste ou un titre et la structure de la note changerait à la réouverture.
- Les tableaux sont écrits sans les lignes vides que l'extension ajoute autour. Une cellule ne contient que des paragraphes (écrits sur une ligne, séparés par `<br>`) : GFM ne sait pas stocker une liste, un titre ou un bloc de code dans une cellule.
- Un élément vide d'une liste numérotée (`2. `), ou vidé mais qui a des sous-éléments, est relu comme tel (l'analyseur d'origine le rendait invalide et il disparaissait, ou ses sous-éléments remontaient d'un niveau). Une puce vidée qui a des sous-éléments est écrite `-` seul sur sa ligne.
- Seuls 1 à 9 chiffres ouvrent une liste numérotée, comme en GFM : le lecteur de TipTap prenait aussi des lettres et des chiffres romains pour des numéros (« M. Dupont », « Cf. le document », « a) option » devenaient des éléments de liste et perdaient leur premier mot). Ces débuts de paragraphe sont aussi échappés (`M\. Dupont`), car ils pouvaient encore rejoindre une liste juste au-dessus.
- Deux retours à la ligne de suite (`Maj+Entrée` deux fois) : le second est écrit `\` en fin de ligne, car une ligne faite d'espaces serait lue comme une ligne vide qui termine le paragraphe.
- Les adresses web et e-mail écrites en texte restent du texte : pas de liens automatiques à la relecture (GFM « autolinks »). Un vrai lien est toujours écrit `[texte](adresse)`, et un lien retiré ne revient plus. Une adresse qui contient une espace ou une parenthèse est écrite `[texte](<adresse>)`.
- Un bloc de code est clôturé par plus d'accents graves que la plus longue suite qu'il contient (même règle que la conversion en Rust).
- TipTap garde toujours un paragraphe vide en fin de document (pour pouvoir cliquer sous un tableau ou un bloc de code) : les lignes vides finales sont retirées à la sauvegarde. Sans cela, un simple clic dans une note la marquait comme modifiée.
- Un bloc de code sans langage reste du texte brut (`plaintext`) : pas de détection automatique, qui colorait du texte au hasard.
- Le Markdown écrit par l'éditeur est la forme canonique. Une note écrite autrement (`*` pour les puces, `__gras__`) n'est réécrite qu'à sa première vraie modification, jamais à la simple ouverture : l'éditeur ne sauvegarde que sur une modification réelle.
- Le HTML brut présent dans un Markdown n'est pas conservé par TipTap. Les notes créées dans Mèche ne peuvent pas en contenir (le `<` tapé est écrit `&lt;`), mais **l'import Standard Notes (phase 4) devra échapper `<`** dans les notes importées pour ne rien perdre.

### Sauvegarde
- À chaque modification : anti-rebond de **400 ms**, puis sérialisation en Markdown.
- N'appeler `update_note` que si le Markdown a réellement changé.
- Sauvegarde forcée immédiate en quittant la note, en fermant la fenêtre, en passant l'application en arrière-plan (Android).
- Le menu « / » ne s'ouvre ni dans un bloc de code ni dans une cellule de tableau.
- Mise en œuvre (`app/src/composables/useAutosave.ts`) :
  - le contenu n'est lu dans l'éditeur qu'au moment d'enregistrer, jamais à chaque frappe, et seulement après une vraie modification ;
  - la référence est le Markdown que l'éditeur écrit lui-même juste après avoir chargé la note : une note dans un autre style Markdown n'est pas réécrite tant qu'on ne la modifie pas ;
  - les écritures partent dans l'ordre ;
  - quitter la note (autre note, réglages, nouvelle note, conversion, corbeille) attend la fin de la sauvegarde. Si elle échoue (note de plus de 2 Mo…), un message le dit et la note reste ouverte avec le texte tapé, jusqu'à ce que la sauvegarde réussisse ou que le texte redevienne celui qui est enregistré (`Ctrl+Z`) ;
  - la fermeture de la fenêtre est refusée une fois par série d'échecs ; fermer à nouveau quitte quand même.
- Le titre est un champ séparé, au-dessus de l'éditeur (une ligne, gros caractères). `Entrée` dans le titre place le curseur dans l'éditeur.

### Ergonomie
- **Raccourcis Markdown en frappe** (inclus dans TipTap) : `# ` → titre, `- ` → liste, `[] ` → case à cocher, ```` ``` ```` → bloc de code, `> ` → citation.
- **Menu « / »** : en tapant `/` en début de ligne, liste filtrable : Titre 1/2/3, Liste, Liste numérotée, Checklist, Bloc de code, Citation, Tableau, Séparateur. Construit avec `@tiptap/suggestion` (MIT).
- **Menu de sélection** (BubbleMenu, desktop) : gras, italique, barré, code, lien.
- **Barre d'outils mobile** : au-dessus du clavier virtuel, défilante horizontalement : Checklist, Titre, Liste, Code, Gras, Italique, Lien, Annuler/Rétablir.
- Bloc de code : sélecteur de langage dans le coin du bloc, bouton « Copier ».
- Clic sur un lien : `Ctrl+clic` (desktop) / appui long (mobile) pour l'ouvrir dans le navigateur système.
- `Échap` dans l'éditeur ferme d'abord le menu « / », sinon quitte le mode concentration, sinon revient à la carte de la note dans la liste (`08-interface.md`).

### Comptage des cases à cocher (pour l'autodestruction)
Fait en **Rust** (`markdown/` module, avec `pulldown-cmark` et l'option task lists), à chaque `update_note` :
- `total` = nombre d'éléments de tâche, `checked` = nombre d'éléments cochés.
- Les `- [ ]` situés dans un bloc de code **ne comptent pas** (c'est pourquoi on utilise un vrai parseur, pas une regex).
- Tests unitaires : listes imbriquées, cases dans du code, `[X]` majuscule, aucune case.

## Note code (CodeMirror 6)

- Éditeur plein écran, numéros de ligne, coloration, indentation automatique, recherche `Ctrl+F` dans la note, repli de blocs.
- Sélecteur de langage dans l'en-tête de la note. Langages V1 : texte brut, PHP, JavaScript, TypeScript, Vue/HTML, CSS, SQL, Rust, Bash, JSON, YAML, Markdown, XML, Python. Chargement à la demande (`import()` dynamique) pour garder le démarrage rapide.
- Thème clair/sombre aligné sur l'application. Police JetBrains Mono embarquée, sans ligatures (`=>` reste `=>`, comme dans PhpStorm).
- Pas de retour à la ligne automatique par défaut (bascule dans le menu de la note, réglage global enregistré : `code_line_wrap`).
- Même logique de sauvegarde que la note riche.

## Conversion entre types (menu de la note)
- **Riche → code** : le contenu Markdown brut devient le code, langage `markdown`.
- **Code → riche** : le code est placé dans un bloc de code clôturé avec son langage (sans langage pour `plaintext`). La clôture est plus longue que la plus longue suite de `` ` `` du code, pour qu'un code contenant ```` ``` ```` reste entier.
- La conversion est faite par Rust dans `update_note` (patch `kind`), après avoir forcé la sauvegarde en cours.
