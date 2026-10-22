# Mèche

Application de prise de notes personnelle, rapide et colorée, qui remplace Standard Notes.
Allumez la mèche d'une note jetable : elle explose toute seule à la fin du compte à rebours.

- **Plateformes** : Linux, Windows, Android
- **Client** : Tauri 2 (Rust + Vue 3), fonctionne hors ligne
- **Serveur** : API Laravel 13 de synchronisation (auto-hébergée)
- **Fonctions clés** : éditeur riche (Markdown, checklists, blocs de code), notes 100 % code, recherche instantanée, une couleur par note, notes épinglées, **notes à mèche qui s'autodétruisent**, import Standard Notes avec tri rapide.
- **Thèmes** : clair « Fugace » (bonbon acidulé) et sombre « Feu d'artifice » (façon Monokai).

La conception complète est dans [`docs/`](docs/). Les consignes pour Claude Code sont dans [`CLAUDE.md`](CLAUDE.md).

## Développement

Prérequis : voir [`docs/09-build-et-deploiement.md`](docs/09-build-et-deploiement.md) (Rust ≥ 1.95, Node.js LTS, dépendances système de Tauri).

```bash
cd app
npm install
npm run tauri dev                                  # lance Mèche
npm run test && npm run typecheck                  # tests et types du frontend
cargo test --manifest-path src-tauri/Cargo.toml    # tests du cœur Rust
```

La base locale est créée au premier lancement dans le dossier de données de l'application
(`~/.local/share/fr.pierrebultez.meche/notes.db` sous Linux).

## Licence

[MIT](LICENSE).
