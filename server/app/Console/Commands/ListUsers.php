<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/** Lists the accounts, who invited them, and how much they use the server. */
class ListUsers extends Command
{
    protected $signature = 'notes:users';

    protected $description = 'Liste les comptes Mèche';

    public function handle(): int
    {
        $rows = DB::table('users')
            ->leftJoin('users as inviters', 'inviters.id', '=', 'users.invited_by')
            ->orderBy('users.id')
            ->get(['users.id', 'users.email', 'inviters.email as inviter', 'users.created_at'])
            ->map(fn (object $user) => [
                $user->id,
                $user->email,
                $user->inviter ?? '—',
                substr((string) $user->created_at, 0, 10),
                DB::table('notes')->where('user_id', $user->id)->where('deleted', false)->count(),
                DB::table('personal_access_tokens')
                    ->where('tokenable_type', 'App\Models\User')
                    ->where('tokenable_id', $user->id)
                    ->count(),
            ]);

        $this->table(['Id', 'E-mail', 'Invité par', 'Créé le', 'Notes', 'Appareils'], $rows);

        return self::SUCCESS;
    }
}
