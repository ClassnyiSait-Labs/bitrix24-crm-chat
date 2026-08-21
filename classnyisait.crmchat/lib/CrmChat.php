<?php
namespace Classnyisait\CrmChat;

use Bitrix\Im\V2\Chat\ExternalChat\Event\RegisterTypeEvent;
use Bitrix\Im\V2\Chat\ExternalChat\Event\BeforeUsersAddEvent;
use Bitrix\Im\V2\Chat\ExternalChat\Config;
use Bitrix\Im\V2\Permission\Action;
use Bitrix\Im\V2\Application\Navigation\NavigationMenuBuildEvent;
use Bitrix\Im\V2\Application\Navigation\MenuItem;
use Bitrix\Main\EventResult;
use Bitrix\Main\Loader;
use Bitrix\Im\V2\Chat;

class CrmChat
{
    const ENTITY_TYPE = "CRM";

    public static function onRegisterType(RegisterTypeEvent $event): EventResult
    {
        $parameters = [
            "type" => self::ENTITY_TYPE,
            "config" => new Config(
                hasOwnRecentSection: true,
                permissions: [
                    Action::Extend->value        => Chat::ROLE_MEMBER,
                    Action::ChangeAvatar->value  => Chat::ROLE_NONE,
                    Action::ChangeDescription->value => Chat::ROLE_NONE,
                    Action::ChangeColor->value   => Chat::ROLE_NONE,
                    Action::Rename->value        => Chat::ROLE_NONE,
                    Action::Leave->value         => Chat::ROLE_NONE,
                    Action::LeaveOwner->value    => Chat::ROLE_NONE,
                    Action::Kick->value          => Chat::ROLE_NONE,
                    Action::ChangeManagers->value => Chat::ROLE_NONE,
                    Action::Mute->value          => Chat::ROLE_NONE,
                ],
                isAutoJoinEnabled: true
            ),
        ];

        return new EventResult(EventResult::SUCCESS, $parameters);
    }

    public static function onNavigationMenuBuild(NavigationMenuBuildEvent $event): EventResult
    {
        $collection = $event->getCollection();
        $collection->add(new MenuItem(
            id: "crmDeal",
            text: "CRM чаты",
            sort: 150,
        ));

        return new EventResult(EventResult::SUCCESS);
    }

    public static function onBeforeUsersAdd(BeforeUsersAddEvent $event): EventResult
    {
        $config = $event->getAddUsersConfig();
        $config = $config
            ->setWithMessage(false)
            ->setHideHistory(false)
        ;

        return new EventResult(EventResult::SUCCESS, ["config" => $config]);
    }

    public static function getTabSortForUser(int $userId): int
    {
        if ($userId <= 0) {
            return 150;
        }
        $saved = \CUserOptions::GetOption("classnyisait.chatcategories", "tab_sort_crmdeal", 0, $userId);
        return $saved > 0 ? (int)$saved : 150;
    }

    public static function getUserCrmDialogIds(int $userId): array
    {
        if ($userId <= 0 || !Loader::includeModule("im")) {
            return [];
        }

        $rows = \Bitrix\Im\Model\RecentTable::getList([
            "select" => ["ITEM_CID"],
            "filter" => [
                "=USER_ID"         => $userId,
                "=CHAT.ENTITY_TYPE" => self::ENTITY_TYPE,
            ],
        ])->fetchAll();

        return array_map(function ($row) {
            return "chat" . $row["ITEM_CID"];
        }, $rows);
    }
}
