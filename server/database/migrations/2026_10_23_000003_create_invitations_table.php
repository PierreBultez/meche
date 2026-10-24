<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Invitation codes: any account can create some, each one creates one account.
        // Only a SHA-256 of the code is stored, like the Sanctum tokens. Dates in milliseconds.
        Schema::create('invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->char('code_hash', 64)->unique();
            // The last 4 characters, to tell the codes apart in the list.
            $table->char('hint', 4);
            $table->unsignedBigInteger('created_at');
            $table->unsignedBigInteger('expires_at');
            $table->foreignId('used_by')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('used_at')->nullable();
            $table->index(['user_id', 'used_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invitations');
    }
};
