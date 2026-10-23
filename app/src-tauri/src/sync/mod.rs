//! Synchronisation with the Mèche server (docs/04).
//!
//! - `protocol`: the JSON exchanged with the server;
//! - `config`: server, token and cursor, in the `settings` table;
//! - `apply`: the SQLite side (what to send, applying an answer), without network;
//! - `api`: the HTTP client;
//! - `schedule`: when the next sync runs;
//! - `engine`: the task that owns the sync, and its handle for the commands.

pub mod api;
pub mod apply;
pub mod config;
pub mod engine;
pub mod protocol;
pub mod schedule;
