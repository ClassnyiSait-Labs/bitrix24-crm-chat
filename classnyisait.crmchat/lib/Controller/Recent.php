<?php
namespace Classnyisait\CrmChat\Controller;

use Bitrix\Main\DI\ServiceLocator;
use Bitrix\Main\Engine\Controller;
use Bitrix\Main\Engine\CurrentUser;
use Bitrix\Im\V2\Recent\RecentProvider;
use Bitrix\Im\V2\Rest\RestAdapter;
use Classnyisait\CrmChat\CrmChat;

class Recent extends Controller
{
    protected function getDefaultPreFilters(): array
    {
        return [
            new \Bitrix\Main\Engine\ActionFilter\Authentication(),
            new \Bitrix\Main\Engine\ActionFilter\HttpMethod(['POST']),
            new \Bitrix\Main\Engine\ActionFilter\Csrf(),
        ];
    }

    public function loadAction(): array
    {
        if (!class_exists(RecentProvider::class)
            || !method_exists(RecentProvider::class, 'getItemsByChatIds')
            || !class_exists(RestAdapter::class)) {
            return ['available' => false];
        }
        $userId = (int)CurrentUser::get()->getId();
        $chatIds = array_map(
            static fn(string $id): int => (int)substr($id, 4),
            CrmChat::getUserCrmDialogIds($userId),
        );
        if ($chatIds === []) {
            return ['recentItems' => [], 'chats' => [], 'users' => [], 'messages' => [], 'files' => []];
        }
        $recent = ServiceLocator::getInstance()->get(RecentProvider::class)->getItemsByChatIds($userId, $chatIds);
        return (new RestAdapter($recent))->toRestFormat();
    }
}
