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
- Un élément vide d'une liste numérotée, ou vidé mais qui a des sous-éléments, est relu comme tel (l'analyseur d'origine le rendait invalide et il disparaissait, ou ses sous-éléments remontaient d'un niveau). Depuis la phase 4, tout élément vide est écrit sans espace après sa marque, `-` ou `2.` seul sur sa ligne : suivi d'une espace, un premier élément vide n'ouvrait pas de liste et toute la liste devenait du texte. La forme avec espace, écrite par les versions précédentes, se relit aussi comme une liste. Juste sous le texte d'un élément, un premier sous-élément vide en est séparé par une ligne vide.
- Les listes numérotées sont toujours écrites `1.`, `2.`… : une liste à lettres ou en chiffres romains (TipTap en crée en collant « a) … b) … ») ne pourrait pas être relue en GFM.
- Seuls 1 à 9 chiffres ouvrent une liste numérotée, comme en GFM : le lecteur de TipTap prenait aussi des lettres et des chiffres romains pour des numéros (« M. Dupont », « Cf. le document », « a) option » devenaient des éléments de liste et perdaient leur premier mot). Depuis la phase 4, les listes numérotées sont lues par `marked` lui-même (ci-dessous). Ces débuts de paragraphe restent échappés (`M\. Dupont`).
- Deux retours à la ligne de suite (`Maj+Entrée` deux fois) : le second est écrit `\` en fin de ligne quand du texte suit, car une ligne faite d'espaces serait lue comme une ligne vide qui termine le paragraphe ; en fin de paragraphe, il est gardé en espaces (le premier écrit `&#32;`), car un `\` final s'afficherait.
- Les adresses web et e-mail écrites en texte restent du texte : pas de liens automatiques à la relecture (GFM « autolinks »). Un vrai lien est toujours écrit `[texte](adresse)`, et un lien retiré ne revient plus. Une adresse qui contient une espace ou une parenthèse est écrite `[texte](<adresse>)`.
- Un bloc de code est clôturé par plus d'accents graves que la plus longue suite qu'il contient (même règle que la conversion en Rust).
- TipTap garde toujours un paragraphe vide en fin de document (pour pouvoir cliquer sous un tableau ou un bloc de code) : les lignes vides finales sont retirées à la sauvegarde. Sans cela, un simple clic dans une note la marquait comme modifiée.
- Un bloc de code sans langage reste du texte brut (`plaintext`) : pas de détection automatique, qui colorait du texte au hasard.
- Le Markdown écrit par l'éditeur est la forme canonique. Une note écrite autrement (`*` pour les puces, `__gras__`) n'est réécrite qu'à sa première vraie modification, jamais à la simple ouverture : l'éditeur ne sauvegarde que sur une modification réelle.
- Le HTML brut présent dans un Markdown n'est pas conservé par TipTap. Les notes créées dans Mèche ne peuvent pas en contenir (le `<` tapé est écrit `&lt;`). L'import Standard Notes (phase 4) fait écrire le Markdown par l'éditeur : un `<` d'une note importée est écrit `&lt;` comme un `<` tapé ; seules les notes Markdown de Standard Notes peuvent contenir du HTML, que l'import signale (`07-import-standard-notes.md`).

