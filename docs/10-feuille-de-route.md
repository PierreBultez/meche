# 10 — Feuille de route

Chaque phase se termine par une application qui compile, des tests verts et une démonstration à Pierre. Ne pas commencer une phase avant que la précédente soit validée.

## Phase 0 — Fondations
- Monorepo (`app/`, `server/`, `docs/`), `.gitignore` (dont `import-samples/`, clés, `.env`).
- Projet Tauri 2 + Vue 3 + TS + Tailwind 4 + Pinia + Vue Router qui s'ouvre sur Linux, nommé **Mèche** (`fr.pierrebultez.meche`).
- Jetons de couleur des deux thèmes (`11-direction-artistique.md`) en variables CSS, bascule clair / sombre / système, test automatisé des contrastes.
- Rust : module `db` avec migrations (`rusqlite_migration`), schéma de `03-modele-donnees.md`, structure d'erreurs.
- CI : `cargo test`, `cargo clippy`, Vitest, typecheck sur chaque push.

**Terminé quand** : `npm run tauri dev` ouvre une fenêtre aux couleurs de Mèche (les deux thèmes), la base `notes.db` est créée, la CI est verte.

## Phase 1 — Prise de notes locale (desktop)
- Commandes `create_note`, `get_note`, `list_notes`, `update_note`, `trash_note`, `restore_note`, `delete_note_forever`, `empty_trash`, `search`.
- Liste, en-tête de note, éditeur riche TipTap avec tous les éléments de `05-editeur.md`, conversion Markdown avec tests d'aller-retour, menu `/`, menu de sélection.
- Notes code avec CodeMirror 6 et sélecteur de langage.
- Couleur par note (attribution automatique, choix dans le menu), cartes colorées, coloration du code des deux thèmes.
- Épingler, corbeille (sans purge automatique), recherche FTS5, raccourcis, palette `Ctrl+K`.

**Terminé quand** : Pierre peut utiliser l'application au quotidien sur son PC, hors ligne, et la trouve plus rapide que Standard Notes.

## Phase 2 — La mèche (autodestruction)
- Module Rust `ephemeral` + comptage des cases (`pulldown-cmark`) + tests de `06-autodestruction.md`.
- `set_ephemeral`, exécution périodique, purge de la corbeille à 7 jours.
- Interface : bouton et icône mèche, panneau « Allumer la mèche », badge mini-mèche qui se consume, longue mèche dans la note, filtre « Mèches allumées », « Nouvelle checklist à mèche », animation d'explosion simple (V1) et notification « Boum ! … Annuler ».
- Réglages des délais par défaut.

**Terminé quand** : une liste de courses entièrement cochée part seule à la corbeille après le délai choisi, et se restaure correctement.

## Phase 3 — Serveur et synchronisation
- Laravel 13 : Sanctum, migrations, `notes:create-user`, `/api/auth/token`, `/api/health`, `/api/sync`, `notes:maintenance`, tests Pest.
- Déploiement sur le serveur de Pierre (vhost, Certbot, CI de déploiement, cron du planificateur).
- Rust : module `sync` (déclencheurs, push/pull, conflits, curseur, tentatives), commandes `login`, `logout`, `sync_now`, `get_sync_status`, événements.
- Interface : premier lancement, réglages serveur, pastille d'état.

**Terminé quand** : deux instances desktop (ex. deux profils / deux PC) restent synchronisées, y compris après une coupure réseau, et un conflit produit bien une copie « (conflit du …) ». Temps de réponse serveur mesuré conforme à `04-synchronisation.md`.

## Phase 4 — Import Standard Notes
- Analyse de la vraie sauvegarde de Pierre (`import-samples/`), confirmation des formats.
- Convertisseurs (Lexical → Markdown, HTML → Markdown, checklists, code) avec fixtures anonymisées.
- Écran de récapitulatif, `import_notes`, écran de tri complet.

**Terminé quand** : les ~100 notes de Pierre sont importées, vérifiées par lui, et triées.

## Phase 5 — Android
- Accompagner Pierre dans l'installation d'Android Studio, SDK, NDK (voir `09-build-et-deploiement.md`).
- `tauri android init`, adaptation de l'interface mobile (`08-interface.md`) : navigation liste/note, bouton retour, barre d'outils au-dessus du clavier, gestes, safe areas, synchro à la reprise.
- Génération de la clé de signature, APK signé, installation sur le téléphone de Pierre (USB puis Obtainium).
- Vérifier la règle Google de vérification des développeurs à ce moment-là.

**Terminé quand** : l'application tourne sur le téléphone de Pierre, synchronisée avec le PC, et les budgets de performance mobile sont tenus.

## Phase 6 — Windows et releases automatisées
- Workflow `release.yml` (Linux, Windows, Android) sur tag `v*`.
- `tauri-plugin-updater` + clés de signature + `latest.json`.
- Test d'installation et de mise à jour sur Windows et Ubuntu.
- Obtainium configuré sur le téléphone.

**Terminé quand** : pousser un tag `v1.0.0` produit les trois installeurs, et les appareils existants se mettent à jour.

## Phase 7 — Finitions
- Mesure et optimisation des budgets de performance.
- Accessibilité de base (contrastes, focus visibles, navigation clavier complète).
- États vides, messages d'erreur clairs en français.
- Sauvegarde : export de toutes les notes en fichiers `.md` dans un `.zip` (filet de sécurité supplémentaire).
- Icône définitive de l'application (SVG source + `npm run tauri icon`).

## Après la V1
- Vraie animation d'explosion (particules aux couleurs de la note) et action « Faire exploser maintenant ».
- Voir aussi « Idées pour plus tard » dans `01-vision.md`.

## Décisions prises
- Nom : **Mèche**, identifiant `fr.pierrebultez.meche`.
- API : `https://meche.pierrebultez.com/api`.
- Dépôt GitHub **public**.
- Thèmes : clair « Fugace », sombre « Feu d'artifice », couleur par note.
- Paquet Linux : `.deb` uniquement (mise à jour : voir `09`, section 7).
