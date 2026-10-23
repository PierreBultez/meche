<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The notes, as the devices send them (docs/03). Same column names as the client's
        // SQLite; dates in milliseconds, given by the client (not Laravel's timestamps).
        Schema::create('notes', function (Blueprint $table) {
            // A note is identified within its account: the same id may exist in two accounts
            // (a device that switched account sends its notes to the new one, docs/04).
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->uuid('id');
            $table->primary(['user_id', 'id']);
            $table->string('title', 500)->default('');
            $table->longText('content');
            $table->enum('kind', ['rich', 'code'])->default('rich');
            $table->string('code_language', 50)->nullable();
            $table->boolean('pinned')->default(false);
            $table->enum('color', ['violet', 'rose', 'corail', 'orange', 'citron', 'pomme', 'turquoise', 'bleu'])
                ->default('violet');
            $table->enum('ephemeral_mode', ['delay', 'on_complete'])->nullable();
            $table->unsignedInteger('ephemeral_delay_hours')->nullable();
            $table->unsignedBigInteger('ephemeral_started_at')->nullable();
            $table->unsignedBigInteger('destroy_at')->nullable();
            $table->unsignedBigInteger('trashed_at')->nullable();
            $table->enum('trash_reason', ['manual', 'self_destruct'])->nullable();
            $table->boolean('deleted')->default(false);
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('updated_at');
            // Revision of the last write, unique per account: the pull reads `rev > cursor`
            // along this index.
            $table->unsignedBigInteger('rev');
            $table->unique(['user_id', 'rev']);
            // notes:maintenance: fuses that burnt out, notes to purge from the trash.
            $table->index('destroy_at');
            $table->index('trashed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notes');
    }
};
