<?php

use App\Http\Middleware\AddServerTiming;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Foundation\Http\Middleware\TrimStrings;
use Illuminate\Http\Request;

// API only (docs/04): no web routes, no sessions, no cookies. The root of the domain stays free.
return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // These two would change the notes: TrimStrings removes the spaces at the start and the
        // end of the content (the indentation of a code note), ConvertEmptyStringsToNull turns
        // an empty title into null. They also apply to JSON bodies, so they are removed.
        $middleware->remove([TrimStrings::class, ConvertEmptyStringsToNull::class]);
        // No login page to send a guest to: a request without a valid token gets a JSON 401,
        // even without `Accept: application/json` (the default would fail with a 500).
        $middleware->redirectGuestsTo(null);
        $middleware->append(AddServerTiming::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
