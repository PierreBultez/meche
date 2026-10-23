<?php

namespace App\Console\Commands;

use App\Support\Clock;
use App\Sync\Revisions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Every 10 minutes (routes/console.php): burns the fuses and purges the trash, even when no
 * device is open (docs/06). The rules are exactly those of the app (ephemeral/mod.rs): same
 * bounds, same values, so that a device doing the same thing sends an identical note and the
 * sync sees no conflict. Also deletes the tokens of devices unused for 180 days.
 */
class Maintenance extends Command
{
    protected $signature = 'notes:maintenance';

    protected $description = 'Fait exploser les mèches brûlées, purge la corbeille et les appareils inactifs';

    /** Invitations expired for longer than this are deleted. */
    private const OLD_INVITATION_MS = 30 * 86_400_000;

    public function handle(): int
    {
        $now = Clock::nowMs();
        $exploded = 0;
        $purged = 0;
        $failed = 0;
        foreach (DB::table('sync_counters')->orderBy('user_id')->pluck('user_id') as $userId) {
            // One account in trouble (a lock timeout…) must not stop the others.
            try {
                [$accountExploded, $accountPurged] = $this->maintainAccount((int) $userId, $now);
                $exploded += $accountExploded;
                $purged += $accountPurged;
            } catch (Throwable $error) {
                report($error);
                $failed++;
            }
        }

        $inactiveSince = now()->subDays(config('notes.token_inactivity_days'));
        $tokens = DB::table('personal_access_tokens')
            ->where(fn ($query) => $query->where('last_used_at', '<', $inactiveSince)
                ->orWhere(fn ($never) => $never->whereNull('last_used_at')->where('created_at', '<', $inactiveSince)))
            ->delete();
        DB::table('invitations')
            ->whereNull('used_at')
            ->where('expires_at', '<', $now - self::OLD_INVITATION_MS)
            ->delete();

        $this->line("Notes explosées : {$exploded}, purgées : {$purged}, appareils inactifs déconnectés : {$tokens}.");
        if ($failed > 0) {
            $this->error("Comptes en échec : {$failed} (voir le journal).");

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /** @return array{0: int, 1: int} notes exploded and purged */
    private function maintainAccount(int $userId, int $now): array
    {
        $limit = $now - config('notes.trash_retention_days') * 86_400_000;
        // Most runs find nothing: then no transaction and no lock at all.
        $work = DB::table('notes')
            ->where('user_id', $userId)
            ->where('deleted', false)
            ->where(fn ($query) => $query
                ->where(fn ($due) => $due->whereNull('trashed_at')->where('destroy_at', '<=', $now))
                ->orWhere('trashed_at', '<=', $limit))
            ->exists();
        if (! $work) {
            return [0, 0];
        }

        return DB::transaction(function () use ($userId, $now, $limit) {
            $rev = Revisions::lock($userId)->value;

            // Burnt fuses: trashed_at = destroy_at, not now (docs/06, deterministic).
            $due = DB::table('notes')
                ->where('user_id', $userId)
                ->whereNotNull('destroy_at')
                ->where('destroy_at', '<=', $now)
                ->whereNull('trashed_at')
                ->where('deleted', false)
                ->orderBy('id')
                ->pluck('id');
            foreach ($due as $id) {
                DB::table('notes')->where('user_id', $userId)->where('id', $id)->update([
                    'trashed_at' => DB::raw('destroy_at'),
                    'trash_reason' => 'self_destruct',
                    'updated_at' => $now,
                    'rev' => ++$rev,
                ]);
            }

            // 7 days in the trash: a tombstone, title and content emptied, the rest unchanged.
            // A note that has just exploded may already qualify (fuse burnt long ago).
            $old = DB::table('notes')
                ->where('user_id', $userId)
                ->where('deleted', false)
                ->whereNotNull('trashed_at')
                ->where('trashed_at', '<=', $limit)
                ->orderBy('id')
                ->pluck('id');
            foreach ($old as $id) {
                DB::table('notes')->where('user_id', $userId)->where('id', $id)->update([
                    'deleted' => true,
                    'title' => '',
                    'content' => '',
                    'updated_at' => $now,
                    'rev' => ++$rev,
                ]);
            }

            Revisions::save($userId, $rev);

            return [count($due), count($old)];
        });
    }
}
