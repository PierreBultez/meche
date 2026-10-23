<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Lists the connected devices (Sanctum tokens), of one account or of all of them. */
class ListDevices extends Command
{
    protected $signature = 'notes:devices {email? : Seulement les appareils de ce compte}';

    protected $description = 'Liste les appareils connectés';

    public function handle(): int
    {
        $query = DB::table('personal_access_tokens')
            ->join('users', 'users.id', '=', 'personal_access_tokens.tokenable_id')
            ->where('personal_access_tokens.tokenable_type', 'App\Models\User')
            ->orderBy('users.email')
            ->orderByDesc('personal_access_tokens.last_used_at');
        if ($this->argument('email') !== null) {
            $query->where('users.email', mb_strtolower(trim($this->argument('email'))));
        }
        $rows = $query->get([
            'personal_access_tokens.id', 'users.email', 'personal_access_tokens.name',
            'personal_access_tokens.last_used_at', 'personal_access_tokens.created_at',
        ])->map(fn (object $device) => [
            $device->id,
            $device->email,
            $device->name,
            $device->last_used_at ?? 'jamais',
            $device->created_at,
        ]);

        $this->table(['Id', 'Compte', 'Appareil', 'Dernière activité (UTC)', 'Connecté le (UTC)'], $rows);

        return self::SUCCESS;
    }
}
