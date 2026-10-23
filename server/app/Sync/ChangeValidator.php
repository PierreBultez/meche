<?php

namespace App\Sync;

/**
 * Checks a sync request field by field. Written by hand rather than with Laravel's validator,
 * whose `changes.*.title` rules are slow on 200 notes (docs/04, performance), and because the
 * content is limited in bytes, while Laravel's `max` counts characters.
 */
final class ChangeValidator
{
    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';

    private const KINDS = ['rich', 'code'];

    private const COLORS = ['violet', 'rose', 'corail', 'orange', 'citron', 'pomme', 'turquoise', 'bleu'];

    private const EPHEMERAL_MODES = ['delay', 'on_complete'];

    private const TRASH_REASONS = ['manual', 'self_destruct'];

    private const MAX_UNSIGNED_INT = 4_294_967_295;

    /**
     * @return array{cursor: int, sync_id: ?string, changes: list<array>} the request, typed
     *
     * @throws InvalidChange
     */
    public static function validate(mixed $body): array
    {
        if (! is_array($body)) {
            throw new InvalidChange('the body must be a JSON object');
        }
        $cursor = self::unsigned($body['cursor'] ?? null, 'cursor');
        $syncId = $body['sync_id'] ?? null;
        if ($syncId !== null && (! is_string($syncId) || strlen($syncId) > 64)) {
            throw new InvalidChange('sync_id must be a string');
        }
        $changes = $body['changes'] ?? [];
        if (! is_array($changes) || ! array_is_list($changes)) {
            throw new InvalidChange('changes must be a list');
        }
        if (count($changes) > config('notes.push_max_notes')) {
            throw new InvalidChange('too many changes in one request');
        }

        $typed = [];
        $bytes = 0;
        foreach ($changes as $index => $change) {
            $note = self::change($change, "changes.{$index}");
            if (isset($typed[$note['id']])) {
                throw new InvalidChange("changes.{$index}.id appears twice");
            }
            $typed[$note['id']] = $note;
            $bytes += strlen($note['title']) + strlen($note['content']);
        }
        // The app sends about 4 MB at most (docs/04); a single note may be up to 2 MB.
        if (count($typed) > 1 && $bytes > config('notes.push_max_bytes')) {
            throw new InvalidChange('too many bytes in one request');
        }

        return ['cursor' => $cursor, 'sync_id' => $syncId, 'changes' => array_values($typed)];
    }

    private static function change(mixed $change, string $path): array
    {
        if (! is_array($change)) {
            throw new InvalidChange("{$path} must be an object");
        }
        $id = $change['id'] ?? null;
        if (! is_string($id) || preg_match(self::UUID, $id) !== 1) {
            throw new InvalidChange("{$path}.id must be a lowercase UUID");
        }
        $note = [
            'id' => $id,
            'base_rev' => self::unsigned($change['base_rev'] ?? null, "{$path}.base_rev"),
            'title' => self::string($change, 'title', $path),
            'content' => self::string($change, 'content', $path),
            'kind' => self::oneOf($change, 'kind', self::KINDS, $path),
            'code_language' => self::nullableString($change, 'code_language', $path),
            'pinned' => self::bool($change, 'pinned', $path),
            'color' => self::oneOf($change, 'color', self::COLORS, $path),
            'ephemeral_mode' => self::nullableOneOf($change, 'ephemeral_mode', self::EPHEMERAL_MODES, $path),
            'ephemeral_delay_hours' => self::nullableUnsigned($change, 'ephemeral_delay_hours', $path, self::MAX_UNSIGNED_INT),
            'ephemeral_started_at' => self::nullableUnsigned($change, 'ephemeral_started_at', $path),
            'destroy_at' => self::nullableUnsigned($change, 'destroy_at', $path),
            'trashed_at' => self::nullableUnsigned($change, 'trashed_at', $path),
            'trash_reason' => self::nullableOneOf($change, 'trash_reason', self::TRASH_REASONS, $path),
            'deleted' => self::bool($change, 'deleted', $path),
            'created_at' => self::unsigned($change['created_at'] ?? null, "{$path}.created_at"),
            'updated_at' => self::unsigned($change['updated_at'] ?? null, "{$path}.updated_at"),
        ];
        if (mb_strlen($note['title']) > config('notes.title_max_chars')) {
            throw new InvalidChange("{$path}.title is too long");
        }
        if (strlen($note['content']) > config('notes.content_max_bytes')) {
            throw new InvalidChange("{$path}.content is larger than 2 MB");
        }
        if ($note['code_language'] !== null
            && mb_strlen($note['code_language']) > config('notes.code_language_max_chars')) {
            throw new InvalidChange("{$path}.code_language is too long");
        }
        // A tombstone keeps nothing of the note's text (docs/04).
        if ($note['deleted']) {
            $note['title'] = '';
            $note['content'] = '';
        }

        return $note;
    }

    private static function unsigned(mixed $value, string $path, int $max = PHP_INT_MAX): int
    {
        if (! is_int($value) || $value < 0 || $value > $max) {
            throw new InvalidChange("{$path} must be a positive integer");
        }

        return $value;
    }

    private static function nullableUnsigned(array $change, string $field, string $path, int $max = PHP_INT_MAX): ?int
    {
        $value = $change[$field] ?? null;

        return $value === null ? null : self::unsigned($value, "{$path}.{$field}", $max);
    }

    private static function string(array $change, string $field, string $path): string
    {
        $value = $change[$field] ?? null;
        if (! is_string($value)) {
            throw new InvalidChange("{$path}.{$field} must be a string");
        }

        return $value;
    }

    private static function nullableString(array $change, string $field, string $path): ?string
    {
        return ($change[$field] ?? null) === null ? null : self::string($change, $field, $path);
    }

    private static function bool(array $change, string $field, string $path): bool
    {
        $value = $change[$field] ?? null;
        if (! is_bool($value)) {
            throw new InvalidChange("{$path}.{$field} must be true or false");
        }

        return $value;
    }

    private static function oneOf(array $change, string $field, array $allowed, string $path): string
    {
        $value = $change[$field] ?? null;
        if (! in_array($value, $allowed, true)) {
            throw new InvalidChange("{$path}.{$field} is not one of ".implode(', ', $allowed));
        }

        return $value;
    }

    private static function nullableOneOf(array $change, string $field, array $allowed, string $path): ?string
    {
        return ($change[$field] ?? null) === null ? null : self::oneOf($change, $field, $allowed, $path);
    }
}
