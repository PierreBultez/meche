//! Commands callable from the frontend with `invoke("command_name", { …arguments })`.
//! One file per area; each command stays thin and delegates the work to `db`.

pub mod import;
pub mod notes;
pub mod settings;
pub mod sync;
