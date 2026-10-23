# 01 — Vision et périmètre

## Pourquoi ce projet

Pierre utilise Standard Notes depuis longtemps. Trois problèmes :

1. **Lenteur** : ouverture, recherche et changement de note ne sont pas instantanés.
2. **Paywall** : le type de note « Super » (mise en forme riche, checklists, code dans une même note) est réservé à l'abonnement, jugé trop cher.
3. **Interface** : chargée, fatigante.

Il accumule aussi beaucoup de **notes jetables** (listes de courses, checklists ponctuelles) qu'il ne prend jamais le temps de supprimer.

## Objectif

**Mèche** : une application de notes **personnelle**, **instantanée**, **épurée**, disponible sur ses appareils (PC Linux, PC Windows, téléphone Android), avec les notes synchronisées via son propre serveur.

## Principes directeurs

- **La vitesse avant tout** : tout se passe en local, le réseau n'est jamais sur le chemin critique.
- **Peu de fonctionnalités, mais parfaites** : uniquement ce que Pierre utilise réellement.
- **Pas d'enfermement** : les notes sont stockées en Markdown, lisibles sans l'application.
- **Le ménage se fait tout seul** : les notes jetables s'autodétruisent.
- **100 % gratuit** : aucune dépendance ni service payant.

## Périmètre V1

| Fonction | Détail |
|---|---|
| Notes riches | Un seul type de note qui mélange tout : titres, gras/italique/barré, listes, **checklists**, citations, liens, séparateurs, tableaux, **blocs de code colorés**. Stockées en Markdown (GFM). |
| Notes code | Note entièrement en code, avec choix du langage et coloration syntaxique. |
| Liste des notes | Triée par date de modification, notes épinglées en haut, aperçu de la première ligne. |
| Recherche | Plein texte, instantanée pendant la frappe, insensible aux accents. |
| Épingler | Épingler / désépingler une note. |
| Notes à mèche | « Allumer la mèche » sur n'importe quelle note : elle part seule à la corbeille à la fin d'un délai (1 h, 24 h, 3 j, 7 j ou 30 j, un seul réglage, 7 j par défaut). Le temps restant s'affiche sur la carte et dans la note. Voir `06-autodestruction.md`. |
| Corbeille | Suppression réversible, purge automatique après 7 jours. |
| Synchro | Avec l'API Laravel sur le serveur de Pierre, hors ligne d'abord. |
| Import | Sauvegarde Standard Notes (~100 notes) + écran de tri rapide. |
| Couleur par note | Chaque note a sa couleur (8 couleurs), attribuée automatiquement, modifiable. |
| Thèmes | Clair « Fugace » / sombre « Feu d'artifice » / système. Voir `11-direction-artistique.md`. |
| Clavier | Palette de commandes `Ctrl+K`, raccourcis principaux. |
| Plateformes | Linux, Windows, Android. |

## Hors périmètre (explicitement exclu)

- Tags et dossiers : Pierre ne s'en sert pas.
- Chiffrement de bout en bout : serveur personnel, pas nécessaire.
- Multi-utilisateurs, partage, collaboration temps réel.
- iOS et macOS.
- Version web dans le navigateur.

## Idées pour plus tard (V2+)

- Mèche plus riche (retirée de la V1 en phase 2 pour rester simple) : mode « quand tout est coché », délai choisi note par note ou personnalisé, panneau de la mèche, longue mèche qui se consume dans la note, mini-mèche proportionnelle sur les cartes.
- Animation d'explosion (particules), notification « Boum ! … Annuler » et action « Faire exploser maintenant ».
- Historique des versions d'une note.
- Images et pièces jointes.
- Liens entre notes `[[...]]`.
- Partage d'une note via lien public en lecture seule.
- Option « réinitialiser le délai d'autodestruction à chaque modification ».
- Stockage du token dans le trousseau du système.
