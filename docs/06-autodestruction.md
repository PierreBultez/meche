# 06 — Notes à mèche (autodestruction) et corbeille

> Dans l'interface, l'autodestruction s'appelle **la mèche** : on « allume la mèche » d'une note, elle « explose » à la fin. Dans le code, on garde le terme technique `ephemeral`. Le rendu visuel (icône, temps restant) est défini dans `11-direction-artistique.md`.

## Le besoin

Beaucoup de notes ne servent qu'une fois (liste de courses, checklist ponctuelle). Plutôt que de faire le ménage des mois plus tard, Pierre allume la mèche de la note : elle part toute seule à la corbeille.

## Une seule règle : un délai (décidé en phase 2)

La V1 est volontairement simple : **une mèche, allumée ou éteinte, et un délai**.

- Allumer la mèche d'une note démarre un compte à rebours. À la fin, la note part à la corbeille.
- Le délai est un **réglage global unique**, `fuse_delay_hours` : 1 h, 24 h, 3 jours, **7 jours (par défaut)** ou 30 jours. Pas de valeur personnalisée, pas de délai choisi note par note.
- Le délai est **copié dans la note quand on allume sa mèche** (`ephemeral_delay_hours`). Changer le réglage ensuite ne touche pas les mèches déjà allumées.
- Pour changer le délai d'une note : éteindre puis rallumer sa mèche (le compte repart de maintenant).
- Fonctionne sur **tous les types de note** (riche et code). Modifier ou convertir la note ne change pas le compte à rebours.
- Le mode « quand tout est coché » (`on_complete`) n'est **pas dans la V1** (voir « Idées pour plus tard » dans `01-vision.md`). La valeur reste autorisée par le schéma (migration 001), mais rien ne la crée.

## Règles de calcul (Rust, `ephemeral/mod.rs` et `db/notes.rs`)

- `ephemeral::destroy_at(started_at, delay_hours) = started_at + delay_hours × 3 600 000`.
- **Allumer** (`set_ephemeral(id, true)`, ou `create_note(kind, fused = true)`) : `ephemeral_mode = 'delay'`, `ephemeral_delay_hours` = le réglage, `ephemeral_started_at = now`, `destroy_at` calculé. Allumer une mèche déjà allumée ne change rien (elle garde son délai et son départ).
- **Éteindre** (`set_ephemeral(id, false)`) : les quatre colonnes repassent à null.
- Une note de la corbeille est en lecture seule : `set_ephemeral` est refusé (`invalid_input`).
- Allumer ou éteindre est une modification : `updated_at = now`, `dirty = 1` (la carte remonte en tête de liste).

## Exécution de la destruction

La destruction est **déterministe** : elle met `trashed_at = destroy_at` (et non `now`). Ainsi, le client et le serveur qui l'exécutent chacun de leur côté produisent exactement les mêmes valeurs, et la synchro les reconnaît comme identiques (pas de faux conflit, voir `04-synchronisation.md`). Une note dont la mèche a brûlé pendant que l'application était fermée est donc datée du moment où sa mèche a brûlé.

```sql
UPDATE notes
SET trashed_at = destroy_at, trash_reason = 'self_destruct', dirty = 1, updated_at = :now
WHERE destroy_at IS NOT NULL AND destroy_at <= :now
  AND trashed_at IS NULL AND deleted = 0;
```

Côté client (Rust), la **maintenance** (`ephemeral::run_maintenance`) enchaîne cette destruction et la purge de la corbeille dans une seule transaction. Elle tourne :
- au démarrage, avant que la liste ne s'affiche ;
- toutes les 60 secondes, dans un fil d'exécution (thread) dédié (`ephemeral/watcher.rs`) ;
- au début de chaque `list_notes` : une liste n'affiche jamais une note dont la mèche a brûlé.

Quand elle a modifié des notes, Rust émet l'événement `notes-changed` et l'interface recharge la liste et la note ouverte. Au démarrage et dans `list_notes`, un échec de la maintenance est journalisé sans bloquer : la liste s'affiche quand même, et le fil réessaie une minute plus tard. Mesuré (build release, 1 000 notes dont 100 mèches) : 1 ms quand rien n'est échu, 4 ms quand les 100 notes explosent d'un coup.

Côté serveur (phase 3) : commande planifiée `notes:maintenance` (toutes les 10 minutes), **exactement la même règle** (bornes incluses : `destroy_at <= now` ; même tombstone). Elle garantit la destruction même si aucun appareil n'est ouvert.

Fenêtre connue, à traiter dans la conception de la synchro (phase 3) : entre `destroy_at` et la maintenance suivante (60 s au plus), une note échue peut encore être modifiée, éteinte ou mise à la corbeille à la main. Si le serveur l'a déjà fait exploser entre-temps, la synchro produira une copie « (conflit du …) » : rien n'est perdu.

