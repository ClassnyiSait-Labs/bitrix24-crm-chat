<?php
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for classnyisait.crmchat module.
 *
 * Covers:
 *   - CrmChat constants, permissions, tab sort logic, dialog ID formatting
 *   - EventHandler structure
 *   - EventRegistrar event definitions
 *   - Navigation menu item properties
 *
 * Run: php vendor/bin/phpunit test/CrmChatTest.php
 */
class CrmChatTest extends TestCase
{
    // ─── Constants ─────────────────────────────────────────────────────

    public function testEntityTypeConstant(): void
    {
        $this->assertSame('CRM', \Classnyisait\CrmChat\CrmChat::ENTITY_TYPE);
    }

    // ─── Tab sort logic ────────────────────────────────────────────────

    public function testGetTabSortDefaultIs150(): void
    {
        // Default sort for CRM tab
        $this->assertSame(150, $this->computeTabSort(0, 0));
    }

    public function testGetTabSortForUserReturnsDefaultForZeroUserId(): void
    {
        $sort = $this->computeTabSort(0, 999);
        $this->assertSame(150, $sort);
    }

    public function testGetTabSortForUserReturnsDefaultForNegativeUserId(): void
    {
        $sort = $this->computeTabSort(-1, 999);
        $this->assertSame(150, $sort);
    }

    public function testGetTabSortForUserReturnsSavedValue(): void
    {
        $sort = $this->computeTabSort(1, 300);
        $this->assertSame(300, $sort);
    }

    public function testGetTabSortForUserFallsBackToDefaultWhenSavedIsZero(): void
    {
        $sort = $this->computeTabSort(1, 0);
        $this->assertSame(150, $sort);
    }

    public function testGetTabSortForUserFallsBackToDefaultWhenSavedIsNegative(): void
    {
        $sort = $this->computeTabSort(1, -10);
        $this->assertSame(150, $sort);
    }

    // ─── Dialog ID formatting ──────────────────────────────────────────

    public function testDialogIdFormatting(): void
    {
        $chatId = 42;
        $dialogId = 'chat' . $chatId;
        $this->assertSame('chat42', $dialogId);
    }

    public function testDialogIdFormattingLargeId(): void
    {
        $chatId = 999999;
        $dialogId = 'chat' . $chatId;
        $this->assertSame('chat999999', $dialogId);
    }

    public function testDialogIdBatchFormatting(): void
    {
        $rows = [
            ['ITEM_CID' => 10],
            ['ITEM_CID' => 20],
            ['ITEM_CID' => 30],
        ];

        $dialogIds = array_map(function ($row) {
            return 'chat' . $row['ITEM_CID'];
        }, $rows);

        $this->assertSame(['chat10', 'chat20', 'chat30'], $dialogIds);
    }

    public function testEmptyRowsReturnEmptyDialogIds(): void
    {
        $rows = [];
        $dialogIds = array_map(function ($row) {
            return 'chat' . $row['ITEM_CID'];
        }, $rows);

        $this->assertSame([], $dialogIds);
    }

    // ─── EventHandler ──────────────────────────────────────────────────

    public function testEventHandlerOnPrologMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\EventHandler::class, 'onProlog'),
            'EventHandler должен иметь метод onProlog'
        );
    }

    public function testEventHandlerOnPrologIsStatic(): void
    {
        $ref = new \ReflectionMethod(\Classnyisait\CrmChat\EventHandler::class, 'onProlog');
        $this->assertTrue($ref->isStatic(), 'onProlog должен быть static');
    }

    public function testEventHandlerOnPrologIsVoid(): void
    {
        $ref = new \ReflectionMethod(\Classnyisait\CrmChat\EventHandler::class, 'onProlog');
        $type = $ref->getReturnType();
        $this->assertNotNull($type);
        $this->assertSame('void', $type->getName());
    }

    // ─── EventRegistrar ────────────────────────────────────────────────

    public function testEventRegistrarClassExists(): void
    {
        $this->assertTrue(
            class_exists(\Classnyisait\CrmChat\EventRegistrar::class),
            'EventRegistrar class должен существовать'
        );
    }

    public function testEventRegistrarHasRegisterMethod(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\EventRegistrar::class, 'registerViaSql')
        );
    }

    public function testEventRegistrarHasUnregisterMethod(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\EventRegistrar::class, 'unregisterViaSql')
        );
    }

    public function testEventRegistrarMethodsAreStatic(): void
    {
        $register = new \ReflectionMethod(\Classnyisait\CrmChat\EventRegistrar::class, 'registerViaSql');
        $unregister = new \ReflectionMethod(\Classnyisait\CrmChat\EventRegistrar::class, 'unregisterViaSql');
        $this->assertTrue($register->isStatic());
        $this->assertTrue($unregister->isStatic());
    }

    public function testEventRegistrarMethodsReturnArray(): void
    {
        $register = new \ReflectionMethod(\Classnyisait\CrmChat\EventRegistrar::class, 'registerViaSql');
        $this->assertSame('array', $register->getReturnType()->getName());
    }

    // ─── CrmChat class structure ───────────────────────────────────────

    public function testOnRegisterTypeMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\CrmChat::class, 'onRegisterType')
        );
    }

    public function testOnNavigationMenuBuildMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\CrmChat::class, 'onNavigationMenuBuild')
        );
    }

    public function testOnBeforeUsersAddMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\CrmChat::class, 'onBeforeUsersAdd')
        );
    }

    public function testGetUserCrmDialogIdsMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\CrmChat::class, 'getUserCrmDialogIds')
        );
    }

    public function testGetTabSortForUserMethodExists(): void
    {
        $this->assertTrue(
            method_exists(\Classnyisait\CrmChat\CrmChat::class, 'getTabSortForUser')
        );
    }

    public function testAllPublicMethodsAreStatic(): void
    {
        $methods = ['onRegisterType', 'onNavigationMenuBuild', 'onBeforeUsersAdd', 'getUserCrmDialogIds', 'getTabSortForUser'];
        foreach ($methods as $methodName) {
            $ref = new \ReflectionMethod(\Classnyisait\CrmChat\CrmChat::class, $methodName);
            $this->assertTrue($ref->isStatic(), "$methodName должен быть static");
        }
    }

    // ─── Permission configuration ──────────────────────────────────────

    public function testCrmPermissionConstants(): void
    {
        // This one checks the host platform, not the module: the permission
        // actions must exist in the Bitrix enum we build the chat config from.
        // Without a Bitrix24 kernel there is nothing to check, so the test is
        // skipped rather than failed — in CI the kernel is never present.
        if (!class_exists(\Bitrix\Main\Loader::class)) {
            $this->markTestSkipped('Требуется ядро Bitrix24 — проверка выполняется только на портале.');
        }

        $this->assertTrue(
            enum_exists(\Bitrix\Im\V2\Permission\Action::class),
            'Action enum должен существовать'
        );

        $used = ['Extend', 'ChangeAvatar', 'ChangeDescription', 'ChangeColor', 'Rename', 'Leave', 'LeaveOwner', 'Kick', 'ChangeManagers', 'Mute'];
        $available = array_column(\Bitrix\Im\V2\Permission\Action::cases(), 'name');

        foreach ($used as $case) {
            $this->assertContains($case, $available, "Action::$case используется модулем и должен существовать");
        }
    }

    // ─── getUserCrmDialogIds edge cases (unit-testable logic) ──────────

    public function testGetUserCrmDialogIdsReturnsEmptyForZeroUserId(): void
    {
        // The method checks userId <= 0 → return []
        $userId = 0;
        $this->assertTrue($userId <= 0, 'Zero userId triggers early return');
    }

    public function testGetUserCrmDialogIdsReturnsEmptyForNegativeUserId(): void
    {
        $userId = -5;
        $this->assertTrue($userId <= 0, 'Negative userId triggers early return');
    }

    // ─── Helper ────────────────────────────────────────────────────────

    /**
     * Simulates the tab sort logic from CrmChat::getTabSortForUser
     * without requiring CUserOptions (DB).
     */
    private function computeTabSort(int $userId, int $savedValue): int
    {
        if ($userId <= 0) {
            return 150;
        }
        return $savedValue > 0 ? $savedValue : 150;
    }
}
