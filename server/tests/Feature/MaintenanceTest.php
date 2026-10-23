<?php

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Stores a note directly, as a sync would have, and returns its id. */
function storedNote(int $userId, array $fields = []): string
{
    static $count = 0;
    $id = sprintf('0192f1c2-0000-7000-8000-%012d', ++$count);
    $rev = (int) DB::table('sync_counters')->where('user_id', $userId)->value('value') + 1;
    DB::table('notes')->insert(array_merge([
        'id' => $id, 'user_id' => $userId, 'title' => 'Courses', 'content' => 'Lait',
        'color' => 'pomme', 'created_at' => 0, 'updated_at' => 0, 'rev' => $rev,
    ], $fields));
    DB::table('sync_counters')->where('user_id', $userId)->update(['value' => $rev]);

    return $id;
}

/** A note whose fuse was lit at `$startedAt` for `$hours` hours. */
function fused(int $userId, int $startedAt, int $hours, array $fields = []): string
{
    return storedNote($userId, array_merge([
        'ephemeral_mode' => 'delay', 'ephemeral_delay_hours' => $hours,
        'ephemeral_started_at' => $startedAt, 'destroy_at' => $startedAt + $hours * HOUR_MS,
    ], $fields));
}

function noteRow(string $id): object
{
    return DB::table('notes')->where('id', $id)->first();
}

function runAt(int $ms): void
{
    test()->travelTo(now()->setTimestamp(intdiv($ms, 1000))->setMicrosecond(($ms % 1000) * 1000));
    test()->artisan('notes:maintenance')->assertSuccessful();
}

it('explodes the burnt fuses at destroy_at exactly, dated from destroy_at', function () {
    $user = account();
    $start = 1_761_000_000_000;
    $due = fused($user->id, $start, 1);
    $later = fused($user->id, $start, 2);
    $unfused = storedNote($user->id);

    runAt($start + HOUR_MS - 1);
    expect(noteRow($due)->trashed_at)->toBeNull();

    runAt($start + HOUR_MS);
    $exploded = noteRow($due);
    expect((int) $exploded->trashed_at)->toBe($start + HOUR_MS)
        ->and($exploded->trash_reason)->toBe('self_destruct')
        ->and((int) $exploded->updated_at)->toBe($start + HOUR_MS)
        ->and((int) $exploded->rev)->toBe(4)
        ->and(noteRow($later)->trashed_at)->toBeNull()
        ->and(noteRow($unfused)->trashed_at)->toBeNull()
        ->and((int) DB::table('sync_counters')->value('value'))->toBe(4);

    // Days late, trashed_at is still the moment the fuse burnt out.
    runAt($start + 5 * DAY_MS);
    expect((int) noteRow($later)->trashed_at)->toBe($start + 2 * HOUR_MS)
        ->and((int) noteRow($later)->updated_at)->toBe($start + 5 * DAY_MS);
});

it('leaves notes already in the trash or deleted', function () {
    $user = account();
    $trashed = fused($user->id, 0, 1, ['trashed_at' => 10, 'trash_reason' => 'manual']);
    $tombstone = fused($user->id, 0, 1, ['deleted' => true, 'title' => '', 'content' => '']);

    runAt(2 * HOUR_MS);

    expect((int) noteRow($trashed)->trashed_at)->toBe(10)
        ->and(noteRow($trashed)->trash_reason)->toBe('manual')
        ->and((int) noteRow($tombstone)->rev)->toBe(2)
        ->and((int) DB::table('sync_counters')->value('value'))->toBe(2);
});

it('turns a note 7 days in the trash into a tombstone, the rest unchanged', function () {
    $user = account();
    $old = storedNote($user->id, ['trashed_at' => 1_000, 'trash_reason' => 'manual', 'pinned' => true]);
    $recent = storedNote($user->id, ['trashed_at' => 1_001, 'trash_reason' => 'manual']);
    $before = (array) noteRow($old);

    runAt(1_000 + 7 * DAY_MS - 1);
    expect((bool) noteRow($old)->deleted)->toBeFalse();

    runAt(1_000 + 7 * DAY_MS);
    $after = (array) noteRow($old);
    expect((bool) $after['deleted'])->toBeTrue()
        ->and($after['title'])->toBe('')
        ->and($after['content'])->toBe('')
        ->and((int) $after['updated_at'])->toBe(1_000 + 7 * DAY_MS)
        ->and((int) $after['rev'])->toBe(3)
        ->and(array_diff_key($after, array_flip(['deleted', 'title', 'content', 'updated_at', 'rev'])))
        ->toEqual(array_diff_key($before, array_flip(['deleted', 'title', 'content', 'updated_at', 'rev'])))
        ->and((bool) noteRow($recent)->deleted)->toBeFalse();

    // A tombstone is not purged again.
    runAt(30 * DAY_MS);
    expect((int) noteRow($old)->rev)->toBe(3);
});

