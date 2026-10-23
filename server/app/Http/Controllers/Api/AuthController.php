<?php

namespace App\Http\Controllers\Api;

use App\Accounts\Accounts;
use App\Accounts\InvitationCodes;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Support\Clock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

/**
 * Device tokens (docs/04, "Authentification"): logging in or creating an account gives the
 * device its own Sanctum token, which it sends with every request until it logs out.
 */
class AuthController extends Controller
{
    /**
     * A bcrypt hash (cost 12, as BCRYPT_ROUNDS in production) of a password nobody uses. An
     * unknown address is checked against it, so that the answer takes the same time as for a
     * known address with a wrong password: the timing does not tell which addresses exist.
     */
    private const DUMMY_HASH = '$2y$12$LZCgMpnPPSOJf79ZoY3ibO5yoWnEGK1x8dtSMvSZGhG1DHyVR6Zz2';

    /** `POST /api/auth/token`: logs a device in. */
    public function token(Request $request): JsonResponse
    {
        $email = $request->input('email');
        $password = $request->input('password');
        $device = self::deviceName($request->input('device_name'));
        if (! is_string($email) || ! is_string($password) || $device === null) {
            return ApiError::response('invalid_input', 'email, password and device_name are required');
        }

        $user = User::query()->where('email', Accounts::normalizeEmail($email))->first();
        if ($user === null || ! Hash::check($password, $user->password)) {
            if ($user === null) {
                Hash::check($password, self::DUMMY_HASH);
            }
            // Read by fail2ban (server/deploy/fail2ban-filter.conf).
            Log::channel('auth')->warning('Failed login', ['ip' => $request->ip()]);

            return ApiError::response('invalid_credentials', 'wrong e-mail or password', 401);
        }
        if (Hash::needsRehash($user->password)) {
            $user->password = $password;
            $user->save();
        }

        return self::tokenResponse($user, $device);
    }

    /** `POST /api/auth/register`: creates an account with an invitation code, then logs in. */
    public function register(Request $request): JsonResponse
    {
        $typedCode = $request->input('invitation_code');
        $email = $request->input('email');
        $password = $request->input('password');
        $device = self::deviceName($request->input('device_name'));
        if (! is_string($typedCode) || ! is_string($email) || ! is_string($password) || $device === null) {
            return ApiError::response(
                'invalid_input',
                'invitation_code, email, password and device_name are required',
            );
        }
        $code = InvitationCodes::normalize($typedCode);
        if ($code === null) {
            Log::channel('auth')->warning('Failed invitation code', ['ip' => $request->ip()]);

            return ApiError::response('invalid_invitation', 'this invitation code does not exist');
        }
        $email = Accounts::normalizeEmail($email);
        if (mb_strlen($email) > 255 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            return ApiError::response('invalid_email', 'this e-mail address is not valid');
        }
        $problem = Accounts::passwordProblem($password);
        if ($problem !== null) {
            return ApiError::response('weak_password', "the password needs {$problem}");
        }

        // The invitation row stays locked until the account exists: two devices using the same
        // code at the same moment cannot both create an account.
        try {
            $result = $this->createInvitedAccount($code, $email, $password);
        } catch (UniqueConstraintViolationException) {
            // Another registration took this address at the same moment.
            $result = 'email_taken';
        }

        if ($result === 'invalid_invitation') {
            Log::channel('auth')->warning('Failed invitation code', ['ip' => $request->ip()]);
        }

        return match ($result) {
            'invalid_invitation' => ApiError::response(
                'invalid_invitation',
                'this invitation code does not exist, was already used or has expired',
            ),
            'email_taken' => ApiError::response('email_taken', 'an account already uses this e-mail'),
            default => self::tokenResponse($result, $device, 201),
        };
    }

    /** The new account, or the reason it was not created (`invalid_invitation`, `email_taken`). */
    private function createInvitedAccount(string $code, string $email, string $password): User|string
    {
        return DB::transaction(function () use ($code, $email, $password) {
            $invitation = DB::table('invitations')
                ->where('code_hash', InvitationCodes::hash($code))
                ->lockForUpdate()
                ->first();
            if ($invitation === null || $invitation->used_at !== null
                || $invitation->expires_at <= Clock::nowMs()) {
                return 'invalid_invitation';
            }
            if (User::query()->where('email', $email)->exists()) {
                return 'email_taken';
            }
            $user = Accounts::create($email, $password, $invitation->user_id);
            DB::table('invitations')->where('id', $invitation->id)->update([
                'used_by' => $user->id,
                'used_at' => Clock::nowMs(),
            ]);

            return $user;
        });
    }

    /** `DELETE /api/auth/token`: logs this device out (its token stops working). */
    public function revoke(Request $request): Response
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }

    private static function tokenResponse(User $user, string $device, int $status = 200): JsonResponse
    {
        $token = $user->createToken($device);

        return response()->json([
            'token' => $token->plainTextToken,
            'email' => $user->email,
            'sync_id' => DB::table('sync_counters')->where('user_id', $user->id)->value('sync_id'),
        ], $status);
    }

    /** The device name, trimmed, 1 to 100 characters; null when missing or invalid. */
    private static function deviceName(mixed $name): ?string
    {
        if (! is_string($name)) {
            return null;
        }
        $name = trim($name);

        return $name === '' || mb_strlen($name) > 100 ? null : $name;
    }
}
