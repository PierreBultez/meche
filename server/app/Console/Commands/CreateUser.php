<?php

namespace App\Console\Commands;

use App\Accounts\Accounts;
use App\Models\User;
use Illuminate\Console\Command;

/** Creates an account without invitation: the first one, on a new server (docs/04). */
class CreateUser extends Command
{
    protected $signature = 'notes:create-user {--email= : Adresse e-mail du compte}';

    protected $description = 'Crée un compte Mèche (les suivants se créent dans l\'application avec un code d\'invitation)';

    public function handle(): int
    {
        $email = Accounts::normalizeEmail((string) ($this->option('email') ?? $this->ask('Adresse e-mail')));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $this->error('Cette adresse e-mail n\'est pas valide.');

            return self::FAILURE;
        }
        if (User::query()->where('email', $email)->exists()) {
            $this->error('Un compte utilise déjà cette adresse.');

            return self::FAILURE;
        }

        $password = (string) $this->secret('Mot de passe ('.config('notes.password_min_chars').' caractères au moins)');
        $problem = Accounts::passwordProblem($password);
        if ($problem !== null) {
            $this->error("Mot de passe refusé : il faut {$problem}.");

            return self::FAILURE;
        }
        if ($this->secret('Le même mot de passe, encore une fois') !== $password) {
            $this->error('Les deux mots de passe sont différents.');

            return self::FAILURE;
        }

        Accounts::create($email, $password);
        $this->info("Compte créé : {$email}.");

        return self::SUCCESS;
    }
}
