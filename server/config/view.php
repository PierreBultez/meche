<?php

// API only: no Blade views of its own. An empty list keeps `php artisan optimize` (view:cache,
// run by the deployment) from looking for resources/views. Laravel's error pages bring theirs.
return [
    'paths' => [],
    'compiled' => env('VIEW_COMPILED_PATH', realpath(storage_path('framework/views'))),
];
