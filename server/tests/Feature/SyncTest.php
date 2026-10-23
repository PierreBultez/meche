<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

const NOTE_ID = '0192f1c2-1111-7000-8000-000000000001';
const OTHER_ID = '0192f1c2-2222-7000-8000-000000000002';

/** A change as the app sends it (docs/04), with sensible values. */
function change(array $overrides = []): array
{
    return array_merge([
        'id' => NOTE_ID,
        'base_rev' => 0,
        'title' => 'Courses',
        'content' => "- [x] Lait\n- [ ] Pain",
        'kind' => 'rich',
        'code_language' => null,
        'pinned' => false,
        'color' => 'corail',
        'ephemeral_mode' => 'delay',
        'ephemeral_delay_hours' => 168,
        'ephemeral_started_at' => 1_761_123_000_000,
        'destroy_at' => 1_761_727_800_000,
        'trashed_at' => null,
        'trash_reason' => null,
        'deleted' => false,
        'created_at' => 1_761_123_000_000,
        'updated_at' => 1_761_124_500_000,
    ], $overrides);
}

/** The note as the server sends it back: the change without base_rev, with its revision. */
function served(array $change, int $rev): array
{
    unset($change['base_rev']);

    return [...$change, 'rev' => $rev];
}

function sync(string $token, int $cursor = 0, array $changes = []): TestResponse
{
    freshRequest();

    return test()->withToken($token)->postJson('/api/sync', ['cursor' => $cursor, 'changes' => $changes]);
}

function counter(): int
{
    return (int) DB::table('sync_counters')->value('value');
}

it('inserts a new note and does not send it back to the device that wrote it', function () {
    $token = deviceToken(account());

    $response = sync($token, 0, [change()])->assertOk();

    expect($response->json())->toMatchArray([
        'applied' => [['id' => NOTE_ID, 'rev' => 1]],
        'conflicts' => [],
        'changes' => [],
        'cursor' => 1,
        'has_more' => false,
        'reset' => false,
    ])->and($response->json('server_time'))->toBeInt()
        ->and($response->json('sync_id'))->toBe(DB::table('sync_counters')->value('sync_id'));
    expect(DB::table('notes')->count())->toBe(1)->and(counter())->toBe(1);
});

it('sends the note to another device, with every field', function () {
    $user = account();
    sync(deviceToken($user, 'PC'), 0, [change()]);

    $response = sync(deviceToken($user, 'Téléphone'))->assertOk();

    expect($response->json('changes'))->toBe([served(change(), 1)])
        ->and($response->json('cursor'))->toBe(1);
});

it('updates a note sent with the latest revision', function () {
    $token = deviceToken(account());
    sync($token, 0, [change()]);

    $response = sync($token, 1, [change(['base_rev' => 1, 'title' => 'Courses Lidl', 'pinned' => true])]);

    expect($response->json('applied'))->toBe([['id' => NOTE_ID, 'rev' => 2]])
        ->and(DB::table('notes')->value('title'))->toBe('Courses Lidl')
        ->and((bool) DB::table('notes')->value('pinned'))->toBeTrue()
        ->and((int) DB::table('notes')->value('rev'))->toBe(2);
});

it('keeps its version and returns it when the note changed meanwhile', function () {
    $user = account();
    $desktop = deviceToken($user, 'PC');
    sync($desktop, 0, [change()]);
    sync($desktop, 1, [change(['base_rev' => 1, 'title' => 'Version du PC'])]);

    // The phone last saw revision 1.
    $response = sync(deviceToken($user, 'Téléphone'), 1, [change(['base_rev' => 1, 'title' => 'Version du téléphone'])]);

    expect($response->json('applied'))->toBe([])
        ->and($response->json('conflicts'))->toBe([
            ['id' => NOTE_ID, 'server' => served(change(['title' => 'Version du PC']), 2)],
        ])
        ->and(DB::table('notes')->value('title'))->toBe('Version du PC')
        ->and(counter())->toBe(2);
    // The conflicting note also comes in the changes (its revision is after the cursor).
    expect(array_column($response->json('changes'), 'title'))->toBe(['Version du PC']);
});

it('applies a change identical to the server version, without a new revision', function () {
    $user = account();
    $exploded = ['trashed_at' => 1_761_727_800_000, 'trash_reason' => 'self_destruct'];
    sync(deviceToken($user, 'PC'), 0, [change()]);
    // The server burnt the fuse (revision 2) …
    sync(deviceToken($user, 'PC'), 1, [change(['base_rev' => 1, ...$exploded, 'updated_at' => 1])]);

    // … and so did the phone, at another moment: only updated_at differs.
    $response = sync(deviceToken($user, 'Téléphone'), 1, [change(['base_rev' => 1, ...$exploded, 'updated_at' => 2])]);

    expect($response->json('applied'))->toBe([['id' => NOTE_ID, 'rev' => 2]])
        ->and($response->json('conflicts'))->toBe([])
        ->and($response->json('changes'))->toBe([])
        ->and(counter())->toBe(2);
});

