<?php

it('answers without a token, with the server time in milliseconds', function () {
    $this->travelTo(now()->setTimestamp(1_761_124_501)->setMicrosecond(234_000));

    $this->getJson('/api/health')
        ->assertOk()
        ->assertExactJson(['ok' => true, 'api' => 1, 'server_time' => 1_761_124_501_234])
        ->assertHeader('Server-Timing');
});

it('has no web pages: the root of the domain stays free', function () {
    $this->get('/')->assertNotFound();
});

it('does not answer browsers from other sites (CORS is closed)', function () {
    $this->getJson('/api/health', ['Origin' => 'https://example.com'])
        ->assertOk()
        ->assertHeaderMissing('Access-Control-Allow-Origin');
});
