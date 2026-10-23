<?php

// Rules of Mèche shared with the client (app/src-tauri): keep both sides identical.
return [
    // docs/06: a note stays 7 days in the trash (TRASH_RETENTION_DAYS in ephemeral/mod.rs).
    'trash_retention_days' => 7,

    // docs/03, "Limites": the content is limited in bytes, the title in characters.
    'title_max_chars' => 500,
    'content_max_bytes' => 2 * 1024 * 1024,
    'code_language_max_chars' => 50,

    // docs/04: changes sent at most 200 at a time; changes received at most 500 at a time and
    // about 4 MB (at least one note, whatever its size).
    'push_max_notes' => 200,
    'push_max_bytes' => 8 * 1024 * 1024,
    'pull_max_notes' => 500,
    'pull_max_bytes' => 4 * 1024 * 1024,

    // A device token unused for this long is deleted by notes:maintenance.
    'token_inactivity_days' => 180,

    // Accounts are created with an invitation code given by an existing account.
    'invitation_days' => 7,
    'max_pending_invitations' => 5,
    'password_min_chars' => 12,
];