**Si la note est ouverte au moment de la destruction** : elle reste affichée, en lecture seule, avec le bandeau de la corbeille (« Sa mèche a brûlé : cette note est dans la corbeille. »). Ce qui était en train d'être tapé est enregistré : `update_note` accepte volontairement une note de la corbeille et ne touche ni à la mèche ni à `trashed_at`.

## Corbeille

- Une note autodétruite ou supprimée manuellement va dans la **corbeille** (`trashed_at` renseigné).
- Elle y reste **7 jours** (`TRASH_RETENTION_DAYS = 7`, constante côté client et `config('notes.trash_retention_days')` côté serveur).
- Ensuite, **purge** (`ephemeral::purge_trash`, notes avec `trashed_at <= now − 7 jours`) : une note jamais synchronisée (`server_rev = 0`) est supprimée de la base ; une note connue du serveur devient un tombstone (`deleted = 1`, titre et contenu vidés, `dirty = 1`), propagé aux autres appareils à la prochaine synchro.
- Tant qu'il n'y a pas de serveur, **le client purge toujours** (à chaque maintenance). C'est sans risque pour la phase 3 : la purge est déterministe, et le tombstone l'emporte de toute façon en cas de conflit. Comme `trashed_at = destroy_at`, une note dont la mèche a brûlé plus de 7 jours avant l'ouverture de l'application est purgée dès le démarrage, sans passer par la corbeille visible.
- Si la note purgée est ouverte, elle est fermée.

Actions dans la corbeille : **Restaurer**, **Supprimer définitivement**, **Vider la corbeille** (confirmation obligatoire).

**Restaurer** : `trashed_at = null`, `trash_reason = null`, et **mèche éteinte** (les quatre colonnes à null) si la note a explosé (`trash_reason = 'self_destruct'`) ou si sa mèche a brûlé pendant qu'elle était dans la corbeille (`destroy_at <= now`). Sinon elle repartirait aussitôt à la corbeille. Une note mise à la corbeille à la main dont la mèche brûle encore la garde.

## Interface

- **Bouton mèche** dans l'en-tête de la note (icône éteinte / allumée) : un appui allume ou éteint, sans panneau. Une notification confirme : « Mèche allumée : la note explosera dans 7 jours. » ou « Mèche éteinte. »
- Quand la mèche est allumée, « **Explose dans 2 j 4 h** » à côté du bouton (en `--danger` sous 1 h).
- **Carte de la liste** : à la place de la date, une pastille avec l'icône allumée et le temps restant (« 2 j », « 5 h », « 12 min », « < 1 min »). Pas dans la corbeille.
- **Filtre « Mèches allumées »** (et dans `Ctrl+K`), trié par explosion la plus proche.
- **Création rapide** : la palette `Ctrl+K` propose « Nouvelle note à mèche » (note riche vide, mèche allumée avec le délai du réglage).
- **Raccourci** : `Ctrl+Maj+E` allume ou éteint la mèche de la note ouverte ; aussi « Allumer / Éteindre la mèche » dans la palette.
- **Réglages** : section « Mèche », choix du délai.
- Pas d'animation d'explosion ni de notification « Boum ! » en V1 : on n'est souvent pas dans l'application quand la mèche brûle. La carte disparaît simplement de la liste.
- Le temps restant est rafraîchi par une seule horloge partagée, une fois par minute (voir `08-interface.md`).

## Tests obligatoires (Rust)

Tous présents dans `ephemeral/mod.rs`, `db/notes.rs`, `db/settings.rs` et `db/search.rs` :
- Allumage (départ et échéance), allumage sans effet sur une mèche déjà allumée (même si le réglage a changé), extinction, refus dans la corbeille, création avec mèche, édition et conversion qui gardent la mèche.
- Exécution : seules les notes échues passent à la corbeille, à `destroy_at` exactement, avec `trashed_at = destroy_at` même en retard ; notes déjà à la corbeille ou supprimées ignorées.
- Sauvegarde tardive d'une note qui vient d'exploser : enregistrée, explosion inchangée.
- Restauration : après explosion, mèche brûlée dans la corbeille (éteinte), mèche qui brûle encore (gardée) ; une note restaurée n'explose plus.
- Purge à 7 jours (borne exacte), avec ou sans tombstone ; maintenance (explosion puis purge, purge immédiate d'une très vieille explosion) ; échec journalisé sans erreur.
- Réglage : 7 jours par défaut, liste fermée, valeur inconnue → défaut.
- Tri du filtre « Mèches allumées » ; `destroy_at` dans les résultats de recherche.
- Performance (test ignoré, build release) : maintenance avec 1 000 notes.
