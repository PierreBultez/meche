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
Simplifiée avec Pierre au démarrage de la phase : une mèche à délai uniquement, un seul réglage, sans animation (voir `06-autodestruction.md`).
- Module Rust `ephemeral` : autodestruction déterministe, purge de la corbeille à 7 jours, maintenance au démarrage, toutes les 60 s (fil de fond) et avant `list_notes`, événement `notes-changed`, et leurs tests.
- `set_ephemeral(id, enabled)`, `create_note(kind, fused)`, réglage `fuse_delay_hours`.
- Interface : bouton et icône mèche, temps restant dans l'en-tête et sur la carte, filtre « Mèches allumées » trié par explosion, « Nouvelle note à mèche », `Ctrl+Maj+E`, bandeau d'une note explosée ouverte.
- Réglage du délai (section « Mèche »).

**Terminé quand** : une note dont la mèche est allumée part seule à la corbeille après le délai réglé, et se restaure correctement (mèche éteinte).

## Phase 3 — Serveur et synchronisation
- Laravel 13 : Sanctum, migrations, `notes:create-user`, `/api/auth/token`, `/api/health`, `/api/sync`, `notes:maintenance`, tests Pest.
- Déploiement sur le serveur de Pierre (vhost, Certbot, CI de déploiement, cron du planificateur).
- Rust : module `sync` (déclencheurs, push/pull, conflits, curseur, tentatives), commandes `login`, `logout`, `sync_now`, `get_sync_status`, événements.
- Interface : premier lancement, réglages serveur, pastille d'état.

**Terminé quand** : deux instances desktop (ex. deux profils / deux PC) restent synchronisées, y compris après une coupure réseau, et un conflit produit bien une copie « (conflit du …) ». Temps de réponse serveur mesuré conforme à `04-synchronisation.md`.

**État (fin de la phase 3, côté code)** : serveur, synchronisation, interface et CI faits, trois tours de revue critique (chaque constat vérifié par un second relecteur ou par sa reproduction). Scénarios réels passés avec deux instances (données séparées) et le serveur local : synchronisation dans les deux sens ; coupure réseau (nouveaux essais à 5 s, 15 s puis 60 s, pastille grise, reprise immédiate au retour du serveur) ; copie « (conflit du …) » après des modifications hors ligne des deux côtés ; explosion pendant que l'autre instance est fermée (reçue à sa réouverture, `trashed_at = destroy_at`) ; tombstone (note supprimée partout) ; note ouverte modifiée sur l'autre appareil, affichée sur place sans perdre le focus ni le curseur, tableau compris. Déploiement fait avec Pierre le 25/10/2026 (`09-build-et-deploiement.md`, § 3) : API sous son propre utilisateur système, HTTPS, planificateur, fail2ban, rotation des journaux, déploiement automatique par GitHub Actions (premier passage réussi). En production, `/api/health` passe 10 à 16 ms dans PHP (`Server-Timing`). Vérification finale en production, le 25/10/2026, avec la vraie application sur deux PC : Ubuntu (`.deb` construit depuis `master`) et Windows (installateur de `windows-build.yml`) installés, connectés au même compte, notes synchronisées dans les deux sens, copie « (conflit du …) » après une coupure réseau, les deux appareils listés par `notes:devices`. **Phase 3 terminée.**

