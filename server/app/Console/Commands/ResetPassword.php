<?php

namespace App\Console\Commands;

use App\Accounts\Accounts;
use App\Models\User;
use Illuminate\Console\Command;

/** There is no password reset by e-mail: the server's administrator does it here. */
class ResetPassword extends Command
{
    protected $signature = 'notes:reset-password {email : Adresse e-mail du compte}
        {--logout : Déconnecte aussi tous les appareils du compte}';

    protected $description = 'Change le mot de passe d\'un compte Mèche';

    public function handle(): int
    {
        $user = User::query()->where('email', Accounts::normalizeEmail($this->argument('email')))->first();
        if ($user === null) {
            $this->error('Aucun compte n\'utilise cette adresse.');

            return self::FAILURE;
        }
        $password = (string) $this->secret('Nouveau mot de passe');
        $problem = Accounts::passwordProblem($password);
        if ($problem !== null) {
            $this->error("Mot de passe refusé : il faut {$problem}.");

            return self::FAILURE;
        }
        if ($this->secret('Le même mot de passe, encore une fois') !== $password) {
            $this->error('Les deux mots de passe sont différents.');

            return self::FAILURE;
        }

        $user->password = $password;
        $user->save();
        if ($this->option('logout')) {
            $user->tokens()->delete();
        }
        $this->info('Mot de passe changé.');

        return self::SUCCESS;
    }
}
