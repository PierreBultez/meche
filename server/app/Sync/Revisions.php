<?php

namespace App\Sync;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The revision counter of an account (docs/03, `sync_counters`).
 *
 * Every transaction that writes notes (a sync, notes:maintenance) starts with lock(): the row
 * stays locked until the transaction ends, so the writes of an account happen one after the
 * other and their revisions are committed in order. A device that read up to revision N can
 * then never miss a revision below N committed later: that is what makes the cursor safe.
 */
final class Revisions
{
    /**
     * Locks the counter of `$userId` until the end of the current transaction.
     *
     * A counter below the highest revision of the account's notes means the database was
     * restored partly or edited by hand: new revisions would collide with existing ones. It is
     * put back above them, and the account gets a new sync identity so that every device
     * starts over (docs/04). The check reads one index entry.
     */
    public static function lock(int $userId): object
    {
        $counter = DB::table('sync_counters')
            ->where('user_id', $userId)
            ->lockForUpdate()
            ->first(['value', 'sync_id']);
        $value = (int) $counter->value;
        $syncId = (string) $counter->sync_id;

        $highest = (int) DB::table('notes')->where('user_id', $userId)->max('rev');
        if ($highest > $value) {
            report(new \RuntimeException("sync counter of account {$userId} was behind its notes: repaired"));
            $value = $highest;
            self::save($userId, $value);
            $syncId = self::newSyncId($userId);
        }

        return (object) ['value' => $value, 'sync_id' => $syncId];
    }

    /** The counter, read without locking (enough to read notes: see the class comment). */
    public static function read(int $userId): object
    {
        $counter = DB::table('sync_counters')->where('user_id', $userId)->first(['value', 'sync_id']);

        return (object) ['value' => (int) $counter->value, 'sync_id' => (string) $counter->sync_id];
    }

    /** Saves the last revision given (inside the transaction that called lock()). */
    public static function save(int $userId, int $value): void
    {
        DB::table('sync_counters')->where('user_id', $userId)->update(['value' => $value]);
    }

    /**
     * Gives the account a new sync history identity: every device will send all its notes
     * again and download them from the start (docs/04, "Identité du serveur").
     */
    public static function newSyncId(int $userId): string
    {
        $syncId = (string) Str::uuid();
        DB::table('sync_counters')->where('user_id', $userId)->update(['sync_id' => $syncId]);

        return $syncId;
    }
}
