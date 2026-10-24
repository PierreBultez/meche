<?php

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;

/**
 * Errors of the API: `{ "error": "invalid_credentials", "message": "…" }`. `error` is a stable
 * code that the app turns into a French message; `message` is for logs.
 */
class ApiError
{
    public static function response(string $code, string $message, int $status = 422): JsonResponse
    {
        return response()->json(['error' => $code, 'message' => $message], $status);
    }
}
