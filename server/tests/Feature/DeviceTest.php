<?php

use Laravel\Sanctum\PersonalAccessToken;

it('lists the devices of the account, the current one marked', function () {
    $user = account();
    $phone = deviceToken($user, 'Téléphone');
    $this->travel(1)->minutes();
    $desktop = deviceToken($user, 'PC bureau');
    deviceToken(account('other@example.com'), 'Autre');

    $devices = $this->withToken($desktop)->getJson('/api/devices')->assertOk()->json('devices');

    expect(array_column($devices, 'name'))->toBe(['PC bureau', 'Téléphone'])
        ->and(array_column($devices, 'current'))->toBe([true, false])
        ->and($devices[0]['last_used_at'])->toBeInt()
        ->and($devices[1]['last_used_at'])->toBeNull()
        ->and($devices[1]['created_at'])->toBeInt();
});

it('disconnects another device of the same account only', function () {
    $user = account();
    $desktop = deviceToken($user, 'PC');
    $phone = deviceToken($user, 'Téléphone');
    $otherId = account('other@example.com')->createToken('Autre')->accessToken->id;
    $phoneId = $user->tokens()->where('name', 'Téléphone')->value('id');

    $this->withToken($desktop)->deleteJson("/api/devices/{$otherId}")->assertNotFound();
    $this->withToken($desktop)->deleteJson("/api/devices/{$phoneId}")->assertNoContent();

    freshRequest();
    $this->withToken($phone)->getJson('/api/devices')->assertUnauthorized();
    expect(PersonalAccessToken::query()->whereKey($otherId)->exists())->toBeTrue();
});
