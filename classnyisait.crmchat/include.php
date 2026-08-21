<?php

use Bitrix\Main\Loader;
use Bitrix\Main\Page\Asset;
use Bitrix\Main\Application;
use Bitrix\Main\Web\Json;

$asset = Asset::getInstance();
$moduleId = 'classnyisait.crmchat';
// Определяем веб-путь к модулю, чтобы он работал и для /bitrix/modules, и для /local/modules
$webModuleDir = (is_dir($_SERVER['DOCUMENT_ROOT'] . '/local/modules/' . $moduleId))
    ? '/local/modules/' . $moduleId
    : '/bitrix/modules/' . $moduleId;

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
$compatScript = $webModuleDir . '/install/js/v26_compat.js';
$compatFile = $_SERVER['DOCUMENT_ROOT'] . $compatScript;
$asset->addString(
    '<script src="' . $compatScript . '?v=' . filemtime($compatFile) . '"></script>'
);
//$asset->addJs($webModuleDir . '/install/js/fix_navigation.js');
//$asset->addJs($webModuleDir . '/install/js/crm_chat_filter.js');

?>
