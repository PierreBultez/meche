# 04 — Synchronisation et API Laravel

> État : mis en œuvre en phase 3. Serveur dans `server/`, client dans `app/src-tauri/src/sync/`.

## Principes

- **Le client est autonome** : il fonctionne indéfiniment hors ligne. Le serveur sert à répliquer entre appareils et de sauvegarde.
- **Un seul aller-retour** : chaque synchro = une requête `POST /api/sync` qui envoie les changements locaux et récupère les changements distants.
- **Révisions** : chaque écriture côté serveur reçoit un numéro `rev` croissant, propre à chaque compte. Le client mémorise un **curseur** (le plus grand `rev` reçu) et ne demande que ce qui est plus récent.
- **Granularité** : la note entière (pas de fusion au caractère près). Suffisant pour un utilisateur par compte.
- **Plusieurs comptes, sur invitation** (décidé en phase 3) : chaque compte a ses notes, totalement séparées des autres (voir « Comptes et authentification »).

## Déclenchement (côté Rust)

Une seule tâche asynchrone (tokio) possède la synchro (`sync/engine.rs`). Les commandes et le fil de la mèche ne synchronisent jamais eux-mêmes : ils lui envoient des messages (« une note a changé », « la fenêtre est revenue », « synchroniser maintenant », « se connecter »…). Elle les traite un par un : deux synchros ne peuvent pas se chevaucher, et une demande reçue pendant une synchro attend la fin de celle-ci. La connexion et la déconnexion passent aussi par elle : le compte ne change jamais au milieu d'une synchro.

