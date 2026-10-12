<?php
namespace Bitrix\Main\Engine { class Controller {} class CurrentUser { public static function get(){return new self;} public function getId(){return 92;} } }
namespace Bitrix\Main\Engine\ActionFilter { class Authentication {} class HttpMethod {public function __construct($methods){}} class Csrf {} }
namespace Bitrix\Main\DI { class ServiceLocator {public static function getInstance(){return new self;} public function get($name){return new $name;} } }
namespace Classnyisait\CrmChat { class CrmChat {public static $ids=['chat11']; public static $user; public static function getUserCrmDialogIds($id){ self::$user=$id; return self::$ids;} } }
namespace {
require dirname(__DIR__).'/classnyisait.crmchat/lib/Controller/Recent.php';
$controller=new \Classnyisait\CrmChat\Controller\Recent;
if($controller->loadAction()!==['available'=>false]) throw new \RuntimeException('Нет безопасного fallback старого ядра');
eval('namespace Bitrix\\Im\\V2\\Recent; class RecentProvider { public static $user; public static $ids; public function getItemsByChatIds($user,$ids){self::$user=$user;self::$ids=$ids;return $ids;} }');
eval('namespace Bitrix\\Im\\V2\\Rest; class RestAdapter {private $items;public function __construct($items){$this->items=$items;} public function toRestFormat(){return ["recentItems"=>$this->items];} }');
if($controller->loadAction()!==['recentItems'=>[11]]) throw new \RuntimeException('Не переданы свои recent');
if(\Classnyisait\CrmChat\CrmChat::$user!==92 || \Bitrix\Im\V2\Recent\RecentProvider::$user!==92) throw new \RuntimeException('Не использован текущий пользователь');
\Classnyisait\CrmChat\CrmChat::$ids=[];
if($controller->loadAction()!==['recentItems'=>[],'chats'=>[],'users'=>[],'messages'=>[],'files'=>[]]) throw new \RuntimeException('Ошибка пустого списка');
$filters=new \ReflectionMethod($controller,'getDefaultPreFilters');
if(array_map('get_class',$filters->invoke($controller))!==[\Bitrix\Main\Engine\ActionFilter\Authentication::class,\Bitrix\Main\Engine\ActionFilter\HttpMethod::class,\Bitrix\Main\Engine\ActionFilter\Csrf::class]) throw new \RuntimeException('Ошибка защитных фильтров');
$action=new \ReflectionMethod($controller,'loadAction');
if($action->getNumberOfParameters()!==0) throw new \RuntimeException('Нельзя принимать чужой userId или chatIds');
echo "PASS 6 сценариев CRM Recent\n";
}
