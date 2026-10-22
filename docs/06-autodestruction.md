# 06 — Notes à mèche (autodestruction) et corbeille

> Dans l'interface, l'autodestruction s'appelle **la mèche** : on « allume la mèche » d'une note, elle « explose » à la fin. Dans le code, on garde le terme technique `ephemeral`. Le rendu visuel (mèche qui se consume, étincelle, explosion) est défini dans `11-direction-artistique.md`, qui prime sur la section « Interface » ci-dessous.

## Le besoin

Beaucoup de notes ne servent qu'une fois (liste de courses, checklist ponctuelle). Plutôt que de faire le ménage des mois plus tard, Pierre active un interrupteur sur la note : elle disparaît toute seule.

## Modes

| Mode | Le compte à rebours démarre… | Délai par défaut |
|---|---|---|
| `delay` — « Après un délai » | à l'activation de l'interrupteur | 7 jours |
| `on_complete` — « Quand tout est coché » | quand **toutes** les cases de la note sont cochées (au moins une case) | 24 heures |

Délais proposés : 1 h, 24 h, 3 j, 7 j, 30 j, ou personnalisé (en heures ou en jours). Les valeurs par défaut se règlent dans les réglages (`default_delay_hours_delay`, `default_delay_hours_on_complete`).

Fonctionne sur **tous les types de note** (riche et code). Le mode `on_complete` n'est proposé que pour les notes riches.

## Règles de calcul (module Rust `ephemeral/`)

Fonction pure, testée unitairement :

```
compute_ephemeral(note, task_counts, now) -> (ephemeral_started_at, destroy_at)
```

- **Désactivé** (`ephemeral_mode = null`) → `started_at = null`, `destroy_at = null`.
- **`delay`** :
  - à l'activation : `started_at = now`.
  - `destroy_at = started_at + delay_hours × 3 600 000`.
  - Modifier le délai recalcule `destroy_at` à partir du même `started_at`.
  - Modifier le contenu de la note **ne réinitialise pas** le compte à rebours (V1).
- **`on_complete`** (recalculé à chaque `update_note`) :
  - si `total > 0` et `checked == total` : si `started_at` est null → `started_at = now` ; `destroy_at = started_at + delay`.
  - sinon (une case décochée ou ajoutée) : `started_at = null`, `destroy_at = null` → **le compte à rebours s'arrête**.

## Exécution de la destruction

La destruction est **déterministe** : elle met `trashed_at = destroy_at` (et non `now`). Ainsi, le client et le serveur qui l'exécutent chacun de leur côté produisent exactement les mêmes valeurs, et la synchro les reconnaît comme identiques (pas de faux conflit, voir `04-synchronisation.md`).

Côté client (Rust), au démarrage, toutes les 60 secondes, et avant chaque `list_notes` :
```sql
UPDATE notes
SET trashed_at = destroy_at, trash_reason = 'self_destruct', dirty = 1, updated_at = :now
WHERE destroy_at IS NOT NULL AND destroy_at <= :now
  AND trashed_at IS NULL AND deleted = 0;
```
Puis émettre `notes-changed` si des lignes ont été modifiées.

Côté serveur : commande planifiée `notes:maintenance` (toutes les 10 minutes), même règle. Elle garantit la destruction même si aucun appareil n'est ouvert.

Si la note est ouverte au moment de sa destruction : l'éditeur affiche un bandeau (voir Interface) au lieu de fermer brutalement.

## Corbeille

- Une note autodétruite ou supprimée manuellement va dans la **corbeille** (`trashed_at` renseigné).
- Elle y reste **7 jours** (`TRASH_RETENTION_DAYS = 7`, constante côté client et `config('notes.trash_retention_days')` côté serveur).
- Ensuite, **purge** : tombstone (`deleted = 1`, titre et contenu vidés), propagé à tous les appareils, puis suppression physique locale.
- La purge est faite par le serveur (`notes:maintenance`). Le client purge aussi localement les notes trop anciennes s'il est hors ligne, en envoyant le tombstone à la prochaine synchro.

Actions dans la corbeille : **Restaurer**, **Supprimer définitivement**, **Vider la corbeille** (confirmation obligatoire).

**Restaurer une note autodétruite** : `trashed_at = null`, `trash_reason = null` **et autodestruction désactivée** (`ephemeral_mode = null`, `destroy_at = null`). Sinon elle repartirait aussitôt à la corbeille.

## Interface

- **Bouton mèche** dans l'en-tête de la note (icône mèche éteinte / allumée). Un appui ouvre un petit panneau :
  - interrupteur « Allumer la mèche » / « Éteindre la mèche » ;
  - mode : « Après un délai » / « Quand tout est coché » ;
  - délai (boutons rapides + personnalisé) ;
  - ligne d'état : « Explose dans 2 j 4 h » / « Mèche en attente : 3 cases sur 5 ».
- **Longue mèche** sous l'en-tête de la note, qui se consume en temps réel.
- **Badge mèche dans la liste** : mini-mèche proportionnelle au temps restant + « 2 j », « 5 h », « 12 min ». Alerte sous 1 h. Mode `on_complete` non armé : mèche éteinte + « 3/5 ».
- **Filtre « Mèches allumées »** dans la liste (et dans `Ctrl+K`) pour voir tout ce qui va exploser.
- **Création rapide** : la palette `Ctrl+K` propose « Nouvelle checklist à mèche » (note riche, mode `on_complete`, délai par défaut, une première case vide déjà insérée).
- Après une explosion pendant que l'application est ouverte : animation courte de la carte, puis notification « Boum ! « Courses » a explosé. Annuler » (5 secondes).
- Si la note est ouverte au moment de l'explosion : bandeau « Cette note a explosé. Restaurer ».

## Tests obligatoires (Rust)
- `delay` : activation, modification du délai, désactivation.
- `on_complete` : tout coché → armé ; décocher → désarmé ; recocher → nouveau `started_at` ; note sans case → jamais armé ; cases dans un bloc de code ignorées.
- Exécution : seules les notes échues passent à la corbeille, avec `trashed_at = destroy_at`.
- Restauration : désactive l'autodestruction.
- Purge après 7 jours → tombstone.