**Corrigé en phase 4** (trouvé par la vérification de l'import, `07-import-standard-notes.md`) :
- Une ligne de tirets séparés par des espaces (`- - -`, `-- ------ ----`) était relue comme un séparateur : Markdown prend trois tirets ou plus, espaces permis, pour une ligne horizontale. Son premier tiret est échappé, comme pour une ligne de tirets collés.
- Des lignes qui ressemblent à un tableau (`| a | b |` puis `|---|---|`, tapées avec des retours à la ligne ou collées) étaient relues comme un tableau. Les barres d'une ligne qui serait lue comme la ligne de séparation sous l'en-tête d'un tableau sont échappées (`\|`).
- Un retour à la ligne (`Maj+Entrée`) dans une case de checklist cassait la liste à la réouverture : TipTap ne lit que la première ligne d'une case comme son texte, et la ligne suivante, non indentée, terminait la checklist. Les lignes qui suivent un retour à la ligne sont écrites indentées sous la case (`- [ ] Lait  ⏎  demi-écrémé`), et relues dans le même texte (`SafeTaskItem`, `editor/extensions.ts`). C'est vrai aussi pour une checklist placée sous une puce, où la ligne suivante revenait en texte nu dans la case : le document devenait invalide et la ligne ne pouvait plus être modifiée.

**Corrigé en phase 4, après les revues** (déjà présent avant la phase 4, sauf mention) :
- **Listes numérotées lues par `marked`**, comme les listes à puces. Le lecteur de TipTap prenait toute ligne qui ressemble à un numéro (`1.`, `a)`, « M. Dupont ») pour un nouvel élément, même dans un bloc de code ou une sous-liste, et faisait commencer le texte d'un élément une espace trop tôt : un bloc de code contenant `1. npm ci` était perdu, un bloc de code gagnait une espace à chaque ouverture, un tableau devenait du texte, un bloc placé après une sous-liste numérotée descendait d'un niveau, une checklist sous un élément numéroté se défaisait. Le lecteur GFM de `marked` ne prend que 1 à 9 chiffres. Un élément numéroté vide est écrit `2.` sans espace après (comme `-` pour une puce). Le premier tour de revue avait contourné le décalage d'une espace en écrivant les numéros `01. ` pour le lecteur de TipTap : ce contournement a disparu avec lui.
- **Texte d'un élément de liste lu en Markdown** (régression du premier tour de revue) : dans une liste serrée, `marked` donne le texte d'un élément en jetons `text`, que le nœud Text de TipTap garde bruts. Un paragraphe placé après une sous-liste revenait avec ses `[ici](…)` et `**vite**` en clair, échappés une fois de plus à chaque sauvegarde ; dans une case cochable sous une puce, le document devenait même invalide. Ces jetons sont lus comme les paragraphes qu'ils sont (`textAsParagraphs`), dans les éléments de liste et dans les cases.
- Le lecteur Markdown mettait un temps qui croît avec le carré de la longueur de la note : les lecteurs de TipTap pour les checklists et les tableaux découpaient tout le reste du texte en lignes au début de chaque bloc (3,6 s pour 4 000 checklists courtes, 1,1 s pour 4 000 paragraphes). Ils ne reçoivent plus que les lignes qui peuvent les concerner, la liste s'arrêtant aussi à une ligne vide suivie d'une ligne non indentée : 50 ms et 40 ms, et 8 000 checklists séparées par des lignes vides se lisent en moins d'une seconde. Un test le vérifie sur 8 000 blocs de chaque forme.
- Les lignes qui suivent un retour à la ligne (`Maj+Entrée`) dans un élément de liste sont écrites indentées sous son texte, comme dans une case cochable : non indentée, une ligne qui commence par `#` (`#projet`) sortait de la liste et la coupait en deux.
- Une ligne de texte placée sous une sous-liste, pas assez indentée, était lue comme du texte nu dans l'élément (document invalide) : elle devient un paragraphe de l'élément.
- Un séparateur juste sous un paragraphe d'un élément de liste ou d'une case (`- a⏎  ---`) faisait de ce paragraphe un titre : une ligne vide les sépare, hors des blocs de code, et jamais juste sous la marque d'un élément vide (`-⏎  ---`), où elle sortirait le séparateur de la liste.
- Un tableau placé juste après une sous-liste, dans un élément, continuait le texte du dernier sous-élément : une ligne vide l'en sépare.
- Une case `[ ]` / `[x]` au début d'un élément numéroté (Markdown collé ou importé) disparaissait : `marked` la lit comme une case, qu'un élément numéroté ne sait pas montrer. Elle reste du texte.
- Un séparateur de ligne Unicode (U+2028, U+2029, collé depuis certaines applications) dans une case cochable la faisait relire comme une puce sans case : il est écrit `&#8232;` / `&#8233;`.
- Un sous-élément fait d'une seule barre (`- |`) faisait de l'élément au-dessus un tableau : une ligne faite seulement de `|`, `:`, `-` et d'espaces a ses barres échappées.
- Un simple clic sur un lien d'une note en lecture seule (corbeille, aperçu du tri) l'ouvrait dans le navigateur, ou rechargeait l'application pour un lien refusé (`file:`, écrit avec une adresse vide) : seul `Ctrl+clic` ouvre un lien, dans tous les cas.

- Un titre qui finit par `#` précédé d'une espace (`## Langage C #`) perdait ce `#` à la réouverture : Markdown y voit la fermeture facultative du titre (`## Titre ##`). Le premier `#` de cette fin est échappé (`## Langage C \#`), par `SafeHeading` (`@tiptap/extension-heading`, déclarée en dépendance directe, validé par Pierre).

- **`marked` 18** (essayé à la demande de Pierre après la phase 4) : `marked` 17 reconstruisait tout le paragraphe à chaque caractère échappé (`\*`, `\_`, `\[`…) ou code en ligne, pour le masquer avant de chercher le gras et l'italique. Le temps croissait avec le carré de leur nombre : une note de texte de 4 000 lignes de journal (un seul paragraphe) prenait 7,8 s à lire. `marked` 18.0.7 fait ce masquage en un seul passage : 0,56 s. `@tiptap/markdown` déclare encore `marked` ^17 : une règle `overrides` de `package.json` lui donne le même `marked` 18 que l'application (une seule copie). Vérifié : les 3 034 documents d'un corpus (fixtures, notes converties, lignes vides en tout genre, documents tirés au hasard) sont lus et réécrits à l'identique avec les deux versions ; un test le surveille (8 000 lignes de journal).

**Limites connues** (à reprendre en phase 7, avec l'accord de Pierre) :
- Dans une note écrite avant la phase 4, une ligne qui suit un retour à la ligne dans un élément numéroté et qui commence par `#` (`#projet`) sort de la liste à la réouverture : ces lignes n'étaient pas indentées (elles le sont maintenant). Le texte reste.
- Un seul élément de liste de milliers de lignes (un long texte collé dans une puce) se lit en temps quadratique, par `marked` lui-même, en version 17 comme en 18 : environ 3 s pour 8 000 lignes.
- Un paragraphe vide laissé à la fin d'un élément de liste n'a pas d'écriture Markdown : il ne revient pas à la réouverture.

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
- Clic sur un lien : `Ctrl+clic` (desktop) / appui long (mobile) pour l'ouvrir dans le navigateur système. Un simple clic ne l'ouvre jamais, même dans une note en lecture seule.
- `Échap` dans l'éditeur ferme d'abord le menu « / », sinon quitte le mode concentration, sinon revient à la carte de la note dans la liste (`08-interface.md`).

### Comptage des cases à cocher (reporté)
Il ne servait qu'au mode de mèche « quand tout est coché », retiré de la V1 en phase 2 (`06-autodestruction.md`) : pas de module `markdown/` ni de `pulldown-cmark` pour l'instant. Notes pour plus tard (vérifié en phase 2) : `pulldown-cmark` 0.13 (MIT), avec l'option task lists, compte exactement les cases que TipTap affiche sur la sortie de l'éditeur (fixtures, cases imbriquées, `[X]`, cases dans les blocs de code y compris les clôtures longues, `\[ \]`, `&#32;`, `M\.`), sauf `1. [ ] x` écrit à la main (TipTap n'en fait pas une case) : ne compter que les cases des listes à puces.

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
