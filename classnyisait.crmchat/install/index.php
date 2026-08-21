<?php
IncludeModuleLangFile(__FILE__);
use Bitrix\Main\ModuleManager;
use Bitrix\Main\EventManager;

class classnyisait_crmchat extends CModule
{
    var $MODULE_ID = "classnyisait.crmchat";
    var $MODULE_VERSION;
    var $MODULE_VERSION_DATE;
    var $MODULE_NAME;
    var $MODULE_DESCRIPTION;

    public function __construct()
    {
        $arModuleVersion = [];
        include(__DIR__ . "/version.php");

        $this->MODULE_VERSION      = $arModuleVersion["VERSION"];
        $this->MODULE_VERSION_DATE = $arModuleVersion["VERSION_DATE"];
        $this->MODULE_NAME         = "CRM чаты";
        $this->MODULE_DESCRIPTION  = "Вкладка CRM чатов в мессенджере Bitrix24. Работает только на веб-версии (коробочная редакция).";
        $this->PARTNER_NAME        = "ClassnyiSait";
        $this->PARTNER_URI         = "https://classnyisait.ru";
    }

    function DoInstall()
    {
        ModuleManager::registerModule($this->MODULE_ID);
        $this->InstallEvents();
        return true;
    }

    function DoUninstall()
    {
        $this->UnInstallEvents();
        ModuleManager::unRegisterModule($this->MODULE_ID);
    }

    function InstallEvents()
    {
        $eventManager = EventManager::getInstance();
        $eventManager->registerEventHandler("main", "OnProlog",                       $this->MODULE_ID, "\\Classnyisait\\CrmChat\\EventHandler", "onProlog");
        $eventManager->registerEventHandler("im",   "OnRegisterExternalChatTypes",    $this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onRegisterType");
        $eventManager->registerEventHandler("im",   "OnAfterNavigationMenuBuild",     $this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onNavigationMenuBuild");
        $eventManager->registerEventHandler("im",   "OnBeforeUsersAddExternalChatCrm",$this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onBeforeUsersAdd");
    }

    function UnInstallEvents()
    {
        $eventManager = EventManager::getInstance();
        $eventManager->unRegisterEventHandler("main", "OnProlog",                       $this->MODULE_ID, "\\Classnyisait\\CrmChat\\EventHandler", "onProlog");
        $eventManager->unRegisterEventHandler("im",   "OnRegisterExternalChatTypes",    $this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onRegisterType");
        $eventManager->unRegisterEventHandler("im",   "OnAfterNavigationMenuBuild",     $this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onNavigationMenuBuild");
        $eventManager->unRegisterEventHandler("im",   "OnBeforeUsersAddExternalChatCrm",$this->MODULE_ID, "\\Classnyisait\\CrmChat\\CrmChat",       "onBeforeUsersAdd");
    }
}
