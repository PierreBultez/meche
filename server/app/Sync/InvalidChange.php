<?php

namespace App\Sync;

use RuntimeException;

/** A sync request the server cannot accept; the message names the faulty field. */
class InvalidChange extends RuntimeException {}
