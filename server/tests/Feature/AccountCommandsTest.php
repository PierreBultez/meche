<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

it('creates the first account, asking the password twice', function () {
    $this->artisan('notes:create-user')
        ->expectsQuestion('Adresse e-mail', ' Pierre@Example.com ')
        ->expectsQuestion('Mot de passe (12 caractères au moins)', PASSWORD)
        ->expectsQuestion('Le même mot de passe, encore une fois', PASSWORD)
        ->expectsOutputToContain('Compte créé : pierre@example.com.')
        ->assertSuccessful();

    $user = User::query()->sole();
    expect(Hash::check(PASSWORD, $user->password))->toBeTrue()
        ->and($user->invited_by)->toBeNull()
        ->and(DB::table('sync_counters')->where('user_id', $user->id)->exists())->toBeTrue();
});

it('refuses a short password, two different passwords or an address in use', function () {
    $this->artisan('notes:create-user', ['--email' => 'a@example.com'])
        ->expectsQuestion('Mot de passe (12 caractères au moins)', 'court')
        ->assertFailed();
    $this->artisan('notes:create-user', ['--email' => 'a@example.com'])
        ->expectsQuestion('Mot de passe (12 caractères au moins)', PASSWORD)
        ->expectsQuestion('Le même mot de passe, encore une fois', 'autre chose encore')
        ->assertFailed();
    account('a@example.com');
    $this->artisan('notes:create-user', ['--email' => 'A@example.com'])->assertFailed();

    expect(User::query()->count())->toBe(1);
});

it('resets a password, and can log every device out', function () {
    $user = account();
    deviceToken($user);

    $this->artisan('notes:reset-password', ['email' => 'pierre@example.com', '--logout' => true])
        ->expectsQuestion('Nouveau mot de passe', 'un tout nouveau mot de passe')
        ->expectsQuestion('Le même mot de passe, encore une fois', 'un tout nouveau mot de passe')
        ->assertSuccessful();

    $user->refresh();
    expect(Hash::check('un tout nouveau mot de passe', $user->password))->toBeTrue()
        ->and($user->tokens()->count())->toBe(0);
});

it('deletes an account with its notes, tokens and invitations, after confirmation', function () {
    $pierre = account();
    $papa = account('papa@example.com', $pierre->id);
    deviceToken($papa);
    DB::table('notes')->insert([
        'id' => '0192f1c2-0000-7000-8000-000000000001', 'user_id' => $papa->id, 'content' => 'x',
        'created_at' => 1, 'updated_at' => 1, 'rev' => 1,
    ]);

    $this->artisan('notes:delete-user', ['email' => 'papa@example.com'])
        ->expectsQuestion("Tape l'adresse du compte pour confirmer la suppression (papa@example.com)", 'non')
        ->assertFailed();
    expect(User::query()->count())->toBe(2);

    $this->artisan('notes:delete-user', ['email' => 'papa@example.com', '--force' => true])->assertSuccessful();

    expect(User::query()->pluck('email')->all())->toBe(['pierre@example.com'])
        ->and(DB::table('notes')->count())->toBe(0)
        ->and(DB::table('sync_counters')->count())->toBe(1)
        ->and(DB::table('personal_access_tokens')->count())->toBe(0);
});

it('lists accounts and devices, and disconnects a device', function () {
    $pierre = account();
    account('papa@example.com', $pierre->id);
    $id = $pierre->createToken('PC bureau')->accessToken->id;

    $this->artisan('notes:users')
        ->expectsOutputToContain('papa@example.com')
        ->assertSuccessful();
    $this->artisan('notes:devices', ['email' => 'pierre@example.com'])
        ->expectsOutputToContain('PC bureau')
        ->assertSuccessful();
    $this->artisan('notes:revoke-device', ['id' => $id])->assertSuccessful();
    $this->artisan('notes:revoke-device', ['id' => $id])->assertFailed();

    expect($pierre->tokens()->count())->toBe(0);
});
