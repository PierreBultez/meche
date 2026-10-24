<?php

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\File;

// PHP-FPM and the cron (www-data) write the cache in production (docs/09): a folder it creates
// without the execute bit could no longer be gone through, and every throttled route would
// answer 500.
it('creates cache folders that their owner can go through', function () {
    $path = storage_path('framework/testing/cache-'.uniqid());
    config(['cache.stores.file_check' => [...config('cache.stores.file'), 'path' => $path]]);

    Cache::store('file_check')->put('a', 1, 60);
    Cache::store('file_check')->put('b', 2, 60);

    expect(Cache::store('file_check')->get('b'))->toBe(2);
    $folders = File::allDirectories($path);
    expect($folders)->not->toBeEmpty();
    foreach ($folders as $folder) {
        expect(fileperms($folder) & 0o100)->toBe(0o100);
    }
    File::deleteDirectory($path);
});
