<?php

namespace App\Http\Controllers\Api;

use App\Accounts\InvitationCodes;
use App\Http\Controllers\Controller;
use App\Support\Clock;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/**
 * Invitation codes: any account can invite someone it trusts. A code creates one account and
 * expires after `notes.invitation_days` days. It is shown once, when it is created.
 */
class InvitationController extends Controller
{
    private const LISTED = 20;

    /** `GET /api/invitations`: the latest codes of this account (without the codes themselves). */
    public function index(Request $request): JsonResponse
    {
        $invitations = DB::table('invitations')
            ->leftJoin('users', 'users.id', '=', 'invitations.used_by')
            ->where('invitations.user_id', $request->user()->id)
            ->orderByDesc('invitations.id')
            ->limit(self::LISTED)
            ->get([
                'invitations.id', 'invitations.hint', 'invitations.created_at',
                'invitations.expires_at', 'invitations.used_at', 'users.email as used_by_email',
            ])
            ->map(fn (object $row) => [
                'id' => (int) $row->id,
                'hint' => $row->hint,
                'created_at' => (int) $row->created_at,
                'expires_at' => (int) $row->expires_at,
                'used_at' => $row->used_at === null ? null : (int) $row->used_at,
                'used_by_email' => $row->used_by_email,
            ]);

        return response()->json(['invitations' => $invitations], options: JSON_UNESCAPED_UNICODE);
    }

    /** `POST /api/invitations`: a new code, returned only this once. */
    public function store(Request $request): JsonResponse
    {
        $userId = $request->user()->id;
        $now = Clock::nowMs();
        $pending = DB::table('invitations')
            ->where('user_id', $userId)
            ->whereNull('used_at')
            ->where('expires_at', '>', $now)
            ->count();
        if ($pending >= config('notes.max_pending_invitations')) {
            return ApiError::response('too_many_invitations', 'too many unused invitation codes');
        }

        $code = InvitationCodes::generate();
        $expiresAt = $now + config('notes.invitation_days') * 86_400_000;
        $id = DB::table('invitations')->insertGetId([
            'user_id' => $userId,
            'code_hash' => InvitationCodes::hash($code),
            'hint' => substr($code, -4),
            'created_at' => $now,
            'expires_at' => $expiresAt,
        ]);

        return response()->json([
            'id' => $id,
            'code' => InvitationCodes::format($code),
            'hint' => substr($code, -4),
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'used_at' => null,
            'used_by_email' => null,
        ], 201);
    }

    /** `DELETE /api/invitations/{id}`: withdraws a code that has not been used. */
    public function destroy(Request $request, int $id): Response|JsonResponse
    {
        $deleted = DB::table('invitations')
            ->where('id', $id)
            ->where('user_id', $request->user()->id)
            ->whereNull('used_at')
            ->delete();
        if ($deleted === 0) {
            return ApiError::response('not_found', 'no such unused invitation', 404);
        }

        return response()->noContent();
    }
}
