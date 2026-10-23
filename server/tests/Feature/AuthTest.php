<?php

use App\Models\User;
use Illuminate\Support\Facades\DB;

it('gives a device a token with the right e-mail and password', function () {
    $user = account();

    $response = $this->postJson('/api/auth/token', [
        'email' => '  Pierre@Example.com ',
        'password' => PASSWORD,
        'device_name' => 'PC bureau Ubuntu',
    ])->assertOk();

    expect($response->json('token'))->toStartWith($user->tokens()->first()->id.'|meche_')
        ->and($response->json('email'))->toBe('pierre@example.com')
        ->and($response->json('sync_id'))
        ->toBe(DB::table('sync_counters')->where('user_id', $user->id)->value('sync_id'));
    expect($user->tokens()->first()->name)->toBe('PC bureau Ubuntu');

    freshRequest();
    $this->withToken($response->json('token'))->getJson('/api/devices')->assertOk();
});

it('refuses a wrong password or an unknown address with the same answer', function () {
    account();

    $wrongPassword = $this->postJson('/api/auth/token', [
        'email' => 'pierre@example.com', 'password' => 'not the password', 'device_name' => 'PC',
    ]);
    $unknown = $this->postJson('/api/auth/token', [
        'email' => 'nobody@example.com', 'password' => PASSWORD, 'device_name' => 'PC',
    ]);

    $wrongPassword->assertUnauthorized()->assertJson(['error' => 'invalid_credentials']);
    $unknown->assertUnauthorized()->assertJson(['error' => 'invalid_credentials']);
    expect(DB::table('personal_access_tokens')->count())->toBe(0);
});

it('requires an e-mail, a password and a device name', function (array $body) {
    account();
    $this->postJson('/api/auth/token', $body)->assertStatus(422)->assertJson(['error' => 'invalid_input']);
})->with([
    'no device name' => [['email' => 'pierre@example.com', 'password' => PASSWORD]],
    'blank device name' => [['email' => 'pierre@example.com', 'password' => PASSWORD, 'device_name' => '  ']],
    'device name too long' => [['email' => 'pierre@example.com', 'password' => PASSWORD, 'device_name' => str_repeat('a', 101)]],
    'password not a string' => [['email' => 'pierre@example.com', 'password' => 123, 'device_name' => 'PC']],
]);

it('allows 5 login attempts per minute and per address', function () {
    account();
    $attempt = fn () => $this->postJson('/api/auth/token', [
        'email' => 'pierre@example.com', 'password' => 'wrong', 'device_name' => 'PC',
    ]);

    foreach (range(1, 5) as $ignored) {
        $attempt()->assertUnauthorized();
    }
    $attempt()->assertTooManyRequests()->assertHeader('Retry-After');

    // Even the right password waits.
    $this->postJson('/api/auth/token', [
        'email' => 'pierre@example.com', 'password' => PASSWORD, 'device_name' => 'PC',
    ])->assertTooManyRequests();

    $this->travel(61)->seconds();
    $attempt()->assertUnauthorized();
});

it('logs out only the device that asks', function () {
    $user = account();
    $desktop = deviceToken($user, 'PC');
    $phone = deviceToken($user, 'Téléphone');

    $this->withToken($desktop)->deleteJson('/api/auth/token')->assertNoContent();

    freshRequest();
    $this->withToken($desktop)->getJson('/api/devices')->assertUnauthorized();
    freshRequest();
    $this->withToken($phone)->getJson('/api/devices')->assertOk();
    expect($user->tokens()->pluck('name')->all())->toBe(['Téléphone']);
});

it('refuses every protected route without a valid token', function (string $method, string $uri) {
    account();
    $this->json($method, $uri)->assertUnauthorized();
    freshRequest();
    $this->withToken('1|meche_not-a-real-token')->json($method, $uri)->assertUnauthorized();
})->with([
    ['DELETE', '/api/auth/token'],
    ['GET', '/api/devices'],
    ['DELETE', '/api/devices/1'],
    ['GET', '/api/invitations'],
    ['POST', '/api/invitations'],
    ['DELETE', '/api/invitations/1'],
]);

it('rehashes a password stored with an older cost', function () {
    $user = account();
    DB::table('users')->where('id', $user->id)->update([
        'password' => password_hash(PASSWORD, PASSWORD_BCRYPT, ['cost' => 5]),
    ]);

    $this->postJson('/api/auth/token', [
        'email' => 'pierre@example.com', 'password' => PASSWORD, 'device_name' => 'PC',
    ])->assertOk();

    expect(password_get_info(User::find($user->id)->password)['options']['cost'])->not->toBe(5);
});
