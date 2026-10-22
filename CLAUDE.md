# Mèche — instructions pour Claude Code

**Mèche** est l'application de prise de notes personnelle de Pierre, conçue pour remplacer Standard Notes.
Signature : les notes éphémères dont on « allume la mèche » et qui explosent à la fin du compte à rebours.
Identifiant d'application : `fr.pierrebultez.meche` · API : `https://meche.pierrebultez.com/api` · dépôt GitHub **public**.
Rapide, épurée, native sur **Linux, Windows et Android**, synchronisée avec un serveur personnel.

> Avant toute tâche, lis les documents de `docs/` concernés. Ils font foi.
> Si une décision technique n'y figure pas, propose-la à Pierre avant de l'implémenter.

## Documents de référence

| Fichier | Contenu |
|---|---|
| `docs/01-vision.md` | Objectifs, périmètre V1, ce qu'on ne fait PAS |
| `docs/02-architecture.md` | Vue d'ensemble, stack, choix techniques et leurs raisons |
| `docs/03-modele-donnees.md` | Schémas SQLite (client) et MySQL (serveur) |
| `docs/04-synchronisation.md` | Protocole de synchro, conflits, API Laravel |
| `docs/05-editeur.md` | Éditeur riche (TipTap → Markdown) et notes code (CodeMirror) |
| `docs/06-autodestruction.md` | Notes éphémères, corbeille, purge |
| `docs/07-import-standard-notes.md` | Import de la sauvegarde Standard Notes + écran de tri |
| `docs/08-interface.md` | Principes UI, écrans, raccourcis, budgets de performance |
| `docs/09-build-et-deploiement.md` | Environnement de dev, CI, releases, installation Android |
| `docs/10-feuille-de-route.md` | Phases de développement et critères de fin |
| `docs/11-direction-artistique.md` | Nom, thèmes clair « Fugace » / sombre « Feu d'artifice », couleur par note, la mèche, icône, ton |

## Stack (résumé)

- **Client** : Tauri 2 — cœur en **Rust** (`app/src-tauri`) + interface **Vue 3 / TypeScript / Vite / Tailwind 4** (`app/src`).
  - Stockage local : SQLite (rusqlite, FTS5) — le client fonctionne entièrement hors ligne.
  - Éditeur riche : TipTap v3 (extensions MIT uniquement), stockage en **Markdown (GFM)**.
  - Notes code : CodeMirror 6.
- **Serveur** : API **Laravel 13** (`server/`), Sanctum (tokens), MySQL. Un seul utilisateur.
- **Cibles** : Linux (.deb uniquement, décidé), Windows (.msi / NSIS), Android (.apk). iOS hors périmètre.

## Structure du dépôt

```
meche/
├── CLAUDE.md
├── README.md
├── docs/
├── app/                    # client Tauri 2
│   ├── src/                # frontend Vue 3 + TS (styles/tokens.css = toutes les couleurs)
│   ├── src-tauri/          # cœur Rust (commandes, SQLite, synchro, autodestruction)
│   └── package.json
├── server/                 # API Laravel 13
└── .github/workflows/      # CI : tests, releases, déploiement serveur
```

## Règles de travail

1. **Le frontend ne fait jamais d'appel réseau ni d'accès disque direct.** Tout passe par des commandes Tauri (`invoke`) implémentées en Rust. Rust est la seule source de vérité côté client.
2. **Local d'abord** : toute action utilisateur s'écrit d'abord en SQLite local et répond immédiatement. La synchro est asynchrone et ne bloque jamais l'interface.
3. **Gratuit et open source uniquement** : aucune dépendance payante (pas de Tiptap Pro / Tiptap Cloud / registre privé Tiptap). Vérifie la licence (MIT, Apache-2.0, BSD, ISC) de chaque nouvelle dépendance.
4. **Pierre apprend Rust** : il est développeur fullstack junior (Laravel, Vue, TypeScript), débutant en Rust et en mobile. Écris un Rust idiomatique mais **simple et lisible** (pas de génériques ou de macros inutiles), commente les points non évidents (ownership, lifetimes, async) et explique brièvement tes choix Rust dans tes réponses.
5. **Petites étapes** : suis l'ordre de `docs/10-feuille-de-route.md`. Une phase = des commits atomiques, testés, qui compilent.
6. **Tests** :
   - Rust : `cargo test` — obligatoire pour la synchro, l'autodestruction, le comptage des cases à cocher, les migrations.
   - Frontend : Vitest — obligatoire pour la conversion Markdown (aller-retour) et l'import Standard Notes.
   - Serveur : Pest — obligatoire pour l'endpoint de synchro (cas nominal, conflits, tombstones).
7. **Langues** : interface en **français** ; code, noms de variables, commentaires et messages de commit en **anglais** ; documentation dans `docs/` en français.
8. **Performance** : respecte les budgets de `docs/08-interface.md`. Pas de dépendance lourde sans justification.
9. **Direction artistique** : aucune couleur en dur dans les composants. Toujours les variables CSS de `docs/11-direction-artistique.md` (jetons d'interface, couleurs de note, thème du code).
10. **Données personnelles** : ne jamais committer de vraie sauvegarde Standard Notes. Les échantillons de test vont dans `import-samples/` (ignoré par git) ou sont anonymisés dans les fixtures.

## Commandes usuelles

```bash
# Client (depuis app/)
npm install
npm run tauri dev                 # desktop en dev
npm run tauri android dev         # Android (émulateur ou téléphone USB)
npm run tauri build               # build desktop de la plateforme courante
npm run tauri android build -- --apk
cargo test --manifest-path src-tauri/Cargo.toml
npm run test                      # Vitest
npm run typecheck                 # vue-tsc

# Serveur (depuis server/)
composer install
php artisan migrate
php artisan notes:create-user     # crée l'unique utilisateur
php artisan test
```
