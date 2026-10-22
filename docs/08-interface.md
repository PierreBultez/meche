# 08 — Interface

> Les couleurs, thèmes, la mèche et le ton des textes sont définis dans `11-direction-artistique.md`, qui prime sur ce document en cas de différence. Les « ⏳ » des schémas ci-dessous représentent le badge mèche.

## Principes

- **Épurée** : aucun élément qui ne sert pas à écrire ou à retrouver une note. Pas de barre latérale de dossiers, pas de tags.
- **Le contenu d'abord** : l'éditeur occupe l'espace, les commandes apparaissent quand on en a besoin.
- **Clavier d'abord sur desktop**, pouce d'abord sur mobile.
- **Instantanée** : aucun indicateur de chargement visible pour les actions locales.
- Moderne, **colorée et joyeuse** : couleurs vives et contrastées, une couleur par note, coins arrondis généreux, mais un éditeur reposant (la couleur vit autour du texte).

## Fondations visuelles

- **Police** : pile système (`system-ui`, `Segoe UI`, `Ubuntu`, `Roboto`, sans-serif) pour l'interface ; `JetBrains Mono` embarquée localement pour le code. Aucune police téléchargée depuis le réseau.
- **Taille de texte de l'éditeur** : 16 px desktop, 17 px mobile, interligne 1,6, largeur de lecture limitée à ~72 caractères (centrée).
- **Thèmes** : clair « Fugace », sombre « Feu d'artifice », ou système. Jetons et couleurs de note : voir `11-direction-artistique.md`.
- **Icônes** : Lucide, 18 px, trait fin.
- **Animations** : courtes (≤ 150 ms), uniquement pour les transitions d'état. Respecter `prefers-reduced-motion`.

## Desktop (Linux, Windows) — largeur ≥ 768 px

```
┌──────────────────────────┬───────────────────────────────────────────────┐
│ 🔍 Rechercher…     [+]   │  Titre de la note             📌  ⏳  ⋯      │
│ ─────────────────────── │                                               │
│ 📌 Mémo serveur          │  Contenu de la note…                          │
│    Apache, certbot…  2 j │                                               │
│ Courses        ⏳ 3/5    │  - [x] Lait                                   │
│    Lait, pain…     1 h   │  - [ ] Pain                                   │
│ Snippet Laravel  </>     │                                               │
│    Route::get…   3 sem   │  ```php                                       │
│                          │  Route::get('/', …);                          │
│                          │  ```                                          │
│ ─────────────────────── │                                               │
│ Toutes ▾      ● Synchro  │                                               │
└──────────────────────────┴───────────────────────────────────────────────┘
```
- **Colonne gauche** (280 px, redimensionnable, masquable avec `Ctrl+\`) : recherche, bouton nouvelle note, liste.
- **Élément de liste** : carte aux couleurs de la note ; titre (ou première ligne), aperçu d'une ligne, date relative, icônes : 📌 épinglée, `</>` note code, badge mèche.
- **Pied de colonne** : filtre (Toutes / Épinglées / Mèches allumées / Corbeille) et pastille d'état de synchro (vert = à jour, gris = hors ligne, orange = en cours, rouge = erreur ; survol = détail).
- **En-tête de note** : titre éditable, épingler, bouton mèche, menu ⋯ (couleur de la note, convertir riche/code, copier en Markdown, retour à la ligne pour le code, mettre à la corbeille).
- **Mode concentration** (`Ctrl+Shift+F`) : masque la colonne et l'en-tête.

## Mobile (Android) — largeur < 768 px

- **Écran 1, liste** : barre de recherche en haut, liste plein écran, **bouton flottant +** en bas à droite (appui long → « Nouvelle note code » / « Nouvelle checklist à mèche »). Filtre accessible par un menu en haut.
- **Écran 2, note** : flèche retour, titre, icônes 📌 ⏳ ⋯ ; éditeur plein écran ; barre d'outils au-dessus du clavier (voir `05-editeur.md`).
- **Gestes** : glisser un élément de liste vers la gauche → corbeille (avec « Annuler ») ; vers la droite → épingler.
- Le **bouton retour Android** ferme la note (après sauvegarde) puis quitte l'application depuis la liste.
- Zones tactiles ≥ 44 px. Respect des encoches et de la barre de navigation (safe areas).
- Tirer la liste vers le bas → synchro manuelle.

## Palette de commandes `Ctrl+K` (desktop)

Recherche floue sur les notes **et** les actions :
- Ouvrir une note (résultats de recherche plein texte).
- Nouvelle note, nouvelle note code, nouvelle checklist à mèche.
- Changer la couleur de la note, allumer / éteindre la mèche.
- Afficher : toutes / épinglées / mèches allumées / corbeille.
- Synchroniser maintenant, thème clair/sombre/système, réglages, importer depuis Standard Notes.

## Raccourcis desktop

| Raccourci | Action |
|---|---|
| `Ctrl+K` | Palette de commandes |
| `Ctrl+N` | Nouvelle note |
| `Ctrl+Shift+N` | Nouvelle note code |
| `Ctrl+F` | Rechercher dans les notes (dans une note code : rechercher dans la note) |
| `Ctrl+P` | Épingler / désépingler |
| `Ctrl+Shift+E` | Panneau de la mèche |
| `Ctrl+Suppr` | Mettre à la corbeille |
| `Ctrl+↑` / `Ctrl+↓` | Note précédente / suivante |
| `Ctrl+\` | Afficher / masquer la liste |
| `Ctrl+Shift+F` | Mode concentration |
| `Échap` | Revenir à la liste / fermer un panneau |

## Écrans secondaires

- **Réglages** : serveur (URL, test de connexion, connexion / déconnexion, nom de l'appareil, dernière synchro), autodestruction (délais par défaut des deux modes), apparence (thème, taille du texte), import Standard Notes, à propos (version, mises à jour).
- **Premier lancement** : écran simple « Connecter un serveur » ou « Utiliser hors ligne pour l'instant ».
- **États vides** : liste vide, recherche sans résultat, corbeille vide. Textes : voir « Ton des textes » dans `11-direction-artistique.md`.

## Budgets de performance (à mesurer)

| Mesure | Objectif |
|---|---|
| Démarrage à froid → liste affichée (desktop) | < 1 s |
| Démarrage à froid (Android milieu de gamme) | < 1,5 s |
| Ouverture d'une note | < 50 ms |
| Résultat de recherche pendant la frappe (1 000 notes) | < 30 ms |
| Frappe dans l'éditeur | aucune latence perceptible (sauvegarde différée, hors du fil principal côté Rust) |
| Taille de l'installeur desktop | < 15 Mo |

Moyens : CodeMirror et ses langages chargés à la demande ; TipTap chargé dès la première note ouverte ; liste virtualisée au-delà de 200 éléments ; `list_notes` ne renvoie que les résumés, jamais le contenu complet.
