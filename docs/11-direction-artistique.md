# 11 — Direction artistique

## Identité

- **Nom** : **Mèche** (affiché `mèche`, en minuscules, dans le logo ; « Mèche » dans les phrases).
- **Idée centrale** : une note éphémère est une note dont on a **allumé la mèche**. La mèche se consume pendant le compte à rebours, puis la note explose.
- **Personnalité** : joyeuse, colorée, contrastée, un brin espiègle. Jamais grise, jamais triste. Mais l'écriture reste confortable : la couleur vit autour du texte, pas dessous.
- **Identifiants techniques** : application `fr.pierrebultez.meche` (sans accent), nom affiché « Mèche », API `https://meche.pierrebultez.com/api`.

## Deux thèmes, une même marque

| | Thème clair « **Fugace** » | Thème sombre « **Feu d'artifice** » |
|---|---|---|
| Ambiance | Bonbon acidulé : fond blanc lumineux, couleurs vives et fraîches | Nuit de feu d'artifice : indigo profond, couleurs néon inspirées de **Monokai** |
| Couleur de marque | Violet électrique | Orange flamme + jaune étincelle |
| Notes | Cartes teintées pastel, chacune de sa couleur | Cartes indigo, titre et liseré dans la couleur néon de la note |

Bascule : réglage **Clair / Sombre / Système**, et raccourci dans la palette `Ctrl+K`. Changement instantané (variables CSS), sans rechargement.

## Jetons de couleur de l'interface

Définis comme variables CSS (Tailwind 4 `@theme` + surcharge `[data-theme="dark"]`), dans `app/src/styles/tokens.css`.

| Jeton | Fugace (clair) | Feu d'artifice (sombre) | Usage |
|---|---|---|---|
| `--bg` | `#FFFFFF` | `#1A1446` | Fond de l'application |
| `--surface` | `#F7F5FC` | `#231B5C` | Colonne de liste, panneaux |
| `--surface-2` | `#EFEBF8` | `#2E2575` | Survol, champs, menus |
| `--border` | `#E4DEF2` | `#3A3180` | Séparateurs |
| `--text` | `#1C1433` | `#F8F8F2` | Texte principal (le blanc cassé de Monokai) |
| `--text-muted` | `#6B6489` | `#B9B2F0` | Aperçus, dates |
| `--brand` | `#7B2FF7` | `#FF6B1A` | Bouton +, éléments actifs, focus |
| `--brand-2` | `#FF4FA3` | `#FFC93C` | Accent secondaire (étincelle) |
| `--on-brand` | `#FFFFFF` | `#1A1446` | Texte sur `--brand` |
| `--danger` | `#DE3035` | `#FF5370` | Suppression, erreurs |
| `--fuse` | `#B38C65` | `#8C7A5B` | Mèche non consumée (cordon) |
| `--spark` | `#E87500` | `#FFC93C` | Étincelle, mèche allumée |
| `--selection` | `#7B2FF733` | `#AE81FF4D` | Sélection de texte |

## Couleur par note

Chaque note a **sa propre couleur**, pour qu'on la repère d'un coup d'œil. Huit couleurs, stockées par **nom** (pas par code hexadécimal), pour que chaque thème applique sa propre variante.

| Nom (`color`) | Fugace : accent | Fugace : fond de carte | Fugace : texte sur fond | Feu d'artifice : néon | Feu d'artifice : titre sur carte |
|---|---|---|---|---|---|
| `violet` | `#7B2FF7` | `#F1E8FF` | `#3A0F80` | `#AE81FF` | `#CDA1FF` |
| `rose` | `#FF4FA3` | `#FFE6F2` | `#85154D` | `#F92672` | `#FF7BB2` |
| `corail` | `#FF5A5F` | `#FFE8E6` | `#8A1C1F` | `#FF6B6B` | `#FF918E` |
| `orange` | `#E87500` | `#FFEEDC` | `#7A3A00` | `#FD971F` | `#FF9D2A` |
| `citron` | `#C38800` | `#FFF6D6` | `#6B4E00` | `#E6DB74` | = néon |
| `pomme` | `#21AB36` | `#E5F8E1` | `#1F5E1F` | `#A6E22E` | = néon |
| `turquoise` | `#00A88F` | `#DDFBF5` | `#04584B` | `#4FE3C1` | = néon |
| `bleu` | `#2F80FF` | `#E4EEFF` | `#0E3C8A` | `#66D9EF` | = néon |

