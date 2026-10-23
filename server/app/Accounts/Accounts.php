<?php

namespace App\Accounts;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Creating and deleting accounts, with everything that belongs to them. */
class Accounts
{
    /** Creates an account and its sync counter, in one transaction. */
    public static function create(string $email, string $password, ?int $invitedBy = null): User
    {
        return DB::transaction(function () use ($email, $password, $invitedBy) {
            $user = new User([
                'name' => Str::before($email, '@'),
                'email' => $email,
                'password' => $password,
            ]);
            $user->invited_by = $invitedBy;
            $user->save();
            DB::table('sync_counters')->insert([
                'user_id' => $user->id,
                'value' => 0,
                'sync_id' => (string) Str::uuid(),
            ]);

            return $user;
        });
    }

    /**
     * Deletes an account: its notes, counter and invitations go with it (foreign keys), its
     * device tokens are deleted here (Sanctum links them without a foreign key).
     */
    public static function delete(User $user): void
    {
        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            $user->delete();
        });
    }

    /** Lowercase and without spaces around: the same address is always found. */
    public static function normalizeEmail(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    /** Null when the password is acceptable, otherwise the reason. */
    public static function passwordProblem(string $password): ?string
    {
        $min = config('notes.password_min_chars');
        if (mb_strlen($password) < $min) {
            return "at least {$min} characters";
        }
        if (strlen($password) > 1000) {
            return 'at most 1000 bytes';
        }

        return null;
    }
}
