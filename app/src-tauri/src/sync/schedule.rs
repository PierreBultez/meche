//! When the next sync runs (docs/04, "Déclenchement"). Pure logic on instants, without timers,
//! so it is tested without waiting: the engine asks `next()` and sleeps until then.

use std::time::{Duration, Instant};

/// Quiet time after the last local change before syncing.
pub const DEBOUNCE: Duration = Duration::from_secs(2);
/// A sync every minute while the app runs.
pub const PERIOD: Duration = Duration::from_secs(60);
/// Coming back to the window syncs at once, but not more often than this.
pub const FOCUS_SPACING: Duration = Duration::from_secs(5);

/// Delay before the next try after `failures` failed syncs in a row: 5 s, 15 s, then every 60 s.
pub fn backoff(failures: u32) -> Duration {
    match failures {
        0 | 1 => Duration::from_secs(5),
        2 => Duration::from_secs(15),
        _ => Duration::from_secs(60),
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Schedule {
    /// Syncing makes sense: an account is connected.
    active: bool,
    /// After local changes (2 s after the last one), or at once (startup, focus, login).
    soon: Option<Instant>,
    /// The periodic sync, a minute after the last successful one.
    periodic: Option<Instant>,
    /// The next try after a failure.
    retry: Option<Instant>,
    failures: u32,
    last_attempt: Option<Instant>,
}

impl Schedule {
    /// An account is connected: sync at once.
    pub fn start(&mut self, now: Instant) {
        *self = Schedule {
            active: true,
            soon: Some(now),
            ..Schedule::default()
        };
    }

    /// Logged out: no more syncs.
    pub fn stop(&mut self) {
        *self = Schedule::default();
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// A note changed here. While the server is unreachable, the retries go on at their own
    /// pace: typing does not hammer a server that does not answer.
    pub fn local_change(&mut self, now: Instant) {
        if self.active && self.failures == 0 {
            self.soon = Some(now + DEBOUNCE);
        }
    }

    /// The window came back to the front: sync now (the network may be back too).
    pub fn focus(&mut self, now: Instant) {
        if !self.active {
            return;
        }
        let at = match self.last_attempt {
            Some(last) => (last + FOCUS_SPACING).max(now),
            None => now,
        };
        self.soon = Some(self.soon.map_or(at, |soon| soon.min(at)));
    }

    /// A sync starts now.
    pub fn attempt(&mut self, now: Instant) {
        self.last_attempt = Some(now);
        self.soon = None;
    }

    pub fn succeeded(&mut self, now: Instant) {
        self.failures = 0;
        self.retry = None;
        self.periodic = Some(now + PERIOD);
    }

    /// The sync failed. `wait`: the delay the server asked for (429), if any. Returns the
    /// delay before the next try.
    pub fn failed(&mut self, now: Instant, wait: Option<Duration>) -> Duration {
        self.failures += 1;
        let delay = wait.unwrap_or_else(|| backoff(self.failures));
        self.retry = Some(now + delay);
        self.periodic = None;
        delay
    }

    /// When the next sync must run, or `None` when there is nothing planned.
    pub fn next(&self) -> Option<Instant> {
        if !self.active {
            return None;
        }
        [self.soon, self.periodic, self.retry]
            .into_iter()
            .flatten()
            .min()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn secs(n: u64) -> Duration {
        Duration::from_secs(n)
    }

    #[test]
    fn nothing_runs_without_an_account() {
        let now = Instant::now();
        let mut schedule = Schedule::default();
        schedule.local_change(now);
        schedule.focus(now);
        assert_eq!(schedule.next(), None);
    }

    #[test]
    fn syncs_at_once_then_every_minute() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        assert_eq!(schedule.next(), Some(t0));
        schedule.attempt(t0);
        schedule.succeeded(t0);
        assert_eq!(schedule.next(), Some(t0 + PERIOD));
    }

    #[test]
    fn waits_two_seconds_after_the_last_local_change() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        schedule.attempt(t0);
        schedule.succeeded(t0);
        schedule.local_change(t0 + secs(10));
        schedule.local_change(t0 + secs(11));
        assert_eq!(schedule.next(), Some(t0 + secs(13)));
    }

    #[test]
    fn retries_after_5_15_then_60_seconds_whatever_is_typed() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        schedule.attempt(t0);
        assert_eq!(schedule.failed(t0, None), secs(5));
        schedule.local_change(t0 + secs(1));
        assert_eq!(schedule.next(), Some(t0 + secs(5)));
        schedule.attempt(t0 + secs(5));
        assert_eq!(schedule.failed(t0 + secs(5), None), secs(15));
        schedule.attempt(t0 + secs(20));
        assert_eq!(schedule.failed(t0 + secs(20), None), secs(60));
        schedule.attempt(t0 + secs(80));
        assert_eq!(schedule.failed(t0 + secs(80), None), secs(60));
        // Back online: the delays start again from the beginning.
        schedule.attempt(t0 + secs(140));
        schedule.succeeded(t0 + secs(140));
        assert_eq!(schedule.failed(t0 + secs(200), None), secs(5));
    }

    #[test]
    fn waits_as_long_as_the_server_asks() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        schedule.attempt(t0);
        assert_eq!(schedule.failed(t0, Some(secs(42))), secs(42));
        assert_eq!(schedule.next(), Some(t0 + secs(42)));
    }

    #[test]
    fn coming_back_to_the_window_syncs_now_but_not_too_often() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        schedule.attempt(t0);
        schedule.failed(t0, None);
        // Offline: coming back to the window tries before the planned retry…
        schedule.focus(t0 + secs(1));
        assert_eq!(schedule.next(), Some(t0 + FOCUS_SPACING));
        // … and right away when the last attempt is old enough.
        schedule.attempt(t0 + secs(5));
        schedule.succeeded(t0 + secs(5));
        schedule.focus(t0 + secs(30));
        assert_eq!(schedule.next(), Some(t0 + secs(30)));
    }

    #[test]
    fn stopping_forgets_everything() {
        let t0 = Instant::now();
        let mut schedule = Schedule::default();
        schedule.start(t0);
        schedule.failed(t0, None);
        schedule.stop();
        assert_eq!(schedule, Schedule::default());
        assert!(!schedule.is_active());
    }
}
