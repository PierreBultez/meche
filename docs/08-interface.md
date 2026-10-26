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
│ Courses                  │  - [x] Lait                                   │
│    Lait, pain…  ⏳ 1 h   │  - [ ] Pain                                   │
│ Snippet Laravel  </>     │                                               │
│    Route::get…   3 sem   │  ```php                                       │
│                          │  Route::get('/', …);                          │
│                          │  ```                                          │
│ ─────────────────────── │                                               │
│ Toutes ▾      ● Synchro  │                                               │
└──────────────────────────┴───────────────────────────────────────────────┘
```
- **Colonne gauche** (280 px, redimensionnable, masquable avec `Ctrl+\`) : recherche, bouton nouvelle note, liste. La largeur va de 220 à 520 px ; on la change en glissant la séparation ou avec `←` `→` quand la séparation a le focus, et elle est mémorisée (réglage `list_width`). Dans la liste, `↑` `↓` passent d'une carte à l'autre et `Entrée` ouvre la note.
- **Élément de liste** : carte aux couleurs de la note ; titre (ou première ligne), aperçu d'une ligne, date relative, icônes : 📌 épinglée, `</>` note code. Quand la mèche est allumée, le badge mèche (pastille, icône, temps restant) prend la place de la date.
- **Pied de colonne** : filtre (Toutes / Épinglées / Mèches allumées / Corbeille) et pastille d'état de synchro (vert `--ok` = à jour, gris = hors ligne ou pas de serveur, orange `--spark` = en cours, rouge = erreur ; survol = détail). Phase 3 (`components/sync/SyncDot.vue`) : l'orange n'apparaît que si la synchro dure plus de 400 ms (pas de clignotement chaque minute) ; un clic synchronise maintenant, ou ouvre Réglages › Serveur sans serveur connecté. La pastille a son propre store : elle ne redessine jamais la liste.
- **En-tête de note** : titre éditable, temps restant « Explose dans … » quand la mèche est allumée, bouton mèche, épingler, menu ⋯ (couleur de la note, convertir riche/code, copier en Markdown, retour à la ligne pour le code, mettre à la corbeille).
- **Mode concentration** (`Ctrl+Shift+F`) : masque la colonne et l'en-tête.

## Mobile (Android) — largeur < 768 px

- **Écran 1, liste** : barre de recherche en haut, liste plein écran, **bouton flottant +** en bas à droite (appui long → « Nouvelle note code » / « Nouvelle note à mèche »). Filtre accessible par un menu en haut.
- **Écran 2, note** : flèche retour, titre, icônes 📌 ⏳ ⋯ ; éditeur plein écran ; barre d'outils au-dessus du clavier (voir `05-editeur.md`).
- **Gestes** : glisser un élément de liste vers la gauche → corbeille (avec « Annuler ») ; vers la droite → épingler.
- Le **bouton retour Android** ferme la note (après sauvegarde) puis quitte l'application depuis la liste.
- Zones tactiles ≥ 44 px. Respect des encoches et de la barre de navigation (safe areas).
- Tirer la liste vers le bas → synchro manuelle.

## Palette de commandes `Ctrl+K` (desktop)

Recherche floue sur les notes **et** les actions :
- Ouvrir une note (résultats de recherche plein texte).
- Nouvelle note, nouvelle note code, nouvelle note à mèche.
- Changer la couleur de la note, allumer / éteindre la mèche.
- Afficher : toutes / épinglées / mèches allumées / corbeille.
- Synchroniser maintenant, thème clair/sombre/système, réglages, importer depuis Standard Notes.

Fonctionnement (phase 1) :
- Palette vide : les 5 premières notes de la liste, puis toutes les actions.
- En tapant : d'abord les actions dont chaque mot tapé commence un mot (« nouv code » → « Nouvelle note code »), puis les notes (recherche plein texte, 8 au plus, avec l'extrait surligné). Les actions trouvées seulement en recherche floue (« nvnote ») ne s'affichent que si rien d'autre ne correspond : sinon elles noient les résultats.
- `↑` `↓` pour choisir, `Entrée` pour lancer, `Échap` ou un clic à côté pour fermer, `Ctrl+K` pour rouvrir ou fermer.
- Phase 4 : « Importer depuis Standard Notes » (toujours) et « Reprendre le tri (n notes) » quand des notes importées attendent le tri.
- Actions de la phase 1 : nouvelle note, nouvelle note code ; pour la note ouverte : épingler / désépingler, les 7 autres couleurs, convertir riche ↔ code, mettre à la corbeille (ou restaurer si elle y est) ; afficher toutes / épinglées / mèches allumées / corbeille ; thème clair / sombre / système ; masquer ou afficher la liste ; mode concentration ; réglages. Phase 2 : « Nouvelle note à mèche » (toujours) et « Allumer / Éteindre la mèche » (note ouverte, hors corbeille). Phase 3 : « Synchroniser maintenant » (quand un serveur est connecté ; une notification dit si la synchro a réussi). L'import arrive avec sa phase.

## Raccourcis desktop

| Raccourci | Action |
|---|---|
| `Ctrl+K` | Palette de commandes |
| `Ctrl+N` | Nouvelle note |
| `Ctrl+Shift+N` | Nouvelle note code |
| `Ctrl+F` | Rechercher dans les notes (dans une note code : rechercher dans la note) |
| `Ctrl+P` | Épingler / désépingler |
| `Ctrl+Shift+E` | Allumer / éteindre la mèche de la note ouverte |
| `Ctrl+Suppr` | Mettre à la corbeille |
| `Ctrl+↑` / `Ctrl+↓` | Note précédente / suivante |
| `Ctrl+\` | Afficher / masquer la liste |
| `Ctrl+Shift+F` | Mode concentration |
| `Échap` | Revenir à la liste / fermer un panneau |

Précisions (phase 1) :
- Les raccourcis `Ctrl` sont pris avant les éditeurs : `Ctrl+Suppr` met la note à la corbeille même dans le texte (la notification « Annuler » permet de revenir en arrière), `Ctrl+↑` / `Ctrl+↓` changent de note.
- Exception : dans une note code, `Ctrl+F` ouvre la recherche de CodeMirror dans la note.
- Ils ne font rien quand une fenêtre de confirmation est ouverte. `Ctrl+P`, `Ctrl+Maj+E`, `Ctrl+Suppr` et `Ctrl+↑` / `Ctrl+↓` n'agissent que sur l'écran des notes, et jamais sur une note de la corbeille (lecture seule). Garder les touches enfoncées ne répète que `Ctrl+↑` / `Ctrl+↓`.
- `Échap`, dans l'ordre : ferme le menu ouvert (menu ⋯, menu `/`, recherche de CodeMirror, palette, confirmation) ; sinon quitte le mode concentration ; sinon, depuis la note, remet le focus sur sa carte dans la liste ; sinon, depuis les réglages ou l'écran de tri, revient à la note ouverte (le tri garde sa progression) ; depuis l'écran d'import, revient aux réglages. Dans le champ de recherche, `Échap` efface la recherche.
- Écran de tri (phase 4, `07-import-standard-notes.md`) : `G` ou `→` garder, `E` mèche, `S` ou `←` supprimer, `Espace` passer, `Ctrl+Z` annuler. Ces lettres seules n'agissent que sur cet écran.

## Écrans secondaires

- **Réglages** : serveur (URL, test de connexion, connexion / déconnexion, nom de l'appareil, dernière synchro), mèche (un seul délai : 1 h, 24 h, 3 j, 7 j ou 30 j ; 7 j par défaut ; ne change pas les mèches déjà allumées), apparence (thème, taille du texte), import Standard Notes, à propos (version, mises à jour).
  En phase 1 : thème, retour à la ligne des notes code, version. Phase 2 : section « Mèche ». Les autres sections arrivent avec leur phase ; la taille du texte n'est pas encore proposée.
  Phase 3 : section « Serveur » en tête (`components/settings/ServerSettings.vue`). Sans compte : « J'ai un compte » / « Créer un compte » (avec un code d'invitation), adresse du serveur (`https://meche.pierrebultez.com` proposée) avec « Tester », e-mail, mot de passe, nom de l'appareil (le nom de l'ordinateur par défaut). Se connecter à un autre compte que le précédent demande d'abord une confirmation (ses notes y seront envoyées). Une fois connecté : serveur, compte, appareil, état de la synchro, écart d'horloge éventuel, « Synchroniser maintenant », « Se déconnecter » ; puis « Appareils connectés » (déconnecter un appareil perdu) et « Inviter quelqu'un » (codes d'invitation, affichés une seule fois, avec « Copier » et « Retirer »).
