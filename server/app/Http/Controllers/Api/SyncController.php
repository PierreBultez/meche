<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Sync\ChangeValidator;
use App\Sync\ForeignNote;
use App\Sync\InvalidChange;
use App\Sync\SyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** `POST /api/sync`: push and pull in one round trip (docs/04). */
class SyncController extends Controller
{
    public function __invoke(Request $request, SyncService $sync): JsonResponse
    {
        try {
            $input = ChangeValidator::validate($request->json()->all());
            $result = $sync->sync($request->user()->id, $input['cursor'], $input['changes']);
        } catch (InvalidChange $error) {
            return ApiError::response('invalid_change', $error->getMessage());
        } catch (ForeignNote $error) {
            return ApiError::response('id_conflict', $error->getMessage(), 409);
        }

        // Accents and slashes as they are: smaller answers (Apache compresses them with gzip).
        return response()->json($result, options: JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
