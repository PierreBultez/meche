<?php

use App\Accounts\Accounts;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

pest()->extend(TestCase::class)->use(RefreshDatabase::class)->in('Feature');

const PASSWORD = 'correct horse battery';

/** An account with its sync counter, as notes:create-user or a registration makes it. */
function account(string $email = 'pierre@example.com', ?int $invitedBy = null): User
{
    return Accounts::create($email, PASSWORD, $invitedBy);
}

/** A device token of `$user` (the string a device sends in `Authorization: Bearer …`). */
function deviceToken(User $user, string $device = 'PC bureau'): string
{
    return $user->createToken($device)->plainTextToken;
}

/**
 * Forgets who the previous request authenticated. In tests, Laravel keeps the same application
 * between requests and the Sanctum guard remembers its user: without this, a revoked token
 * would still look valid in the next request of the same test.
 */
function freshRequest(): void
{
    app('auth')->forgetGuards();
}
