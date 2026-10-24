<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Support\Clock;
use Illuminate\Http\JsonResponse;

/** `GET /api/health`: tells the app (« Tester la connexion ») that a Mèche server answers here. */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return response()->json([
            'ok' => true,
            // Version of the sync protocol, raised on an incompatible change.
            'api' => 1,
            'server_time' => Clock::nowMs(),
        ]);
    }
}
