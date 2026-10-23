<?php

namespace App\Sync;

/**
 * The synced fields of a note (docs/03), with one PHP type each, whatever the database returns
 * (MariaDB and SQLite may give an integer as a string, a boolean as 0 / 1).
 */
final class NoteFields
{
    /** Compared to tell whether two versions are the same: every synced field but updated_at. */
    public const COMPARED = [
        'title', 'content', 'kind', 'code_language', 'pinned', 'color', 'ephemeral_mode',
        'ephemeral_delay_hours', 'ephemeral_started_at', 'destroy_at', 'trashed_at',
        'trash_reason', 'deleted', 'created_at',
    ];

    public const SYNCED = [...self::COMPARED, 'updated_at'];

    /** Columns read to send a note to a device. */
    public const SELECT = ['id', ...self::SYNCED, 'rev'];

    /** A note row of the database, typed, as it is sent to devices. */
    public static function fromRow(object $row): array
    {
        return [
            'id' => (string) $row->id,
            'title' => (string) $row->title,
            'content' => (string) $row->content,
            'kind' => (string) $row->kind,
            'code_language' => $row->code_language === null ? null : (string) $row->code_language,
            'pinned' => (bool) $row->pinned,
            'color' => (string) $row->color,
            'ephemeral_mode' => $row->ephemeral_mode === null ? null : (string) $row->ephemeral_mode,
            'ephemeral_delay_hours' => self::intOrNull($row->ephemeral_delay_hours),
            'ephemeral_started_at' => self::intOrNull($row->ephemeral_started_at),
            'destroy_at' => self::intOrNull($row->destroy_at),
            'trashed_at' => self::intOrNull($row->trashed_at),
            'trash_reason' => $row->trash_reason === null ? null : (string) $row->trash_reason,
            'deleted' => (bool) $row->deleted,
            'created_at' => (int) $row->created_at,
            'updated_at' => (int) $row->updated_at,
            'rev' => (int) $row->rev,
        ];
    }

    /** The database row to write for a change (validated by ChangeValidator) at revision `$rev`. */
    public static function toRow(array $change, int $userId, int $rev): array
    {
        $row = ['id' => $change['id'], 'user_id' => $userId, 'rev' => $rev];
        foreach (self::SYNCED as $field) {
            $row[$field] = $change[$field];
        }

        return $row;
    }

    /** Whether two typed versions hold the same note (updated_at aside). */
    public static function same(array $a, array $b): bool
    {
        foreach (self::COMPARED as $field) {
            if ($a[$field] !== $b[$field]) {
                return false;
            }
        }

        return true;
    }

    private static function intOrNull(mixed $value): ?int
    {
        return $value === null ? null : (int) $value;
    }
}
