<?php

namespace App\Console\Commands;

use App\Sync\Revisions;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * To run right after restoring a backup of the database (docs/09). The devices know revisions
 * that the restored database has lost: with a new sync identity, each one starts over at its
 * next sync, sends all its notes again and downloads them all (docs/04, "Identité du serveur").
 */
class RotateSyncIds extends Command
{
    protected $signature = 'notes:rotate-sync-ids';

    protected $description = 'Après une restauration de la base : tous les appareils repartent de zéro';

    public function handle(): int
    {
        $count = 0;
        foreach (DB::table('sync_counters')->pluck('user_id') as $userId) {
            DB::transaction(function () use ($userId) {
                Revisions::lock((int) $userId);
                Revisions::newSyncId((int) $userId);
            });
            $count++;
        }
        $this->info("Comptes concernés : {$count}. Chaque appareil renverra ses notes à sa prochaine synchro.");

        return self::SUCCESS;
    }
}
