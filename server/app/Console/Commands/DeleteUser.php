<?php

namespace App\Console\Commands;

use App\Accounts\Accounts;
use App\Models\User;
use Illuminate\Console\Command;

/** Deletes an account and all its notes on the server (the devices keep their local copy). */
class DeleteUser extends Command
{
    protected $signature = 'notes:delete-user {email : Adresse e-mail du compte} {--force : Sans confirmation}';

    protected $description = 'Supprime un compte Mèche et ses notes sur le serveur';

    public function handle(): int
    {
        $email = Accounts::normalizeEmail($this->argument('email'));
        $user = User::query()->where('email', $email)->first();
        if ($user === null) {
            $this->error('Aucun compte n\'utilise cette adresse.');

            return self::FAILURE;
        }
        if (! $this->option('force')
            && $this->ask("Tape l'adresse du compte pour confirmer la suppression ({$email})") !== $email) {
            $this->warn('Rien n\'a été supprimé.');

            return self::FAILURE;
        }

        Accounts::delete($user);
        $this->info("Compte supprimé : {$email}.");

        return self::SUCCESS;
    }
}
