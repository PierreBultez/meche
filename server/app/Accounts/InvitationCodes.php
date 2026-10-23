<?php

namespace App\Accounts;

/**
 * Invitation codes such as `7KQ2-M9XD-4TPH`: 12 characters of Crockford's base 32 (no I, L, O, U,
 * which are easily mixed up), 60 random bits. Typed codes are read generously: lowercase,
 * spaces and dashes are accepted, O is read as 0 and I or L as 1.
 */
class InvitationCodes
{
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

    private const LENGTH = 12;

    /** A new code, without dashes (format() adds them). */
    public static function generate(): string
    {
        $code = '';
        for ($i = 0; $i < self::LENGTH; $i++) {
            $code .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
        }

        return $code;
    }

    /** The code as typed, in its canonical form (or null when it cannot be a code). */
    public static function normalize(string $typed): ?string
    {
        $code = strtoupper(preg_replace('/[\s-]+/', '', $typed) ?? '');
        $code = strtr($code, ['O' => '0', 'I' => '1', 'L' => '1']);
        if (strlen($code) !== self::LENGTH || strspn($code, self::ALPHABET) !== self::LENGTH) {
            return null;
        }

        return $code;
    }

    public static function format(string $code): string
    {
        return implode('-', str_split($code, 4));
    }

    public static function hash(string $code): string
    {
        return hash('sha256', $code);
    }
}
