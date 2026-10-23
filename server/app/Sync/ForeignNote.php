<?php

namespace App\Sync;

use RuntimeException;

/** A change names a note id that belongs to another account (never happens with UUID v7). */
class ForeignNote extends RuntimeException {}
