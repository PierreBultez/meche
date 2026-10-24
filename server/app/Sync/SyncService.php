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
    /** New notes are inserted by statements of at most this many bytes of text. */
    private const INSERT_CHUNK_BYTES = 4 * 1024 * 1024;

    /**
     * `$syncId`: the identity of the history the device knows (null for a device that has
     * none yet). When it is not the account's one, the device must start over: nothing is
     * applied (docs/04, "Identité du serveur").
     */
    public function sync(int $userId, int $cursor, array $changes, ?string $syncId = null): array
    {
        // Nothing to write: no transaction and no lock, only the pull (docs/04: < 50 ms).
        if ($changes === []) {
            $counter = Revisions::read($userId);
            if ($syncId !== null && $syncId !== $counter->sync_id) {
                return $this->reset($counter->sync_id);
            }
            if ($cursor > $counter->value) {
                return $this->reset(Revisions::newSyncId($userId));
            }

            return $this->answer($counter->sync_id, [], [], $this->pull($userId, $cursor, []));
        }

        return DB::transaction(function () use ($userId, $cursor, $changes, $syncId) {
            $counter = Revisions::lock($userId);
            if ($syncId !== null && $syncId !== $counter->sync_id) {
                return $this->reset($counter->sync_id);
            }
            if ($cursor > $counter->value) {
                return $this->reset(Revisions::newSyncId($userId));
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
            ->where('user_id', $userId)
            ->whereIn('id', array_column($changes, 'id'))
            ->get(NoteFields::SELECT)
            ->keyBy('id');

        $applied = [];
        $conflicts = [];
        $inserts = [];
        $updates = [];
        $rev = $lastRev;
        foreach ($changes as $change) {
            $row = $existing->get($change['id']);
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
            if ($row === null) {
                $inserts[] = NoteFields::toRow($change, $userId, $rev);
            } else {
                $updates[] = NoteFields::toRow($change, $userId, $rev);
            }
            $applied[] = ['id' => $change['id'], 'rev' => $rev];
        }

        // No INSERT … ON DUPLICATE KEY UPDATE: on MariaDB it fires on any unique key,
        // (user_id, rev) included, and could then rewrite another note. New notes are inserted,
        // the others updated by their key; the counter lock makes both safe.
        foreach (self::chunkByBytes($inserts) as $chunk) {
            DB::table('notes')->insert($chunk);
        }
        foreach ($updates as $row) {
            DB::table('notes')
                ->where('user_id', $userId)
                ->where('id', $row['id'])
                ->update(array_diff_key($row, ['user_id' => true, 'id' => true]));
        }
        if ($inserts !== [] || $updates !== []) {
            Revisions::save($userId, $rev);
        }

        return [$applied, $conflicts];
    }

    /**
     * Groups rows so that one INSERT carries at most INSERT_CHUNK_BYTES of text (MariaDB's
     * max_allowed_packet is 16 MB by default). A larger note goes alone.
     *
     * @return list<list<array>>
     */
    private static function chunkByBytes(array $rows): array
    {
        $chunks = [];
        $chunk = [];
        $bytes = 0;
        foreach ($rows as $row) {
            $size = strlen($row['title']) + strlen($row['content']);
            if ($chunk !== [] && $bytes + $size > self::INSERT_CHUNK_BYTES) {
                $chunks[] = $chunk;
                $chunk = [];
                $bytes = 0;
            }
            $chunk[] = $row;
            $bytes += $size;
        }
        if ($chunk !== []) {
            $chunks[] = $chunk;
        }

        return $chunks;
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
        // The notes this request has just written: the device has them. They do not count in
        // the page's limits (else its own notes could fill the page and come back later).
        $known = [];
        foreach ($applied as $note) {
            $known[$note['id'].':'.$note['rev']] = true;
        }
        $limit = $maxNotes + count($known) + 1;
        $candidates = DB::table('notes')
            ->where('user_id', $userId)
            ->where('rev', '>', $cursor)
            ->orderBy('rev')
            ->limit($limit)
            ->get(['id', 'rev', DB::raw('LENGTH(title) + LENGTH(content) AS size')]);
        if ($candidates->isEmpty()) {
            return ['changes' => [], 'cursor' => $cursor, 'has_more' => false];
        }

        // More may follow the last row read when the query was cut by its limit.
        $hasMore = $candidates->count() === $limit;
        $ids = [];
        $bytes = 0;
        $last = $cursor;
        foreach ($candidates as $candidate) {
            if (! isset($known[$candidate->id.':'.$candidate->rev])) {
                if ($ids !== [] && (count($ids) === $maxNotes || $bytes + (int) $candidate->size > $maxBytes)) {
                    $hasMore = true;
                    break;
                }
                $ids[] = $candidate->id;
                $bytes += (int) $candidate->size;
            }
            $last = (int) $candidate->rev;
        }
        $changes = $ids === [] ? [] : DB::table('notes')
            ->where('user_id', $userId)
            ->whereIn('id', $ids)
            ->orderBy('rev')
            ->get(NoteFields::SELECT)
            ->map(fn (object $row) => NoteFields::fromRow($row))
            ->all();

        return ['changes' => $changes, 'cursor' => $last, 'has_more' => $hasMore];
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
     * The device must start over, from cursor 0, sending all its notes again (docs/04): it
     * knows another history of the account (`sync_id` changed after a restore, see
     * notes:rotate-sync-ids), or its cursor is ahead of the server (database restored or
     * recreated: the account then gets a new identity, so that every device starts over).
     * Nothing is applied.
     */
    private function reset(string $syncId): array
    {
        return [
            'applied' => [],
            'conflicts' => [],
            'changes' => [],
            'cursor' => 0,
            'has_more' => false,
            'server_time' => Clock::nowMs(),
            'sync_id' => $syncId,
            'reset' => true,
        ];
    }
}