it('compares every synced field but updated_at', function (string $field, mixed $value) {
    $user = account();
    sync(deviceToken($user, 'PC'), 0, [change()]);
    sync(deviceToken($user, 'PC'), 1, [change(['base_rev' => 1, 'updated_at' => 5])]);

    $response = sync(deviceToken($user, 'Téléphone'), 1, [change(['base_rev' => 1, $field => $value])]);

    expect($response->json('conflicts'))->toHaveCount(1);
})->with([
    ['title', 'Autre'], ['content', 'autre'], ['kind', 'code'], ['code_language', 'php'],
    ['pinned', true], ['color', 'bleu'], ['ephemeral_mode', null], ['ephemeral_delay_hours', 24],
    ['ephemeral_started_at', 1], ['destroy_at', 2], ['trashed_at', 3], ['trash_reason', 'manual'],
    ['deleted', true], ['created_at', 4],
]);

it('sends the changes after the cursor in pages, by count and by size', function () {
    config(['notes.pull_max_notes' => 2, 'notes.pull_max_bytes' => 25]);
    $user = account();
    $writer = deviceToken($user, 'PC');
    $ids = [];
    foreach (range(1, 5) as $i) {
        $ids[] = $id = sprintf('0192f1c2-0000-7000-8000-%012d', $i);
        sync($writer, 0, [change(['id' => $id, 'title' => "N{$i}", 'content' => str_repeat('x', $i === 4 ? 40 : 8)])]);
    }
    $reader = deviceToken($user, 'Téléphone');

    $first = sync($reader, 0)->json();
    expect(array_column($first['changes'], 'title'))->toBe(['N1', 'N2'])
        ->and($first['cursor'])->toBe(2)->and($first['has_more'])->toBeTrue();
    // N3 (10 bytes) fits, N4 (42 bytes) would go over 25 bytes: next page.
    $second = sync($reader, 2)->json();
    expect(array_column($second['changes'], 'title'))->toBe(['N3'])
        ->and($second['cursor'])->toBe(3)->and($second['has_more'])->toBeTrue();
    // A note larger than the limit still comes, alone.
    $third = sync($reader, 3)->json();
    expect(array_column($third['changes'], 'title'))->toBe(['N4'])
        ->and($third['has_more'])->toBeTrue();
    $last = sync($reader, 4)->json();
    expect(array_column($last['changes'], 'title'))->toBe(['N5'])
        ->and($last['cursor'])->toBe(5)->and($last['has_more'])->toBeFalse();
    expect(sync($reader, 5)->json())->toMatchArray(['changes' => [], 'cursor' => 5, 'has_more' => false]);
});

it('propagates a tombstone, without the title or the content', function () {
    $user = account();
    $desktop = deviceToken($user, 'PC');
    sync($desktop, 0, [change()]);

    sync($desktop, 1, [change(['base_rev' => 1, 'deleted' => true, 'title' => 'secret', 'content' => 'secret'])])
        ->assertJson(['applied' => [['id' => NOTE_ID, 'rev' => 2]]]);

    $note = sync(deviceToken($user, 'Téléphone'), 1)->json('changes.0');
    expect($note)->toMatchArray(['id' => NOTE_ID, 'deleted' => true, 'title' => '', 'content' => '', 'rev' => 2]);
});

it('keeps a tombstone when another device changed the note it no longer has', function () {
    $user = account();
    $desktop = deviceToken($user, 'PC');
    sync($desktop, 0, [change()]);
    sync($desktop, 1, [change(['base_rev' => 1, 'deleted' => true])]);

    $response = sync(deviceToken($user, 'Téléphone'), 1, [change(['base_rev' => 1, 'title' => 'Modifiée'])]);

    expect($response->json('conflicts.0.server'))->toMatchArray(['deleted' => true, 'title' => '', 'rev' => 2])
        ->and((bool) DB::table('notes')->value('deleted'))->toBeTrue();
});

it('does not store the tombstone of a note it never had', function () {
    $token = deviceToken(account());

    sync($token, 0, [change(['base_rev' => 4, 'deleted' => true])])
        ->assertJson(['applied' => [['id' => NOTE_ID, 'rev' => 0]], 'cursor' => 0]);

    expect(DB::table('notes')->count())->toBe(0)->and(counter())->toBe(0);
});

