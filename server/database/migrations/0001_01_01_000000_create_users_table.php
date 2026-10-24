<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // No password reset by e-mail and no sessions: the API only knows tokens (docs/04).
        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $email = $table->string('email')->unique();
            // Compared byte for byte on MariaDB (addresses are stored in lowercase): with the
            // default collation, « piérre@… » would log into « pierre@… » and get round the
            // limit of tries per address.
            if (DB::connection()->getDriverName() !== 'sqlite') {
                $email->collation('utf8mb4_bin');
            }
            $table->string('password');
            // The account whose invitation code created this one (null for the first account,
            // created with `php artisan notes:create-user`).
            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