Les néons du thème sombre reprennent volontairement la palette Monokai (`#F92672`, `#FD971F`, `#E6DB74`, `#A6E22E`, `#66D9EF`, `#AE81FF`). Sur une carte teintée, quatre néons manquaient de contraste pour le titre : la colonne « titre sur carte » en donne une version plus claire, utilisée uniquement à cet endroit (le liseré et l'éditeur gardent le néon d'origine).

**Attribution** :
- À la création, couleur choisie automatiquement : suivre un ordre mélangé des 8 couleurs, en évitant les couleurs des 2 notes les plus récentes.
- Modifiable dans le menu ⋯ de la note (8 pastilles) et dans la palette `Ctrl+K` (« Changer la couleur »).
- À l'import Standard Notes : attribution en rotation.

**Où la couleur apparaît** :
| Élément | Fugace | Feu d'artifice |
|---|---|---|
| Carte dans la liste | Fond = « fond de carte », titre et aperçu = « texte sur fond » | Fond `--surface-2` mélangé à 12 % de néon (`color-mix`), liseré gauche de 3 px en néon, titre en « titre sur carte » |
| Note sélectionnée | Bordure 2 px en accent | Fond mélangé à 20 % + liseré 3 px |
| Éditeur | Titre de la note en accent, cases cochées remplies avec l'accent, puces et marqueurs de titres en accent | Idem avec le néon |
| Fond de l'éditeur | Reste `--bg` (blanc) : la lecture reste reposante | Reste `--bg` (indigo) |

**Contraste** : Claude Code doit vérifier par un petit test automatisé (ratio WCAG) que chaque paire texte/fond atteint **4,5:1** (texte courant) ou **3:1** (gros titres, icônes). Ajuster d'un cran si une paire échoue, sans changer l'esprit des couleurs.

- Le test est `app/src/theme/tokens.test.ts` : il lit `tokens.css` et vérifie les deux thèmes.
- Phase 0 (validé par Pierre) : en Fugace, `--danger`, `--fuse`, `--spark`, les accents orange, citron, pomme et turquoise et cinq couleurs de code ont été légèrement assombris (teinte conservée) ; en Feu d'artifice, la colonne « titre sur carte » a été ajoutée. Les valeurs de ce document sont les valeurs ajustées.
- **À trancher avant la phase concernée** (paires dont l'usage n'est pas encore défini, elles échouent avec les couleurs actuelles) :
  - `--danger` sur `--surface` / `--surface-2` (menus, panneaux) : 4,24 et 3,91 en Fugace, 4,86 et 4,11 en sombre (phase 1) ;
  - le badge mèche posé sur une carte : `--fuse` et `--spark` (3:1) et le texte `--danger` (4,5:1) échouent sur presque toutes les cartes (phase 2) ;
  - l'aperçu d'une carte sombre sélectionnée en `--text-muted` (4,15 à 4,34 pour citron, pomme, turquoise, bleu) : utiliser `--text` ou la couleur du titre (phase 1) ;
  - l'indicateur de carte sélectionnée (3:1 attendu pour un élément d'interface) : en Fugace, la bordure 2 px en accent n'atteint que 2,59 à 2,84 sur la carte et sur `--surface` pour rose, corail, orange, citron, pomme et turquoise ; en Feu d'artifice, seul le fond change (12 % → 20 %, contraste de 1,08 à 1,22 entre les deux états). Pistes : bordure dans la couleur « texte sur fond », ou fond sélectionné plus marqué (phase 1).

## La mèche (élément signature)

