<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Laravel\Sanctum\PersonalAccessToken;

/** The devices connected to an account (one Sanctum token each), to disconnect a lost one. */
class DeviceController extends Controller
{
    /** `GET /api/devices` */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        $currentId = $user->currentAccessToken()->id;
        $devices = $user->tokens()
            ->orderByDesc('last_used_at')
            ->orderByDesc('id')
            ->get(['id', 'name', 'last_used_at', 'created_at'])
            ->map(fn (PersonalAccessToken $token) => [
                'id' => $token->id,
                'name' => $token->name,
                'created_at' => $token->created_at?->getTimestampMs(),
                'last_used_at' => $token->last_used_at?->getTimestampMs(),
                'current' => $token->id === $currentId,
            ]);

        return response()->json(['devices' => $devices], options: JSON_UNESCAPED_UNICODE);
    }

    /** `DELETE /api/devices/{id}`: that device is logged out at its next request. */
    public function destroy(Request $request, int $id): Response|JsonResponse
    {
        $deleted = $request->user()->tokens()->whereKey($id)->delete();
        if ($deleted === 0) {
            return ApiError::response('not_found', 'no such device', 404);
        }

        return response()->noContent();
    }
}