- Au démarrage de l'application (si un compte est connecté).
- 2 secondes après la dernière modification locale (anti-rebond).
- Toutes les 60 secondes tant que l'application tourne (desktop). Sur Android (phase 5), l'application est suspendue en arrière-plan : la reprise sert de déclencheur.
- Quand la fenêtre reprend le focus (au plus une fois toutes les 5 s).
- Manuellement : « Synchroniser maintenant » (réglages, palette `Ctrl+K`, clic sur la pastille). La commande `sync_now` attend la fin de la synchro et renvoie son état.
- En cas d'échec réseau : statut `offline`, nouvel essai après 5 s, 15 s, puis toutes les 60 s. Taper du texte hors ligne ne relance pas d'essai (le serveur n'est pas martelé) ; le retour sur la fenêtre et la synchro manuelle, si.
- `429 Too Many Requests` : nouvel essai après le délai `Retry-After` donné par le serveur (une heure au plus : une valeur plus grande n'est pas crue).
- Plus de 20 requêtes de suite sans avoir fini (beaucoup de notes à envoyer ou à recevoir) : la suite repart 2 s plus tard si le serveur a avancé (curseur ou notes acceptées), sinon à la synchro périodique (un serveur qui dirait « il y en a encore » sans avancer n'est pas sollicité sans fin).
- `401` : le serveur ne connaît plus cet appareil (déconnecté depuis un autre appareil, ou inutilisé depuis 180 jours). Le jeton est oublié, la synchro s'arrête, l'interface demande de se reconnecter.

Le client HTTP (`reqwest`) est construit à la première requête, pas au démarrage : construire le client charge les certificats du système, et si cela échoue les notes doivent quand même s'ouvrir, hors ligne. Délais : 10 s pour se connecter ; 30 s pour obtenir les en-têtes de la réponse (connexion, envoi, travail du serveur), plus une seconde par 32 Ko envoyés (une synchro de 4 Mo a deux minutes de plus : une connexion mobile lente, vers 256 kbit/s, suffit) ; puis la réponse est lue morceau par morceau, et seules 30 s sans rien recevoir l'arrêtent. Pas de durée totale fixe : sur une connexion lente, le même lot échouerait à chaque essai et la synchro n'avancerait plus. (Le `read_timeout` de reqwest ne convient pas : pendant l'envoi, il borne la requête entière, pas chaque morceau.) Une connexion coupée pendant la lecture de la réponse est une erreur réseau. Les redirections ne sont jamais suivies : l'API n'en fait pas, et en suivre une pourrait envoyer un mot de passe ou des notes ailleurs.

Le verrou de la base (`Mutex<Connection>`) n'est jamais gardé pendant la requête réseau : la tâche le prend quelques millisecondes pour lire les notes à envoyer, puis pour appliquer la réponse. Le compilateur le garantit : le verrou de `std::sync::Mutex` n'est pas `Send`, et une tâche tokio ne peut garder que des valeurs `Send` d'un `.await` à l'autre.

## Endpoint `POST /api/sync`

En-têtes : `Authorization: Bearer <token>`, `Content-Type: application/json`, `Accept-Encoding: gzip`.

### Requête
```json
{
  "cursor": 1842,
  "sync_id": "0192f1c2-aaaa-...",
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
      "ephemeral_mode": "delay",
      "ephemeral_delay_hours": 168,
      "ephemeral_started_at": 1761123000000,
      "destroy_at": 1761727800000,
      "trashed_at": null,
      "trash_reason": null,
      "deleted": false,
      "created_at": 1761123000000,
      "updated_at": 1761124500000
    }
  ]
}
```
- `changes` : les notes locales `dirty = 1`, les plus anciennes d'abord, **par lots de 200 notes et d'environ 4 Mo** au plus (toujours au moins une note, même plus grosse). S'il en reste, une nouvelle requête part aussitôt. Sans limite en octets, 200 notes de 2 Mo feraient 400 Mo : PHP refuserait la requête et la synchro resterait bloquée.
- `base_rev` : la `server_rev` locale de la note (0 si jamais synchronisée).
- `sync_id` : l'identité de l'historique que l'appareil connaît (voir « Identité du serveur ») ; absent avant le premier login.

### Traitement serveur (`server/app/Sync/SyncService.php`)

Validation champ par champ, écrite à la main (`ChangeValidator`) : les règles `changes.*` du validateur Laravel sont lentes sur 200 notes, et la limite de 2 Mo du contenu se compte en octets alors que `max` compte des caractères. Une requête invalide est refusée en entier (`422`, `{ "error": "invalid_change", "message": "changes.3.color is not one of …" }`), sans rien écrire.

Toute transaction qui écrit des notes (synchro, `notes:maintenance`) commence par verrouiller la ligne du compteur du compte (`SELECT … FOR UPDATE` sur `sync_counters`) et la garde jusqu'à la fin. Les écritures d'un compte se font donc l'une après l'autre et leurs révisions sont validées dans l'ordre : un appareil qui a lu jusqu'à la révision N ne peut jamais manquer une révision inférieure à N validée plus tard. Les révisions d'une synchro sont attribuées en une fois (`value = value + n`), puis les nouvelles notes sont insérées par paquets d'environ 4 Mo et les autres mises à jour par leur clé `(user_id, id)`. Pas d'`upsert` : sur MariaDB, `INSERT … ON DUPLICATE KEY UPDATE` se déclenche sur n'importe quelle clé unique, y compris `(user_id, rev)`, et pourrait réécrire une autre note. Un compteur resté en dessous de la plus grande `rev` du compte (restauration partielle) est réparé, et le compte reçoit un nouveau `sync_id`. Une synchro **sans changement** ne prend ni transaction ni verrou : elle lit seulement.

Pour chaque changement :
1. **La note n'existe pas** → insertion, nouvelle `rev` → `applied`. Exception : un tombstone d'une note inconnue n'est pas stocké (`applied` avec `rev: 0`).
2. **La note existe et `rev == base_rev`** → mise à jour, nouvelle `rev` → `applied`.
3. **La note existe et `rev != base_rev`** (un autre appareil l'a modifiée entre-temps) :
   - si tous les champs synchronisés sont **identiques** à ceux du serveur (hors `updated_at`) → aucun changement, la `rev` actuelle est renvoyée → `applied`. Cas typique : client et serveur ont tous deux exécuté la même autodestruction déterministe ;
   - sinon → le serveur **garde sa version**, tombstone compris → `conflicts`, avec la version serveur.
4. Les notes sont rangées par compte (clé primaire `(user_id, id)`) : un appareil qui change de compte envoie ses notes au nouveau compte sans jamais heurter celles de l'ancien.

Une requête de plus de 8 Mo de notes (titres et contenus) est refusée (`invalid_change`) : le client n'en envoie jamais plus de 4 Mo.

Puis la réception des notes `rev > cursor` (tombstones compris), triées par `rev` : **500 notes et environ 4 Mo au plus** (au moins une), lues en deux requêtes (identifiants, révisions et tailles, puis les notes retenues) pour ne jamais charger des centaines de grosses notes en mémoire. Les notes que la requête vient d'écrire (couples `id` + `rev` de `applied`) ne sont pas renvoyées : l'appareil les a. Le curseur avance quand même au-delà.

### Réponse
```json
{
  "applied":   [{ "id": "0192f1c2-...", "rev": 1843 }],
  "conflicts": [{ "id": "...", "server": { "...note complète...", "rev": 1839 } }],
  "changes":   [{ "...note complète...", "rev": 1839 }],
  "cursor": 1843,
  "has_more": false,
  "server_time": 1761124501234,
  "sync_id": "0192f1c2-aaaa-...",
  "reset": false
}
```
Accents et barres obliques ne sont pas échappés (réponses plus petites) ; Apache les compresse en gzip.

### Traitement client (`sync/apply.rs`, dans une transaction SQLite)
1. **`applied`** : `server_rev = rev`. `dirty = 0` **uniquement si tous les champs synchronisés sont encore ceux envoyés** (la note n'a pas changé pendant la requête). Comparer `updated_at` seul ne suffisait pas : deux écritures dans la même milliseconde (la mèche puis une sauvegarde) auraient trompé le test. Un tombstone accepté est supprimé physiquement de la base locale. Une note jamais synchronisée, supprimée définitivement ici pendant que la requête l'envoyait, n'a plus de ligne locale alors que le serveur vient de la stocker : un tombstone est créé (`server_rev = rev`, `dirty = 1`), sinon elle resterait vivante sur le serveur et les autres appareils.
2. **`conflicts`** : la version locale est conservée sous forme d'une **nouvelle note** (nouvel UUID v7, titre suffixé « (conflit du 22/10 14:05) » en heure locale, couleur, mèche et état de corbeille conservés, `dirty = 1`, `server_rev = 0`, datée de maintenant pour apparaître en tête), puis la version serveur remplace l'originale (`dirty = 0`). Rien n'est jamais perdu. Pas de copie quand :
   - la version locale est un **tombstone** : il n'y a rien dedans, la note revient simplement sur cet appareil (une modification faite ailleurs l'emporte sur une suppression) ;
   - les deux versions sont identiques (hors `updated_at`).
   Une note locale qui était dans la corbeille donne une copie qui reste dans la corbeille.

   **Réponse perdue** : si une requête a été reçue et appliquée par le serveur mais que sa réponse s'est perdue (connexion coupée, délai dépassé, `502`/`504` d'Apache pendant que PHP continuait), le serveur renverra plus tard la version que cet appareil a lui-même envoyée. Le moteur garde en mémoire les versions envoyées sans réponse (`Unacknowledged`, trois au plus par note ; oubliées quand le serveur a refusé la requête par un `4xx`, puisqu'il n'a alors rien appliqué). Quand le serveur renvoie l'une d'elles :
   - la note a été modifiée ici depuis : ce n'est pas un conflit, elle repart de cette révision (`server_rev = rev`, toujours `dirty`) et sa version plus récente part aussitôt ;
   - la note a été supprimée définitivement ici depuis (jamais synchronisée, elle n'avait pas laissé de tombstone) : un tombstone est créé à cette révision, sinon la note reviendrait ;
   - la note n'a pas changé : la version du serveur est enregistrée normalement.

   Cette mémoire ne survit pas à un redémarrage de l'application : après un redémarrage, une note modifiée depuis une réponse perdue donne une copie de conflit (rien n'est perdu), et une note supprimée définitivement depuis peut revenir.
3. **`changes`** : pour chaque note reçue :
   - ignorer si `rev <= server_rev` locale (déjà connue, par exemple une note que cet appareil vient d'envoyer) ;
   - si la note locale est `dirty` → traiter comme un conflit (point 2) ;
   - sinon remplacer la version locale (ou la supprimer si `deleted`). Un tombstone d'une note jamais reçue est ignoré.
4. Enregistrer `cursor` et `last_sync_at`. Si `has_more`, s'il reste des notes à envoyer, ou si des copies de conflit viennent d'être créées, relancer aussitôt (20 requêtes de suite au plus, garde-fou contre une boucle).
5. Émettre `notes-changed` si une note visible a changé. Un simple accusé de réception (`applied`) ne change rien à l'écran : pas d'événement, la liste et la note ouverte ne sont pas rechargées à chaque minute.
6. Si `server_time` diffère de l'horloge locale de plus de 5 minutes : avertissement dans le journal et dans Réglages › Serveur (« les mèches exploseront en décalé »). Pas de correction automatique : les valeurs de l'explosion restent déterministes (`trashed_at = destroy_at`), seul le moment se décale.

### Note ouverte modifiée par la synchro (décidé en phase 3)

Les éditeurs ne lisent le texte qu'à leur montage. Sans précaution, une note ouverte que la synchro remplace garderait l'ancien texte à l'écran, et la frappe suivante l'enregistrerait par-dessus la version de l'autre appareil.

- **Garde côté Rust** : `update_note` reçoit, avec les champs modifiés, le titre **et** le contenu que l'éditeur croit enregistrés (`expectedTitle`, `expectedContent`), ainsi que le type et le langage de l'éditeur (`expectedKind`, `expectedCodeLanguage`). Le contrôle se fait **champ par champ** : seul un champ envoyé dont la valeur a changé ailleurs est un conflit. Dans ce cas, Rust n'écrase rien : la version affichée par l'éditeur part entière dans **une seule** copie « (conflit du …) » (un champ non envoyé y prend la valeur attendue, pas celle de l'autre appareil ; le type et le langage sont ceux de l'éditeur, même si l'autre appareil a converti la note), et la note est renvoyée inchangée. Un nouveau titre venu d'ailleurs et un texte tapé ici sont donc gardés tous les deux, sans copie. Le contrôle et l'écriture se font sous le même verrou.
- **Une seule sauvegarde automatique** pour le titre et le texte : une écriture, une copie au plus.
- **Côté interface** : `NoteEditor` compare le titre et le contenu de la note reçue à ce que son autosave connaît (la valeur enregistrée ou une écriture en route). Une valeur inconnue vient d'ailleurs : l'éditeur termine sa sauvegarde (détournée vers une copie si besoin), puis il **affiche la version enregistrée sur place** (`replace` des éditeurs riche et code, hors historique d'annulation) : le focus, le curseur et le défilement restent. Un nouveau titre venu d'ailleurs ne touche pas au texte en cours de frappe.
- **Écriture détournée** : l'autosave n'adopte jamais la version de l'autre appareil comme « attendue » tant que l'éditeur ne l'affiche pas. Ce qui est tapé entre-temps part aussi en copie, jamais par-dessus. Une notification le dit, une fois, y compris quand l'éditeur venait d'être fermé.
- **Sauvegarde impossible** (disque plein, note trop grande) : le texte reste à l'écran, l'erreur est signalée, la sauvegarde suivante réessaie ; la version enregistrée ne s'affiche qu'une fois toutes les écritures en cours terminées et ce texte gardé quelque part.
- **Note supprimée définitivement ailleurs** pendant la frappe : le texte part dans une nouvelle note du même type (non ouverte, en tête de liste), créée une seule fois même si l'enregistrement échoue et réessaie ; une notification le dit.
- **Affichage sur place** : seule la partie qui diffère est remplacée (une étape ProseMirror exacte, pour que les tableaux restent intacts), ce qui fait suivre le curseur ; filet de sécurité : si le résultat n'est pas exactement la version enregistrée, tout le document est remplacé. Quand l'autre appareil a écrit avant **et** après le paragraphe en cours, la partie remplacée couvre le curseur : s'il est encore là à l'identique, le curseur retourne dans ce paragraphe (ou cette ligne, pour une note code), au même endroit ; parmi des paragraphes identiques, celui de même rang. Chaque passe qui trouve un nouveau texte tapé pendant l'enregistrement de la copie crée une copie de plus (cas rare, rien n'est perdu).
- **Ouverture pendant un rechargement** (point connu de la phase 2) : une note dont l'ouverture était en cours quand `notes-changed` est arrivé est relue (trois fois au plus), pour ne jamais ouvrir une ancienne version.

## Identité du serveur (`sync_id`, décidé en phase 3)

Chaque compte a un `sync_id` (UUID, table `sync_counters`), renvoyé par `/auth/token`, `/auth/register` et `/sync`. L'appareil le mémorise.

- S'il change (autre serveur, autre compte, base du serveur recréée), l'appareil **repart de zéro** : ses tombstones locaux sont effacés, toutes ses notes repassent à `server_rev = 0, dirty = 1`, le curseur revient à 0, et tout est renvoyé. Les notes identiques sont reconnues, les autres donnent des copies de conflit. Sans cela, après un `migrate:fresh`, les curseurs des appareils seraient en avance sur le serveur : ils n'enverraient ni ne recevraient plus rien, sans le savoir.
- Chaque requête de synchro porte le `sync_id` connu de l'appareil. S'il n'est pas celui du compte, le serveur n'applique rien et répond `reset: true` avec le bon `sync_id` (sans en créer un nouveau) : l'appareil repart de zéro.
- Après la restauration d'une sauvegarde de la base, `php artisan notes:rotate-sync-ids` donne un nouveau `sync_id` à chaque compte : tous les appareils repartent de zéro à leur prochaine synchro, même ceux dont le curseur n'est pas en avance (sans cela, un appareil dont le curseur était juste en dessous des révisions perdues manquerait silencieusement les notes réécrites depuis).
- Filet de sécurité : si un appareil envoie un curseur plus grand que le compteur du compte (restauration oubliée), le serveur n'applique rien, donne un nouveau `sync_id` au compte et répond `reset: true`.
- Au premier login, les notes de l'appareil sont toutes à `server_rev = 0, dirty = 1` : elles partent par lots ; chaque appareil reçoit celles des autres (union, sans conflit puisque les UUID diffèrent).
- Se connecter à **un autre compte** sur un appareil y envoie ses notes : l'interface le demande d'abord (« Changer de compte ? »).
- La déconnexion garde le serveur, le compte, le curseur et le `sync_id` : se reconnecter au même compte reprend là où on en était.

## Comptes et authentification

Décidé en phase 3 : plusieurs comptes, **sur invitation**. Le premier compte est créé sur le serveur ; chaque compte peut ensuite inviter une personne de confiance (ta famille, par exemple), qui pourra à son tour en inviter d'autres. Les notes d'un compte sont isolées par `user_id`. Elles ne sont pas chiffrées sur le serveur : l'administrateur peut les lire.

### `POST /api/auth/token`
```json
{ "email": "...", "password": "...", "device_name": "PC bureau Ubuntu" }
```
→ `{ "token": "1|meche_abc...", "email": "...", "sync_id": "..." }`. Mauvais mot de passe ou adresse inconnue : même réponse, `401 { "error": "invalid_credentials" }` (un mot de passe est vérifié même sans compte, pour que le temps de réponse ne trahisse rien). Chaque appareil reçoit son propre jeton Sanctum (le serveur n'en garde que l'empreinte SHA-256 ; le préfixe `meche_` permet aux scanners de secrets de reconnaître un jeton publié par erreur).

### `POST /api/auth/register`
```json
{ "invitation_code": "7KQ2-M9XD-4TPH", "email": "...", "password": "...", "device_name": "..." }
```
→ `201`, même réponse que `/auth/token`. Erreurs : `invalid_invitation`, `invalid_email`, `email_taken`, `weak_password` (12 caractères au moins), `invalid_input`. Le code est lu avec indulgence (minuscules, espaces et tirets acceptés, O lu 0, I et L lus 1). La ligne de l'invitation reste verrouillée jusqu'à la création du compte : un code ne peut pas servir deux fois.

`/auth/token` et `/auth/register` partagent deux limites : **5 essais par minute et par adresse IP**, et **30 par heure et par adresse e-mail**, quelle que soit l'IP (contre une attaque répartie sur beaucoup d'adresses, IPv6 notamment). La seconde est volontairement large : n'importe qui peut s'en servir pour bloquer une adresse e-mail pendant une heure (la personne se reconnecte plus tard ; les appareils déjà connectés ne sont pas touchés). Les adresses sont comparées octet par octet (`utf8mb4_bin`, enregistrées en minuscules) : une variante accentuée est une autre adresse, sans compte.

### `DELETE /api/auth/token`
Révoque le jeton courant (déconnexion de l'appareil).

### Appareils : `GET /api/devices`, `DELETE /api/devices/{id}`
Liste des appareils du compte (nom, dernière activité, « cet appareil ») et déconnexion d'un autre appareil (téléphone perdu). Un jeton inutilisé depuis 180 jours est supprimé par `notes:maintenance` (expiration par inactivité plutôt qu'une durée fixe).

### Invitations : `GET`, `POST /api/invitations`, `DELETE /api/invitations/{id}`
Un code d'invitation : 12 caractères de la base 32 de Crockford (sans I, L, O, U), affiché `XXXX-XXXX-XXXX`, 60 bits aléatoires, **à usage unique, valable 7 jours**, 5 codes en attente au plus par compte. Le serveur n'en garde que l'empreinte SHA-256 et les 4 derniers caractères (pour les distinguer dans la liste) : le code n'est affiché qu'une fois, à sa création. `users.invited_by` garde qui a invité qui.

### `GET /api/health`
→ `{ "ok": true, "api": 1, "server_time": ... }` sans authentification (60 par minute). Sert à « Tester la connexion » dans les réglages ; `api` est la version du protocole.

### Erreurs
`{ "error": "code_stable", "message": "détail en anglais" }`. Rust transmet `error` au frontend comme `kind` (`src-tauri/src/error.rs`) ; le texte français est écrit dans `app/src/utils/sync-messages.ts`. Un serveur injoignable donne `network` ; une page qui ne vient pas de l'API Mèche, `not_meche_server`.

### Commandes d'administration (artisan)
| Commande | Rôle |
|---|---|
| `notes:create-user` | Crée un compte sans invitation (le premier). Mot de passe demandé deux fois, sans être affiché |
| `notes:users` | Liste les comptes, qui les a invités, leurs notes et appareils |
| `notes:reset-password {email} [--logout]` | Pas de réinitialisation par e-mail : l'administrateur change le mot de passe (et peut déconnecter tous les appareils) |
| `notes:delete-user {email}` | Supprime un compte et ses notes sur le serveur (confirmation en retapant l'adresse) |
| `notes:devices [email]` / `notes:revoke-device {id}` | Liste et déconnecte des appareils sans en avoir un sous la main |

## Tâches planifiées serveur

`notes:maintenance`, toutes les 10 minutes (`Schedule::command(...)->everyTenMinutes()->withoutOverlapping()`), voir `06-autodestruction.md` :
1. Autodestruction : notes `destroy_at <= now`, `trashed_at IS NULL`, `deleted = 0` → `trashed_at = destroy_at`, `trash_reason = 'self_destruct'`, `updated_at = now`, nouvelle `rev`.
2. Purge corbeille : notes `trashed_at <= now - 7 jours` → tombstone (`deleted = true`, `title = ''`, `content = ''`, les autres champs inchangés), `updated_at = now`, nouvelle `rev`. Une note qui vient d'exploser peut y passer dans la même exécution (mèche brûlée depuis longtemps), comme côté client.
3. Suppression des jetons d'appareils inutilisés depuis 180 jours, et des invitations expirées depuis plus d'un mois.

Les deux premières règles sont **identiques** à celles du client (`ephemeral/mod.rs`, `db/notes.rs`) : mêmes bornes incluses, mêmes valeurs. Un test Pest envoie la même explosion et la même purge depuis un « appareil » et vérifie qu'elles sont reconnues identiques. Une exécution sans rien à faire ne prend aucun verrou.

**Tombstones** : ils ne sont plus jamais supprimés (décidé en phase 3, le nettoyage à 365 jours est abandonné). Un tombstone pèse quelques centaines d'octets ; les garder supprime le cas « appareil hors ligne depuis plus d'un an », qui aurait demandé une resynchronisation complète.

## Performance (exigence de Pierre : « ça doit répondre vite »)

Objectif : **< 50 ms côté serveur** pour une synchro sans changement, **< 150 ms** pour une synchro typique.

- Contrôleur unique, **Query Builder** (pas d'hydratation Eloquent pour les listes), sélection explicite des colonnes.
- Index unique `(user_id, rev)` : la requête de réception est un parcours d'index.
- Une seule transaction, révisions attribuées en une fois, nouvelles notes insérées par paquets (pas d'`upsert`, voir plus haut).
- Pas de middleware web (session, CSRF, cookies) sur les routes API.
- Production : `php artisan optimize`, OPcache activé, `APP_DEBUG=false`, compression gzip (Apache `mod_deflate` pour `application/json`).
- Chaque réponse porte un en-tête `Server-Timing: app;dur=12.3` (temps passé dans PHP, en ms) : `curl -sI` suffit pour vérifier les objectifs en production.
- Côté client : `reqwest` avec gzip, un seul `Client` partagé (construit à la première requête) qui garde ses connexions ouvertes (keep-alive).
- Option ultérieure si besoin : Laravel Octane. Ne pas l'introduire sans mesure qui le justifie.

Mesures (phase 3, conteneur de développement, PHP 8.5 + OPcache + MariaDB 12.3, serveur intégré de PHP, compte de 1 000 notes) : voir `10-feuille-de-route.md`, phase 3.

## Tests obligatoires (Pest)

Dans `server/tests/Feature/`, lancés par la CI sur PHP 8.5 et MariaDB 12.3 :
- Insertion d'une nouvelle note, mise à jour avec bon `base_rev`.
- Conflit (mauvais `base_rev`), conflit à contenu identique (doit être `applied`), comparaison de chaque champ.
- Pull avec curseur, pagination `has_more` par nombre et par taille, exclusion de l'écho.
- Tombstone propagé, tombstone prioritaire en cas de conflit, tombstone d'une note inconnue.
- Accès refusé sans jeton, isolation par `user_id`, texte enregistré à l'octet près, limites (titre en caractères, contenu en octets, 200 changements).
- Curseur en avance → `reset` et nouveau `sync_id`.
- `notes:maintenance` : autodestruction et purge (bornes exactes, valeurs identiques au client), jetons inactifs.
- Comptes : connexion, limite d'essais, inscription par invitation (usage unique, expiration, codes lus avec indulgence), appareils, commandes artisan.
