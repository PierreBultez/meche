<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Disconnects a device (deletes its token): useful when it is lost and no other device is at hand. */
class RevokeDevice extends Command
{
    protected $signature = 'notes:revoke-device {id : Id donné par notes:devices}';

    protected $description = 'Déconnecte un appareil';

    public function handle(): int
    {
        $deleted = DB::table('personal_access_tokens')->where('id', (int) $this->argument('id'))->delete();
        if ($deleted === 0) {
            $this->error('Aucun appareil avec cet id.');

            return self::FAILURE;
        }
        $this->info('Appareil déconnecté.');

        return self::SUCCESS;
    }
}
