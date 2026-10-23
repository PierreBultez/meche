<?php

use App\Http\Controllers\Api\HealthController;
use Illuminate\Support\Facades\Route;

// Every route is under /api (docs/04). No session, no cookie: devices send a Sanctum token.

Route::get('/health', HealthController::class)->middleware('throttle:60,1');
