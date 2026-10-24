<?php

// No browser ever calls this API (the app talks to it from Rust): CORS stays closed, so a web
// page cannot use it from someone's browser.
return [
    'paths' => [],
    'allowed_methods' => [],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => [],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
