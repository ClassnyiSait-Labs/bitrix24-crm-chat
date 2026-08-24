<?php

use Bitrix\Main\Loader;
use Bitrix\Main\Page\Asset;
use Bitrix\Main\Web\Json;

$asset = Asset::getInstance();
$moduleId = 'classnyisait.crmchat';

// Publish JS under /bitrix/js (allowed). /bitrix/modules/ is often 403.
$publicJsDir = '/bitrix/js/classnyisait.crmchat';
$docRoot = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/\\');
$srcJsDir = __DIR__ . '/install/js';
if ($docRoot !== '' && is_dir($srcJsDir) && function_exists('CopyDirFiles')) {
    $dstJsDir = $docRoot . $publicJsDir;
    $needCopy = !is_dir($dstJsDir);
    if (!$needCopy) {
        foreach (scandir($srcJsDir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $srcFile = $srcJsDir . '/' . $name;
            $dstFile = $dstJsDir . '/' . $name;
            if (is_file($srcFile) && (!is_file($dstFile) || filemtime($srcFile) > filemtime($dstFile))) {
                $needCopy = true;
                break;
            }
        }
    }
    if ($needCopy) {
        CopyDirFiles($srcJsDir, $dstJsDir, true, true);
    }
}

Loader::registerAutoLoadClasses($moduleId, [
    'Classnyisait\CrmChat\CrmChat' => 'lib/CrmChat.php',
    'Classnyisait\CrmChat\EventRegistrar' => 'lib/EventRegistrar.php',
    'Classnyisait\CrmChat\EventHandler' => 'lib/EventHandler.php',
]);

$crmDialogIds = [];
$userId = (int)\Bitrix\Main\Engine\CurrentUser::get()->getId();
if ($userId > 0) {
    $crmDialogIds = \Classnyisait\CrmChat\CrmChat::getUserCrmDialogIds($userId);
}
$asset->addString(
    '<script>window.classnyisaitCrmDialogIds = ' . Json::encode($crmDialogIds) . ';</script>'
);


// v26-совместимость: один общий рантайм-патч на crmDeal/notifyChat/customCat_*
// Подменяет NavigationManager.open, LayoutManager.isValidLayout/isChatLayout
// и MessengerApplication.initComponent для регистрации кастомных layout'ов.
// fix_navigation.js (старый) и crm_chat_filter.js отключены — несовместимы
// с module-level LayoutComponentMap в messenger.bundle.js v26 (см. memory).
$compatScript = $publicJsDir . '/v26_compat.js';
$compatFile = $docRoot . $compatScript;
$asset->addString(
    '<script src="' . $compatScript . (is_file($compatFile) ? '?v=' . filemtime($compatFile) : '') . '"></script>'
);
//$asset->addJs($publicJsDir . '/fix_navigation.js');
//$asset->addJs($publicJsDir . '/crm_chat_filter.js');
