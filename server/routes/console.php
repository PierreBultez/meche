<?php

use Illuminate\Support\Facades\Schedule;

// Scheduled tasks, run by the system cron: `* * * * * php artisan schedule:run` (docs/09).

// The lock lasts 9 minutes at most: if a run is killed, the next one is not blocked (the default
// would be 24 hours). Writes are serialised by the counter lock anyway.
Schedule::command('notes:maintenance')->everyTenMinutes()->withoutOverlapping(9);
