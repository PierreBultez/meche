<?php

use Illuminate\Support\Facades\Schedule;

// Scheduled tasks, run by the system cron: `* * * * * php artisan schedule:run` (docs/09).

Schedule::command('notes:maintenance')->everyTenMinutes()->withoutOverlapping();
