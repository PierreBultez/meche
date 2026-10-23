<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\DeviceController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\InvitationController;
use App\Http\Controllers\Api\SyncController;
use Illuminate\Support\Facades\Route;

// Every route is under /api (docs/04). No session, no cookie: devices send a Sanctum token.

Route::get('/health', HealthController::class)->middleware('throttle:60,1');

Route::middleware('throttle:auth')->group(function () {
    Route::post('/auth/token', [AuthController::class, 'token']);
    Route::post('/auth/register', [AuthController::class, 'register']);
});

Route::middleware('auth:sanctum')->group(function () {
    Route::delete('/auth/token', [AuthController::class, 'revoke']);

    Route::post('/sync', SyncController::class)->middleware('throttle:sync');

    Route::get('/devices', [DeviceController::class, 'index']);
    Route::delete('/devices/{id}', [DeviceController::class, 'destroy'])->whereNumber('id');

    Route::get('/invitations', [InvitationController::class, 'index']);
    Route::post('/invitations', [InvitationController::class, 'store']);
    Route::delete('/invitations/{id}', [InvitationController::class, 'destroy'])->whereNumber('id');
});