- **Import et tri** (phase 4, `views/ImportView.vue`, `views/TriageView.vue`) : section « Import » des réglages (« Importer depuis Standard Notes », « Reprendre le tri »), écran du récapitulatif (`/import`), écran de tri (`/tri`). Voir `07-import-standard-notes.md`.
- **Premier lancement** (phase 3, `views/WelcomeView.vue`) : écran simple « Connecter un serveur » ou « Utiliser hors ligne pour l'instant », affiché au démarrage tant qu'aucun serveur n'est connecté et que la question n'a pas reçu de réponse (réglage `welcome_done`).
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

Mise en œuvre (phase 1) :
- La liste est virtualisée dès le départ : seules les cartes visibles sont dans la page, et toutes les cartes ont la même hauteur (mesurée sur la première). Mesuré avec 1 000 notes : sans cela, ouvrir une note prenait 1 à 2 s, car toute la liste était redessinée.
- Une carte est un simple lien, pas un `RouterLink` : chacun était recalculé à chaque changement de note.
- Une note ouverte au clavier (`Ctrl+↑` / `Ctrl+↓`, palette, `Entrée` sur une carte) reçoit le focus dans son texte : on peut taper aussitôt. Un clic de souris sur une carte laisse le focus sur la carte.

Mise en œuvre (phase 2) :
- Le temps restant des mèches est rafraîchi par **une seule horloge partagée** (`composables/useNow.ts`) : une fois par minute, arrêtée quand la fenêtre est cachée, remise à l'heure au retour sur la fenêtre. Seul le composant qui affiche le temps restant s'y abonne : une carte sans mèche n'est jamais redessinée, et la liste non plus. Le badge a la hauteur de la ligne : la carte garde sa hauteur (liste virtualisée).
- Mesures (build release, juste après la phase 2) : démarrage à froid jusqu'à la fenêtre affichée ≈ 0,45 s, identique à la phase 1 ; recherche sur 1 000 notes 6 à 8 ms ; `list_notes` (1 000 résumés) 8 ms, dont 1 ms pour la maintenance de la mèche ; paquet `.deb` 4,2 Mo.
