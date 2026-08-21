<?php

/**
 * PHPUnit bootstrap.
 *
 * The module classes load without a Bitrix kernel: they extend nothing, and the
 * Bitrix types in their method signatures are resolved lazily by PHP — only when
 * such a method is actually called. The unit tests assert constants, structure
 * and pure logic, so no stubs are required here.
 *
 * Anything that talks to the messenger, the database or the event system needs a
 * running Bitrix24 and is covered by manual testing on a portal, not by these tests.
 */

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';
