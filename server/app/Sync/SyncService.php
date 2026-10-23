<?php

namespace App\Sync;

use App\Support\Clock;
use Illuminate\Support\Facades\DB;

/**
 * `POST /api/sync` (docs/04): applies the changes of a device, then sends it the notes changed
 * since its cursor, in one round trip. Query Builder only, explicit columns, no Eloquent
 * models for lists (docs/04, performance).
 */
final class SyncService
{
    /** Rows written by one INSERT … ON DUPLICATE KEY UPDATE: keeps statements a few MB. */
    private const UPSERT_CHUNK = 50;

    public function sync(int $userId, int $cursor, array $changes): array
    {
        // Nothing to write: no transaction and no lock, only the pull (docs/04: < 50 ms).
        if ($changes === []) {
            $counter = Revisions::read($userId);
            if ($cursor > $counter->value) {
                return $this->reset($userId);
            }

            return $this->answer($counter->sync_id, [], [], $this->pull($userId, $cursor, []));
        }

        return DB::transaction(function () use ($userId, $cursor, $changes) {
            $counter = Revisions::lock($userId);
            if ($cursor > $counter->value) {
                return $this->reset($userId);
            }
            [$applied, $conflicts] = $this->push($userId, $counter->value, $changes);

            return $this->answer($counter->sync_id, $applied, $conflicts, $this->pull($userId, $cursor, $applied));
        });
    }

    /**
     * Applies the changes (docs/04, "Traitement serveur"). Returns the applied ones with their
     * revision, and the conflicts with the version the server keeps.
     *
     * @return array{0: list<array{id: string, rev: int}>, 1: list<array{id: string, server: array}>}
     */
    private function push(int $userId, int $lastRev, array $changes): array
    {
        $existing = DB::table('notes')
            ->whereIn('id', array_column($changes, 'id'))
            ->get(['user_id', ...NoteFields::SELECT])
            ->keyBy('id');

        $applied = [];
        $conflicts = [];
        $rows = [];
        $rev = $lastRev;
        foreach ($changes as $change) {
            $row = $existing->get($change['id']);
            if ($row !== null && (int) $row->user_id !== $userId) {
                throw new ForeignNote("note {$change['id']} belongs to another account");
            }
            if ($row === null) {
                // A tombstone of a note the server does not have: nothing to store.
                if ($change['deleted']) {
                    $applied[] = ['id' => $change['id'], 'rev' => 0];

                    continue;
                }
            } else {
                $server = NoteFields::fromRow($row);
                if ($server['rev'] !== $change['base_rev']) {
                    // Changed by another device since this one last saw it. Identical (typically
                    // the same self-destruction on both sides): nothing to do. Otherwise the
                    // server keeps its version, a tombstone included.
                    if (NoteFields::same($server, $change)) {
                        $applied[] = ['id' => $change['id'], 'rev' => $server['rev']];
                    } else {
                        $conflicts[] = ['id' => $change['id'], 'server' => $server];
                    }

                    continue;
                }
            }
            $rev++;
            $rows[] = NoteFields::toRow($change, $userId, $rev);
            $applied[] = ['id' => $change['id'], 'rev' => $rev];
        }

        if ($rows !== []) {
            $updated = array_values(array_diff(array_keys($rows[0]), ['id', 'user_id']));
            foreach (array_chunk($rows, self::UPSERT_CHUNK) as $chunk) {
                DB::table('notes')->upsert($chunk, ['id'], $updated);
            }
            Revisions::save($userId, $rev);
        }

        return [$applied, $conflicts];
    }

    /**
     * The notes changed after `$cursor`, in revision order: at most `notes.pull_max_notes`
     * notes and about `notes.pull_max_bytes` (at least one note). Read in two steps, so that
     * PHP never loads hundreds of large notes to send only a few: first the ids, revisions and
     * sizes, then the selected notes. The notes this request has just written are left out
     * (the device has them), but the cursor still moves past them.
     *
     * @param  list<array{id: string, rev: int}>  $applied
     * @return array{changes: list<array>, cursor: int, has_more: bool}
     */
    private function pull(int $userId, int $cursor, array $applied): array
    {
        $maxNotes = config('notes.pull_max_notes');
        $maxBytes = config('notes.pull_max_bytes');
        $candidates = DB::table('notes')
            ->where('user_id', $userId)
            ->where('rev', '>', $cursor)
            ->orderBy('rev')
            ->limit($maxNotes + 1)
            ->get(['id', 'rev', DB::raw('LENGTH(title) + LENGTH(content) AS size')]);
        if ($candidates->isEmpty()) {
            return ['changes' => [], 'cursor' => $cursor, 'has_more' => false];
        }

        $hasMore = $candidates->count() > $maxNotes;
        $page = [];
        $bytes = 0;
        foreach ($candidates->take($maxNotes) as $candidate) {
            if ($page !== [] && $bytes + (int) $candidate->size > $maxBytes) {
                $hasMore = true;
                break;
            }
            $page[] = $candidate;
            $bytes += (int) $candidate->size;
        }

        $known = [];
        foreach ($applied as $note) {
            $known[$note['id'].':'.$note['rev']] = true;
        }
        $ids = [];
        foreach ($page as $candidate) {
            if (! isset($known[$candidate->id.':'.$candidate->rev])) {
                $ids[] = $candidate->id;
            }
        }
        $changes = $ids === [] ? [] : DB::table('notes')
            ->where('user_id', $userId)
            ->whereIn('id', $ids)
            ->orderBy('rev')
            ->get(NoteFields::SELECT)
            ->map(fn (object $row) => NoteFields::fromRow($row))
            ->all();

        return ['changes' => $changes, 'cursor' => (int) end($page)->rev, 'has_more' => $hasMore];
    }

    private function answer(string $syncId, array $applied, array $conflicts, array $pull): array
    {
        return [
            'applied' => $applied,
            'conflicts' => $conflicts,
            'changes' => $pull['changes'],
            'cursor' => $pull['cursor'],
            'has_more' => $pull['has_more'],
            'server_time' => Clock::nowMs(),
            'sync_id' => $syncId,
            'reset' => false,
        ];
    }

    /**
     * The device's cursor is ahead of the server: its database was restored from a backup or
     * recreated. Nothing is applied; the account gets a new sync identity, and every device,
     * this one first, sends all its notes again from cursor 0 (docs/04).
     */
    private function reset(int $userId): array
    {
        return [
            'applied' => [],
            'conflicts' => [],
            'changes' => [],
            'cursor' => 0,
            'has_more' => false,
            'server_time' => Clock::nowMs(),
            'sync_id' => Revisions::newSyncId($userId),
            'reset' => true,
        ];
    }
}
