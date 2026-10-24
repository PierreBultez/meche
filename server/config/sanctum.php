<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;

// Sanctum is only used for API tokens, one per device (docs/04). No SPA, no cookies.
return [
    // No first-party browser application.
    'stateful' => [],

    // Empty: a request is authenticated by its token only, never by a session.
    'guard' => [],

    // No fixed lifetime: a token unused for `notes.token_inactivity_days` days is deleted by
    // notes:maintenance instead, and any device can be disconnected from the app.
    'expiration' => null,

    // Lets secret scanners (GitHub) recognise a Mèche token pasted somewhere by mistake.
    'token_prefix' => 'meche_',

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],
];
