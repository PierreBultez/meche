//! Current time, in milliseconds since the Unix epoch (UTC): the unit used everywhere (docs/03).

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        // A clock set before 1970 is the only failure case: fall back to 0 rather than crash.
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