### Badge dans la liste
- Une petite mèche horizontale (≈ 40 px) en bas à droite de la carte : le cordon (`--fuse`) dont la **longueur restante est proportionnelle au temps restant** (`(destroy_at − now) / (delay)`), terminé par une **étincelle** (`--spark`) qui scintille, suivie du texte « 2 j », « 5 h », « 12 min ».
- Moins d'une heure : l'étincelle scintille plus vite, le texte passe en `--danger`.
- Mode « quand tout est coché » pas encore armé : mèche **éteinte** (cordon entier, pas d'étincelle) + « 3/5 ».

### Dans la note
- Quand la mèche est allumée, une **longue mèche** court sur toute la largeur, juste sous l'en-tête de la note, et se consume en temps réel de droite à gauche, l'étincelle au bout.
- Le bouton de l'en-tête est une icône de mèche (Lucide n'en a pas : dessiner une icône SVG maison, cordon courbe + étoile d'étincelle), éteinte ou allumée.
- Libellés : « Allumer la mèche » / « Éteindre la mèche », « Explose dans 2 j 4 h », « Mèche en attente : 3 cases sur 5 ».

### Explosion
- **V1 (simple)** : quand une note explose pendant que l'application est ouverte, sa carte fait un bref flash `--spark`, rétrécit et disparaît (≈ 300 ms), puis notification « Boum ! « Courses » a explosé — Annuler ».
- **V2 (plus tard)** : vraie animation d'explosion (particules aux couleurs de la note, petite secousse), et action « Faire exploser maintenant » qui joue l'animation immédiatement.
- Toutes les animations respectent `prefers-reduced-motion` : dans ce cas, simple fondu, étincelle fixe.

## Coloration du code

Un thème par mode, **partagé** entre CodeMirror (notes code) et lowlight (blocs de code des notes riches), défini une seule fois en variables CSS (`--code-keyword`, etc.).

| Jeton | Fugace (clair) | Feu d'artifice (sombre, façon Monokai) |
|---|---|---|
| Fond du bloc | `#F7F5FC` | `#120E33` |
| Texte | `#1C1433` | `#F8F8F2` |
| Mot-clé, opérateur | `#D4216D` | `#F92672` |
| Chaîne | `#916900` | `#E6DB74` |
| Fonction, méthode | `#2B8100` | `#A6E22E` |
| Nombre, constante, booléen | `#7B2FF7` | `#AE81FF` |
| Type, classe | `#0077B6` | `#66D9EF` |
| Variable, paramètre | `#BF4C00` | `#FD971F` |
| Commentaire | `#736C8E` | `#8A82C4` |

## Typographie

- Interface et notes : pile système (`system-ui`, `Segoe UI`, `Ubuntu`, `Roboto`, sans-serif).
- Code : `JetBrains Mono` **embarquée dans l'application** (fichier local, licence OFL, pas de téléchargement réseau), repli `ui-monospace`, `monospace`.
- Logo `mèche` : même police système en gras, avec l'accent grave remplacé par une petite étincelle dans le logo uniquement.
- Poids : 400 et 600 seulement. Titres de note 26 px (desktop) / 24 px (mobile).

## Formes et mouvement

- Coins arrondis généreux : 12 px pour les cartes, 10 px pour les boutons, pastilles entièrement rondes.
- Pas d'ombres lourdes. En clair, une ombre très douce sur la carte sélectionnée ; en sombre, aucune ombre (les néons suffisent).
- Animations courtes (150 à 300 ms), avec un léger rebond sur les apparitions (bouton +, notifications).

## Icône de l'application

- Fond carré arrondi **indigo `#1A1446`**.
- Une mèche courbe en forme de « m » stylisé, cordon crème, terminée par une **étincelle** orange et jaune (`#FF6B1A` / `#FFC93C`).
- Lisible à 32 px (barre des tâches) et en icône adaptative Android (premier plan / arrière-plan séparés).
- Claude Code produit l'icône source en SVG, puis génère toutes les tailles avec `npm run tauri icon`.

## Ton des textes

Joueur, mais toujours clair. Le vocabulaire de la mèche ne remplace jamais le sens : « Corbeille » reste « Corbeille ».

| Situation | Texte |
|---|---|
| Activer l'autodestruction | Allumer la mèche |
| Compte à rebours | Explose dans 2 j |
| Note explosée | Boum ! « Courses » a explosé. Annuler |
| Restaurer depuis la corbeille | Restaurer (la mèche est éteinte) |
| Liste vide | Rien ici pour l'instant. `Ctrl+N` pour écrire. |
| Corbeille vide | Corbeille vide. Les notes y restent 7 jours. |
| Filtre des éphémères | Mèches allumées |
| Création rapide | Nouvelle checklist à mèche |
