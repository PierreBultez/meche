<?php

use App\Accounts\InvitationCodes;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/** Creates an invitation code with the API, as the app does, and returns it. */
function invite(User $inviter): string
{
    freshRequest();

    return test()->withToken(deviceToken($inviter))->postJson('/api/invitations')->assertCreated()->json('code');
}

function register(array $overrides = []): TestResponse
{
    freshRequest();

    return test()->postJson('/api/auth/register', array_merge([
        'email' => 'papa@example.com',
        'password' => 'une phrase de passe longue',
        'device_name' => 'PC de papa',
    ], $overrides));
}

it('creates a code shown once, valid 7 days', function () {
    $user = account();
    $this->travelTo(now()->setTimestamp(1_761_000_000));

    $response = $this->withToken(deviceToken($user))->postJson('/api/invitations')->assertCreated();

    $code = $response->json('code');
    expect($code)->toMatch('/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/')
        ->and($response->json('hint'))->toBe(substr($code, -4))
        ->and($response->json('expires_at'))->toBe(1_761_000_000_000 + 7 * 86_400_000);
    // Only a hash of the code is kept.
    $row = DB::table('invitations')->first();
    expect($row->code_hash)->toBe(hash('sha256', str_replace('-', '', $code)))
        ->and(json_encode($row))->not->toContain(str_replace('-', '', $code));
});

it('lists the codes of the account without the codes themselves', function () {
    $pierre = account();
    $other = account('other@example.com');
    $code = invite($pierre);
    invite($other);
    register(['invitation_code' => $code])->assertCreated();
    freshRequest();

    $list = $this->withToken(deviceToken($pierre))->getJson('/api/invitations')->assertOk()->json('invitations');

    expect($list)->toHaveCount(1)
        ->and($list[0]['used_by_email'])->toBe('papa@example.com')
        ->and($list[0]['used_at'])->toBeInt()
        ->and(json_encode($list))->not->toContain(str_replace('-', '', $code));
});

it('keeps at most 5 unused codes per account', function () {
    $user = account();
    $token = deviceToken($user);
    foreach (range(1, 5) as $ignored) {
        $this->withToken($token)->postJson('/api/invitations')->assertCreated();
    }
    $this->withToken($token)->postJson('/api/invitations')
        ->assertStatus(422)->assertJson(['error' => 'too_many_invitations']);

    // An expired code no longer counts.
    $this->travel(8)->days();
    $this->withToken($token)->postJson('/api/invitations')->assertCreated();
});

it('withdraws an unused code of its own account only', function () {
    $pierre = account();
    $other = account('other@example.com');
    invite($pierre);
    $id = DB::table('invitations')->value('id');

    freshRequest();
    $this->withToken(deviceToken($other))->deleteJson("/api/invitations/{$id}")->assertNotFound();
    freshRequest();
    $this->withToken(deviceToken($pierre))->deleteJson("/api/invitations/{$id}")->assertNoContent();
    expect(DB::table('invitations')->count())->toBe(0);
});

it('creates an account with a code, logs it in and remembers who invited it', function () {
    $pierre = account();
    $code = invite($pierre);

    $response = register(['invitation_code' => strtolower(str_replace('-', ' ', $code))])->assertCreated();

    $papa = User::query()->where('email', 'papa@example.com')->first();
    expect($papa->invited_by)->toBe($pierre->id)
        ->and($response->json('token'))->toStartWith($papa->tokens()->first()->id.'|meche_')
        ->and($response->json('sync_id'))->toBe(DB::table('sync_counters')->where('user_id', $papa->id)->value('sync_id'))
        ->and(DB::table('invitations')->value('used_by'))->toBe($papa->id);

    // The new account can invite someone in turn.
    $this->withToken($response->json('token'))->postJson('/api/invitations')->assertCreated();
});

it('refuses a code already used, expired, withdrawn or unknown', function () {
    $pierre = account();
    $used = invite($pierre);
    register(['invitation_code' => $used])->assertCreated();
    register(['invitation_code' => $used, 'email' => 'other@example.com'])
        ->assertStatus(422)->assertJson(['error' => 'invalid_invitation']);

    $expired = invite($pierre);
    $this->travel(7)->days();
    register(['invitation_code' => $expired, 'email' => 'late@example.com'])
        ->assertJson(['error' => 'invalid_invitation']);

    register(['invitation_code' => '0000-0000-0000', 'email' => 'x@example.com'])
        ->assertJson(['error' => 'invalid_invitation']);
    register(['invitation_code' => 'not a code', 'email' => 'x@example.com'])
        ->assertJson(['error' => 'invalid_invitation']);
    expect(User::query()->count())->toBe(2);
});

it('reads O as 0 and I or L as 1 in a typed code', function () {
    expect(InvitationCodes::normalize('o1l1-IIOO-abcd'))->toBe('01111100ABCD')
        ->and(InvitationCodes::normalize('7KQ2M9XD4TPH'))->toBe('7KQ2M9XD4TPH')
        ->and(InvitationCodes::normalize('7KQ2-M9XD-4TP'))->toBeNull()
        ->and(InvitationCodes::normalize('7KQ2-M9XD-4TPU'))->toBeNull();
});

it('checks the address and the password, and keeps the code when it refuses', function () {
    $pierre = account();
    $code = invite($pierre);

    register(['invitation_code' => $code, 'email' => 'pas une adresse'])
        ->assertJson(['error' => 'invalid_email']);
    register(['invitation_code' => $code, 'password' => 'trop court'])
        ->assertJson(['error' => 'weak_password']);
    register(['invitation_code' => $code, 'email' => 'PIERRE@example.com'])
        ->assertJson(['error' => 'email_taken']);
    register(['invitation_code' => $code, 'device_name' => ''])
        ->assertJson(['error' => 'invalid_input']);

    // None of these used the code.
    register(['invitation_code' => $code])->assertCreated();
});

it('refuses a password longer than bcrypt can use (72 bytes)', function () {
    $code = invite(account());
    register(['invitation_code' => $code, 'password' => str_repeat('é', 37)])
        ->assertJson(['error' => 'weak_password']);
    register(['invitation_code' => $code, 'password' => str_repeat('é', 36)])->assertCreated();
});
