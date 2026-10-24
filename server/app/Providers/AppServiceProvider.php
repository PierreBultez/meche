<?php

namespace App\Providers;

use App\Accounts\Accounts;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // Logging in and creating an account: 5 tries per minute per IP address (docs/04), and
        // 30 per hour per e-mail address, whatever the IP. That one is loose on purpose: anyone
        // can use it to block an address for an hour.
        RateLimiter::for('auth', function (Request $request) {
            // Not a string (an array…): counted under an empty address rather than failing
            // here, before any limit.
            $email = $request->input('email');

            return [
                Limit::perMinute(5)->by('ip:'.$request->ip()),
                // Normalized like the account lookup, so both agree on what one address is.
                Limit::perHour(30)->by('email:'.(is_string($email) ? Accounts::normalizeEmail($email) : '')),
            ];
        });

        // A device syncs about once a minute; this only stops a client stuck in a loop.
        RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(300)->by('user:'.$request->user()?->id));

        // The other routes of a connected device (devices, invitations, logout).
        RateLimiter::for('account', fn (Request $request) => Limit::perMinute(60)->by('user:'.$request->user()?->id));
    }
}
