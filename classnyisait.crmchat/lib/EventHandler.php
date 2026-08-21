<?php
namespace Classnyisait\CrmChat;

use Bitrix\Main\Loader;

class EventHandler
{
    public static function onProlog(): void
    {
        Loader::includeModule("classnyisait.crmchat");
    }
}
