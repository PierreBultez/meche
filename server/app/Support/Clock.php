<?php

namespace App\Support;

/** Dates are milliseconds since the Unix epoch (UTC) everywhere (docs/03). */
class Clock
{
    /** Now, in milliseconds. Follows `$this->travelTo()` in tests. */
    public static function nowMs(): int
    {
        return now()->getTimestampMs();
    }
}
