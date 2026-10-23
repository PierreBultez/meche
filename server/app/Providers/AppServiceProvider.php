<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        // Logging in and creating an account: 5 tries per minute per IP address (docs/04).
        RateLimiter::for('auth', fn (Request $request) => Limit::perMinute(5)->by($request->ip()));

        // A device syncs about once a minute; this only stops a client stuck in a loop.
        RateLimiter::for('sync', fn (Request $request) => Limit::perMinute(300)->by($request->user()?->id ?: $request->ip()));
    }
}