it('explodes then purges a fuse that burnt out long ago, in one run', function () {
    $user = account();
    $id = fused($user->id, 0, 1);

    runAt(30 * DAY_MS);

    $note = noteRow($id);
    expect((bool) $note->deleted)->toBeTrue()
        ->and((int) $note->trashed_at)->toBe(HOUR_MS)
        ->and($note->trash_reason)->toBe('self_destruct')
        ->and((int) $note->rev)->toBe(3);
});

it('gives the devices the same values as their own fuse maintenance', function () {
    $user = account();
    $start = 1_761_000_000_000;
    $token = deviceToken($user);
    $change = [
        'id' => '0192f1c2-1111-7000-8000-000000000001', 'base_rev' => 0, 'title' => 'Courses',
        'content' => 'Lait', 'kind' => 'rich', 'code_language' => null, 'pinned' => false,
        'color' => 'pomme', 'ephemeral_mode' => 'delay', 'ephemeral_delay_hours' => 1,
        'ephemeral_started_at' => $start, 'destroy_at' => $start + HOUR_MS, 'trashed_at' => null,
        'trash_reason' => null, 'deleted' => false, 'created_at' => $start, 'updated_at' => $start,
    ];
    test()->withToken($token)->postJson('/api/sync', ['cursor' => 0, 'changes' => [$change]])->assertOk();

    runAt($start + HOUR_MS + 30_000);

    // The device exploded the note too (ephemeral::explode_due), a few seconds later.
    freshRequest();
    $exploded = [...$change, 'base_rev' => 1, 'trashed_at' => $start + HOUR_MS,
        'trash_reason' => 'self_destruct', 'updated_at' => $start + HOUR_MS + 45_000];
    $response = test()->withToken($token)->postJson('/api/sync', ['cursor' => 1, 'changes' => [$exploded]]);
    expect($response->json('applied'))->toBe([['id' => $change['id'], 'rev' => 2]])
        ->and($response->json('conflicts'))->toBe([]);

    // Same for the purge 7 days later (db::notes::remove_or_tombstone).
    runAt($start + HOUR_MS + 7 * DAY_MS);
    freshRequest();
    $tombstone = [...$exploded, 'base_rev' => 2, 'deleted' => true, 'title' => '', 'content' => '',
        'updated_at' => $start + 8 * DAY_MS];
    $response = test()->withToken($token)->postJson('/api/sync', ['cursor' => 2, 'changes' => [$tombstone]]);
    expect($response->json('applied'))->toBe([['id' => $change['id'], 'rev' => 3]])
        ->and($response->json('conflicts'))->toBe([]);
});

it('counts the revisions of each account apart', function () {
    $pierre = account();
    $papa = account('papa@example.com');
    fused($pierre->id, 0, 1);
    $papaNote = fused($papa->id, 0, 1);

    runAt(2 * HOUR_MS);

    expect(DB::table('sync_counters')->orderBy('user_id')->pluck('value')->map(fn ($v) => (int) $v)->all())->toBe([2, 2])
        ->and((int) noteRow($papaNote)->rev)->toBe(2);
});

it('disconnects devices unused for 180 days and forgets old invitations', function () {
    $user = account();
    $this->travelTo(now()->setTimestamp(1_700_000_000));
    $active = $user->createToken('Actif')->accessToken;
    $idle = $user->createToken('Oublié')->accessToken;
    $never = $user->createToken('Jamais utilisé')->accessToken;
    DB::table('invitations')->insert([
        'user_id' => $user->id, 'code_hash' => str_repeat('a', 64), 'hint' => 'ABCD',
        'created_at' => 0, 'expires_at' => 1, 'used_at' => null,
    ]);

    $this->travel(179)->days();
    DB::table('personal_access_tokens')->where('id', $active->id)->update(['last_used_at' => now()]);
    DB::table('personal_access_tokens')->where('id', $idle->id)->update(['last_used_at' => now()->subDays(179)]);
    $this->travel(2)->days();
    $this->artisan('notes:maintenance')->assertSuccessful();

    expect($user->tokens()->pluck('name')->all())->toBe(['Actif'])
        ->and(DB::table('invitations')->count())->toBe(0);
});

it('runs every ten minutes, never twice at the same time', function () {
    $event = collect(app(Schedule::class)->events())
        ->first(fn ($event) => str_contains($event->command, 'notes:maintenance'));

    expect($event->expression)->toBe('*/10 * * * *')
        ->and($event->withoutOverlapping)->toBeTrue();
});
