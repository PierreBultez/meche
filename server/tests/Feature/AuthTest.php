<?php

use App\Http\Controllers\Api\AuthController;
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
    ['POST', '/api/sync'],
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

it('answers 401 in JSON to a request without token, even without Accept: application/json', function (string $method, string $uri) {
    account();
    $this->call($method, $uri)->assertUnauthorized()->assertExactJson(['message' => 'Unauthenticated.']);
})->with([
    ['POST', '/api/sync'],
    ['GET', '/api/devices'],
]);

it('checks an unknown address against a real bcrypt hash of production cost', function () {
    $reflection = new ReflectionClassConstant(AuthController::class, 'DUMMY_HASH');
    $info = password_get_info($reflection->getValue());
    expect($info['algoName'])->toBe('bcrypt')->and($info['options']['cost'])->toBe(12);
});

it('does not time the login answers (Server-Timing), but times the others', function () {
    account();
    $this->postJson('/api/auth/token', [
        'email' => 'nobody@example.com', 'password' => PASSWORD, 'device_name' => 'PC',
    ])->assertHeaderMissing('Server-Timing');
    $this->getJson('/api/health')->assertHeader('Server-Timing');
});

it('limits the attempts on one address to 30 per hour, from any IP', function () {
    account();
    foreach (range(1, 30) as $i) {
        $this->postJson('/api/auth/token', ['email' => 'pierre@example.com', 'password' => 'wrong', 'device_name' => 'PC'], [
            'REMOTE_ADDR' => "203.0.113.{$i}",
        ]);
    }
    $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.1'])
        ->postJson('/api/auth/token', ['email' => 'Pierre@example.com', 'password' => PASSWORD, 'device_name' => 'PC'])
        ->assertTooManyRequests();
});

it('logs failed logins in the file read by fail2ban', function () {
    account();
    $path = storage_path('logs/auth.log');
    @unlink($path);

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.7'])->postJson('/api/auth/token', [
        'email' => 'pierre@example.com', 'password' => 'wrong', 'device_name' => 'PC',
    ]);

    expect(file_get_contents($path))
        ->toMatch('/^\[[0-9-]+ [0-9:]+\] \w+\.WARNING: Failed login \{"ip":"203\.0\.113\.7"\}/');
    @unlink($path);
});

it('throttles the other routes of a device to 60 per minute', function () {
    $token = deviceToken(account());
    foreach (range(1, 60) as $ignored) {
        freshRequest();
        $this->withToken($token)->getJson('/api/devices')->assertOk();
    }
    freshRequest();
    $this->withToken($token)->getJson('/api/devices')->assertTooManyRequests();
});
