<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One row per account (docs/03): the last revision given to one of its notes, and the
        // identity of its sync history. `sync_id` changes when this history can no longer be
        // trusted (database recreated or restored from a backup): devices then send all their
        // notes again (docs/04, "Identité du serveur").
        Schema::create('sync_counters', function (Blueprint $table) {
            $table->foreignId('user_id')->primary()->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('value')->default(0);
            $table->uuid('sync_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('sync_counters');
    }
};
