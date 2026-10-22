# 04 — Synchronisation et API Laravel

## Principes

- **Le client est autonome** : il fonctionne indéfiniment hors ligne. Le serveur sert à répliquer entre appareils et de sauvegarde.
- **Un seul aller-retour** : chaque synchro = une requête `POST /api/sync` qui envoie les changements locaux et récupère les changements distants.
- **Révisions** : chaque écriture côté serveur reçoit un numéro `rev` global croissant. Le client mémorise un **curseur** (le plus grand `rev` reçu) et ne demande que ce qui est plus récent.
- **Granularité** : la note entière (pas de fusion au caractère près). Suffisant pour un utilisateur unique.

## Déclenchement (côté Rust)

- Au démarrage de l'application.
- 2 secondes après la dernière modification locale (anti-rebond).
- Toutes les 60 secondes quand l'application est au premier plan.
- Au retour au premier plan (Android : reprise de l'activité).
- Manuellement (`sync_now`, bouton dans les réglages / palette `Ctrl+K`).
- Jamais deux synchros en parallèle (verrou ; une demande pendant une synchro en cours en reprogramme une à la fin).
- En cas d'échec réseau : statut `offline`, nouvel essai avec délai croissant (5 s, 15 s, 60 s, puis toutes les 60 s).

## Endpoint `POST /api/sync`

En-têtes : `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept-Encoding: gzip`.

### Requête
```json
{
  "cursor": 1842,
  "changes": [
    {
      "id": "0192f1c2-...",
      "base_rev": 1830,
      "title": "Courses",
      "content": "- [x] Lait\n- [ ] Pain",
      "kind": "rich",
      "code_language": null,
      "pinned": false,
      "color": "corail",
      "ephemeral_mode": "on_complete",
      "ephemeral_delay_hours": 24,
      "ephemeral_started_at": null,
      "destroy_at": null,
      "trashed_at": null,
      "trash_reason": null,
      "deleted": false,
      "created_at": 1761123000000,
      "updated_at": 1761124500000
    }
  ]
}
```
- `changes` : toutes les notes locales `dirty = 1` (par lots de 200 maximum ; si plus, plusieurs synchros successives).
- `base_rev` : la `server_rev` locale de la note (0 si jamais synchronisée).

### Traitement serveur (dans une transaction)
Pour chaque changement :
1. **La note n'existe pas** → insertion, nouvelle `rev` → `applied`.
2. **La note existe et `rev == base_rev`** → mise à jour, nouvelle `rev` → `applied`.
3. **La note existe et `rev != base_rev`** (quelqu'un d'autre l'a modifiée entre-temps) :
   - Si tous les champs synchronisés sont **identiques** à ceux du serveur (hors `updated_at`) → aucun changement, renvoyer la `rev` actuelle → `applied`. (Cas typique : client et serveur ont tous deux exécuté la même autodestruction déterministe.)
   - Si la version serveur est un tombstone (`deleted = true`) → le serveur garde le tombstone → `conflicts`.
   - Sinon → le serveur **garde sa version** → `conflicts`, avec la version serveur.

Puis :
4. Récupérer les notes `rev > cursor` (y compris les tombstones), triées par `rev`, limite 500.

### Réponse
```json
{
  "applied":   [{ "id": "0192f1c2-...", "rev": 1843 }],
  "conflicts": [{ "id": "...", "server": { "...note complète...", "rev": 1839 } }],
  "changes":   [{ "...note complète...", "rev": 1839 }],
  "cursor": 1843,
  "has_more": false,
  "server_time": 1761124501234
}
```

### Traitement client (Rust, dans une transaction SQLite)
1. **`applied`** : `server_rev = rev`. Mettre `dirty = 0` **uniquement si la note n'a pas été modifiée localement depuis l'envoi** (comparer `updated_at` avec celui envoyé). Une note `deleted` appliquée est supprimée physiquement de la base locale.
2. **`conflicts`** : la version locale est conservée sous forme d'une **nouvelle note** (nouvel UUID, titre suffixé « (conflit du 22/10 14:05) », `dirty = 1`), puis la version serveur remplace l'originale (`dirty = 0`). Rien n'est jamais perdu.
3. **`changes`** : pour chaque note reçue :
   - ignorer si `rev <= server_rev` locale ;
   - si la note locale est `dirty` → traiter comme un conflit (point 2) ;
   - sinon remplacer la version locale (ou supprimer si `deleted`).
4. Enregistrer `cursor`. Si `has_more`, relancer immédiatement une synchro.
5. Émettre `notes-changed` si quelque chose a changé.
6. Si `server_time` diffère de l'horloge locale de plus de 5 minutes, journaliser un avertissement (l'autodestruction repose sur les horloges).

## Authentification

### `POST /api/auth/token`
```json
{ "email": "...", "password": "...", "device_name": "PC bureau Ubuntu" }
```
→ `{ "token": "1|abc..." }`. Limité à 5 tentatives par minute.

### `DELETE /api/auth/token`
Révoque le token courant (déconnexion de l'appareil).

### `GET /api/health`
→ `{ "ok": true, "server_time": ... }` sans authentification. Sert au test de connexion dans les réglages.

### Création de l'utilisateur
Pas de route d'inscription. Commande `php artisan notes:create-user` (demande email et mot de passe de façon interactive).

## Tâches planifiées serveur

`notes:maintenance`, toutes les 10 minutes (`Schedule::command(...)->everyTenMinutes()->withoutOverlapping()`), voir `06-autodestruction.md` :
1. Autodestruction : notes `destroy_at <= now` et `trashed_at IS NULL` → `trashed_at = destroy_at`, `trash_reason = 'self_destruct'`, nouvelle `rev`.
2. Purge corbeille : notes `trashed_at <= now - 7 jours` → tombstone (`deleted = true`, `title = ''`, `content = ''`), nouvelle `rev`.
3. Nettoyage des tombstones de plus de 365 jours (suppression physique). Un appareil resté hors ligne plus d'un an doit refaire une synchro complète (curseur 0).

## Performance (exigence de Pierre : « ça doit répondre vite »)

Objectif : **< 50 ms côté serveur** pour une synchro sans changement, **< 150 ms** pour une synchro typique.

- Contrôleur unique, **Query Builder** (pas d'hydratation Eloquent pour les listes), sélection explicite des colonnes.
- Index `(user_id, rev)` : la requête de pull est un parcours d'index.
- Une seule transaction, insertions/mises à jour par lot quand c'est possible.
- Pas de middleware web (session, CSRF, cookies) sur les routes API.
- Production : `php artisan optimize`, OPcache activé, `APP_DEBUG=false`, compression gzip (Apache `mod_deflate` pour `application/json`).
- Côté client : `reqwest` avec gzip, connexion keep-alive réutilisée (un seul `Client` partagé).
- Option ultérieure si besoin : Laravel Octane. Ne pas l'introduire en V1 sans mesure qui le justifie.

## Tests obligatoires (Pest)
- Insertion d'une nouvelle note, mise à jour avec bon `base_rev`.
- Conflit (mauvais `base_rev`), conflit à contenu identique (doit être `applied`).
- Pull avec curseur, pagination `has_more`.
- Tombstone propagé, tombstone prioritaire en cas de conflit.
- Accès refusé sans token, isolation par `user_id`.
- `notes:maintenance` : autodestruction et purge.
