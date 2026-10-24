<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Adds `Server-Timing: app;dur=12.3` to every response: the time spent in PHP, in milliseconds,
 * from the start of public/index.php. `curl -sI` shows it, which is how the targets of docs/04
 * (< 50 ms without changes, < 150 ms for a typical sync) are measured in production.
 */
class AddServerTiming
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        // Not on logging in or creating an account: a precise duration there could tell
        // whether an address has an account.
        if ($request->is('api/auth/*')) {
            return $response;
        }
        $start = defined('LARAVEL_START') ? LARAVEL_START : $request->server('REQUEST_TIME_FLOAT');
        if (is_float($start)) {
            $duration = (microtime(true) - $start) * 1000;
            $response->headers->set('Server-Timing', sprintf('app;dur=%.1f', $duration));
        }

        return $response;
    }
}