**Mesures (phase 3)** — conteneur de développement, PHP 8.5 avec OPcache, MariaDB 12.3, serveur intégré de PHP (pas Nginx ni PHP-FPM), configuration non mise en cache, compte de 1 000 notes, 50 requêtes par cas :
- synchro sans changement : médiane 14,6 ms dans PHP (p90 17,4 ms) ; objectif < 50 ms ;
- synchro typique (3 notes envoyées, 5 reçues d'un autre appareil) : médiane 11,7 ms dans PHP (p90 14,9 ms) ; objectif < 150 ms ;
- démarrage à froid du client (build release final, compte connecté, jusqu'à la fenêtre visible) : 420 à 488 ms sur 6 lancements ; budget 1 s.

En production, l'en-tête `Server-Timing` de chaque réponse (`curl -sI`) permet de vérifier les objectifs.

## Phase 4 — Import Standard Notes
- Analyse de la vraie sauvegarde de Pierre (`import-samples/`), confirmation des formats.
- Convertisseurs (Lexical → Markdown, HTML → Markdown, checklists, code) avec fixtures anonymisées.
- Écran de récapitulatif, `import_notes`, écran de tri complet.

**Terminé quand** : les ~100 notes de Pierre sont importées, vérifiées par lui, et triées.

**État (phase 4, côté code)** : sauvegarde réelle de Pierre analysée le 25/10/2026 (une archive `.zip` ; 27 notes, dont 2 dans la corbeille de Standard Notes, donc 25 à importer : le tri avait été fait avant dans Standard Notes), formats confirmés et corrigés dans `07-import-standard-notes.md`. Décisions validées par Pierre : conversion par l'éditeur lui-même (pas de `turndown`), texte brut importé comme du texte, lecture du fichier par Rust (`tauri-plugin-dialog` utilisé depuis Rust, `zip` 9.0), dates de `client_updated_at`, migration 003 (`imported_notes`) ; les comptes du tri sont dans le réglage `triage_counts` plutôt qu'une colonne de `import_triage` (même comportement, sans reconstruire la table). Sur la vraie sauvegarde, les 25 notes sont converties sans aucun avertissement (aller-retour exact, tout le texte gardé), en 0,5 à 0,7 s (mesuré dans les tests, sous Node) ; la vérification de l'import a trouvé trois défauts de l'éditeur, corrigés (`05-editeur.md`). Les fichiers joints de Standard Notes ne sont pas importés (leur contenu n'est pas dans la sauvegarde ; Pierre n'en a plus besoin).

Essais dans la vraie application (build release, conteneur de développement, écran virtuel sans accélération graphique, pilotée par WebDriver), avec une sauvegarde de test construite sur la structure de celle de Pierre (même répartition des types, mêmes formes de HTML, de Lexical et de checklists, copies de conflit, 34 fichiers joints, archive `.zip` avec son dossier `Items/`, contenu inventé, plus un article HTML collé d'environ 140 Ko) et le serveur local (PHP 8.5, base SQLite) :
- récapitulatif juste (« 25 notes trouvées : 3 textes, 9 textes enrichis, 6 Super, 7 checklists. Tout a été converti à l'identique. ») ; import en 127 ms ;
- relance avec la même sauvegarde : « Rien de nouveau : ces notes sont déjà dans Mèche. » ;
- tri complet au clavier (`G`, `E`, `S`, `→`, `←`, `Espace`, deux `Ctrl+Z`) : 12 à 28 ms entre la touche et la carte suivante ; écran final « 9 gardées, 8 mèches allumées, 8 à la corbeille » ;
- synchro : le serveur a reçu les 25 notes (corbeille, mèches, épinglage, couleurs et dates d'origine compris) ; un second appareil, connecté au même compte, les a reçues identiques champ par champ, sans tri (le tri reste local) ;
- thèmes clair et sombre vérifiés sur le récapitulatif et l'écran de tri.

**Mesures (phase 4)**, mêmes conditions :
- démarrage à froid jusqu'à la fenêtre visible (compte connecté, 25 notes) : 506 à 572 ms sur 6 lancements ; budget 1 s. Comparé à `master` dans les mêmes conditions (profils neufs, 8 lancements alternés) : médiane 495 ms contre 545 ms, pas d'écart mesurable ;
- ouverture d'une note : 42 à 95 ms pour une note courte ; une note de 47 000 caractères s'ouvre en 560 à 650 ms, qu'elle soit importée ou créée dans Mèche : le temps d'ouverture de l'éditeur croît avec la taille de la note (à reprendre en phase 7, « Mesure et optimisation des budgets ») ; la plus grosse note réelle de Pierre fait environ 17 000 caractères une fois convertie ;
- recherche : 9 à 62 ms aller-retour WebDriver compris ;
- paquet `.deb` : 5,3 Mo ; le code de l'import est chargé à la demande (rien de plus au démarrage qu'un libellé de la palette).

**Revues (phase 4)** : trois relectures indépendantes (interface, Rust, sécurité et données personnelles). Chaque constat a été reproduit (un test qui échoue avant la correction, ou un essai dans l'application) avant d'être corrigé.
- Premier tour, corrigé : couleurs des notes importées qui ne dépendent que de la sauvegarde (deux appareils qui importent la même sauvegarde ne créent plus de copies de conflit) ; comptes du tri gardés quand un import n'apporte rien ; zip lu dans un budget unique (trois fichiers au plus) ; expressions régulières en temps linéaire sur un texte piégé ; une note malformée n'arrête plus l'import ; numéros de liste, liens sur du code, éléments de liste qui commencent par un titre, lignes des cellules, ponctuation au bord du gras gardés ; images et notes de bas de page des notes Markdown signalées ; conversion qui fait des pauses, affiche sa progression et s'arrête quand on quitte l'écran ; `Maj+←` / `Maj+→` et un geste annulé ne décident plus rien ; noms de sauvegarde Standard Notes ignorés par git partout dans le dépôt. Dans l'éditeur (défauts antérieurs à la phase 4, `05-editeur.md`) : espace de trop sous un élément numéroté, lecteur Markdown quadratique, checklist imbriquée invalide, séparateur sous un élément de liste, lien ouvert par un simple clic dans une note en lecture seule.
- Laissé pour plus tard, à valider par Pierre : `marked` 18 (lecture linéaire des paragraphes pleins de caractères échappés) et `@tiptap/extension-heading` en dépendance directe (titre qui finit par ` #`), voir les limites connues de `05-editeur.md` ; lecture de la sauvegarde moins gourmande en mémoire pour Android (phase 5).

Reste pour terminer la phase : l'import réel par Pierre dans son application connectée à la production, sa vérification, puis le tri.

## Phase 5 — Android
- Accompagner Pierre dans l'installation d'Android Studio, SDK, NDK (voir `09-build-et-deploiement.md`).
- `tauri android init`, adaptation de l'interface mobile (`08-interface.md`) : navigation liste/note, bouton retour, barre d'outils au-dessus du clavier, gestes, safe areas, synchro à la reprise.
- Génération de la clé de signature, APK signé, installation sur le téléphone de Pierre (USB puis Obtainium).
- Vérifier la règle Google de vérification des développeurs à ce moment-là.
- Import Standard Notes sur Android : choisir le fichier par le sélecteur d'Android (adresses `content://`, aujourd'hui refusées avec `backup_location`), et lire la sauvegarde avec moins de mémoire (une sauvegarde de 64 Mo faite de milliers de petites valeurs occupe environ 1 Go une fois lue en `serde_json::Value`) : limite plus basse ou lecture typée qui ignore ce qui n'est pas une note.

**Terminé quand** : l'application tourne sur le téléphone de Pierre, synchronisée avec le PC, et les budgets de performance mobile sont tenus.

## Phase 6 — Windows et releases automatisées
- Workflow `release.yml` (Linux, Windows, Android) sur tag `v*`.
- `tauri-plugin-updater` + clés de signature + `latest.json`.
- Test d'installation et de mise à jour sur Windows et Ubuntu.
- Déjà fait en phase 3 : `windows-build.yml` construit l'installateur NSIS à la demande ; il s'installe, se lance et synchronise (25/10/2026). Restent à vérifier sous Windows : polices, affichage, raccourcis ; et à décider : langue de l'installateur (anglais par défaut), `.msi` ou NSIS seul.
- Obtainium configuré sur le téléphone.

**Terminé quand** : pousser un tag `v1.0.0` produit les trois installeurs, et les appareils existants se mettent à jour.

## Phase 7 — Finitions
- Mesure et optimisation des budgets de performance, dont les limites connues de l'éditeur (`05-editeur.md` : `marked` 18, titre qui finit par ` #`).
- Accessibilité de base (contrastes, focus visibles, navigation clavier complète).
- États vides, messages d'erreur clairs en français.
- Sauvegarde : export de toutes les notes en fichiers `.md` dans un `.zip` (filet de sécurité supplémentaire).
- Icône définitive de l'application (SVG source + `npm run tauri icon`).

## Après la V1
- Mèche plus riche, retirée de la phase 2 : mode « quand tout est coché » (comptage des cases avec `pulldown-cmark`, voir `05-editeur.md`), délai par note ou personnalisé, panneau de la mèche, longue mèche qui se consume, mini-mèche proportionnelle.
- Vraie animation d'explosion (particules aux couleurs de la note), notification « Boum ! … Annuler » et action « Faire exploser maintenant ».
- Voir aussi « Idées pour plus tard » dans `01-vision.md`.

## Décisions prises
- Nom : **Mèche**, identifiant `fr.pierrebultez.meche`.
- API : `https://meche.pierrebultez.com/api`.
- Dépôt GitHub **public**.
- Thèmes : clair « Fugace », sombre « Feu d'artifice », couleur par note.
- Paquet Linux : `.deb` uniquement (mise à jour : voir `09`, section 7).
- Phase 2 simplifiée : mèche à délai uniquement, un seul réglage global (7 jours par défaut), pas d'animation.