it('keeps each account apart', function () {
    $pierre = deviceToken(account());
    $papa = deviceToken(account('papa@example.com'));
    sync($pierre, 0, [change()]);

    expect(sync($papa)->json('changes'))->toBe([]);
    sync($papa, 0, [change(['title' => 'Pirate'])])->assertStatus(409)->assertJson(['error' => 'id_conflict']);
    expect(DB::table('notes')->value('title'))->toBe('Courses');
    // Each account counts its own revisions.
    sync($papa, 0, [change(['id' => OTHER_ID])])->assertJson(['applied' => [['id' => OTHER_ID, 'rev' => 1]]]);
});

it('stores the text exactly as sent: spaces, empty title, accents', function () {
    $user = account();
    $text = "  indentée\n\tavec tabulation  \n\nÉté 🎆 « citation »  ";
    sync(deviceToken($user, 'PC'), 0, [change(['title' => '', 'content' => $text, 'kind' => 'code', 'code_language' => 'php'])]);

    $note = sync(deviceToken($user, 'Téléphone'))->json('changes.0');

    expect($note['title'])->toBe('')->and($note['content'])->toBe($text);
});

it('limits the title in characters and the content in bytes', function () {
    $token = deviceToken(account());

    sync($token, 0, [change(['title' => str_repeat('é', 500), 'content' => str_repeat('a', 2 * 1024 * 1024)])])->assertOk();
    sync($token, 0, [change(['id' => OTHER_ID, 'title' => str_repeat('é', 501)])])
        ->assertStatus(422)->assertJson(['error' => 'invalid_change']);
    // 1,048,577 two-byte characters: under 2 M characters, but over 2 MB.
    sync($token, 0, [change(['id' => OTHER_ID, 'content' => str_repeat('é', 1_048_577)])])
        ->assertStatus(422)->assertJsonFragment(['message' => 'changes.0.content is larger than 2 MB']);
});

it('refuses malformed requests without writing anything', function (array $body) {
    $token = deviceToken(account());
    freshRequest();

    $this->withToken($token)->postJson('/api/sync', $body)->assertStatus(422)->assertJson(['error' => 'invalid_change']);

    expect(DB::table('notes')->count())->toBe(0);
})->with([
    'no cursor' => [['changes' => []]],
    'negative cursor' => [['cursor' => -1]],
    'cursor as text' => [['cursor' => '3']],
    'uppercase id' => [['cursor' => 0, 'changes' => [change(['id' => strtoupper(NOTE_ID)])]]],
    'unknown color' => [['cursor' => 0, 'changes' => [change(['color' => 'noir'])]]],
    'unknown kind' => [['cursor' => 0, 'changes' => [change(['kind' => 'video'])]]],
    'pinned as a number' => [['cursor' => 0, 'changes' => [change(['pinned' => 1])]]],
    'missing content' => [['cursor' => 0, 'changes' => [array_diff_key(change(), ['content' => 0])]]],
    'null title' => [['cursor' => 0, 'changes' => [change(['title' => null])]]],
    'negative date' => [['cursor' => 0, 'changes' => [change(['destroy_at' => -5])]]],
    'same note twice' => [['cursor' => 0, 'changes' => [change(), change(['title' => 'x'])]]],
    'valid then invalid' => [['cursor' => 0, 'changes' => [change(['id' => OTHER_ID]), change(['trash_reason' => 'oops'])]]],
]);

it('refuses more than 200 changes at once', function () {
    $token = deviceToken(account());
    $changes = array_map(fn (int $i) => change(['id' => sprintf('0192f1c2-0000-7000-8000-%012d', $i)]), range(1, 201));

    sync($token, 0, $changes)->assertStatus(422);
});

it('asks devices to start over when their cursor is ahead of the server', function () {
    $user = account();
    $token = deviceToken($user);
    sync($token, 0, [change()]);
    $oldSyncId = DB::table('sync_counters')->value('sync_id');

    // A device that synced with a later state of the database (restored from a backup).
    $response = sync($token, 9, [change(['id' => OTHER_ID])])->assertOk();

    expect($response->json())->toMatchArray(['reset' => true, 'cursor' => 0, 'applied' => [], 'changes' => []])
        ->and($response->json('sync_id'))->not->toBe($oldSyncId)
        ->and($response->json('sync_id'))->toBe(DB::table('sync_counters')->value('sync_id'))
        ->and(DB::table('notes')->count())->toBe(1);
    // Without changes too.
    expect(sync($token, 9)->json('reset'))->toBeTrue();
    // From cursor 0, everything is normal again.
    expect(sync($token, 0)->json())->toMatchArray(['reset' => false, 'cursor' => 1]);
});

it('measures its own duration in a Server-Timing header', function () {
    sync(deviceToken(account()))->assertOk()->assertHeader('Server-Timing');
});
