/**
 * classnyisait.crmchat / notifychat / chatcategories — runtime-патчи для Bitrix24 v26.
 *
 * Восстанавливает поддержку кастомных layout'ов мессенджера:
 *   - crmDeal       — вкладка "CRM чаты"
 *   - notifyChat    — вкладка "Чаты событий"
 *   - customCat_*   — пользовательские категории чатов
 *
 * Архитектура:
 *   1. NavigationMenuItem в v26 — Object.freeze, расширить нельзя. Перехватываем
 *      NavigationManager.open для наших id и зовём LayoutManager.setLayout
 *      напрямую, минуя проверку NavigationMenuItem[id].
 *   2. Layout — обычный объект, мутабельный. Добавляем недостающие ключи.
 *   3. LayoutManager.isValidLayout / isChatLayout — патчим прототип.
 *   4. Messenger Vue Options Object — перехватываем установку
 *      BX.Messenger.v2.Component.Messenger через Object.defineProperty (только
 *      это свойство — НЕ расширения List.* как делал старый fix_navigation.js!).
 *      Когда messenger.bundle.js присваивает Messenger, наш сеттер мутирует его
 *      computed.listComponent / contentComponent / hasListComponent ДО того как
 *      messenger.application.bundle.js передаст ссылку в Core.createVue.
 *      Это синхронно, без race с module-level LayoutComponentMap (которая собирается
 *      из ОТДЕЛЬНЫХ аргументов IIFE messenger.bundle.js, не через наши геттеры).
 *
 * Подключается через Asset::addJs из classnyisait.crmchat/include.php — один источник
 * истины для всех трёх модулей.
 */
(function () {
	'use strict';

	var CUSTOM_LAYOUTS = ['crmDeal', 'notifyChat'];
	var CUSTOM_PREFIX = 'customCat_';

	// Чаты, в которых ЗАПРЕЩЕНЫ звонки (видео/аудио) для всех пользователей.
	// dialogId в формате Bitrix v26: 'chat<id>'. chat1 — общий чат (General).
	var CALL_DISABLED_DIALOG_IDS = ['chat1'];

	function log(msg) {
		if (window.LB_DEBUG) {
			try { console.log('[v26-compat] ' + msg); } catch (e) {}
		}
	}

	function ensureCategoriesTickModule(store) {
		if (!store || (store.state && store.state.classnyisaitCategories)) return;
		try {
			store.registerModule('classnyisaitCategories', {
				namespaced: true,
				state: function () { return { tick: 0 }; },
				mutations: { bump: function (s) { s.tick++; } }
			});
		} catch (e) {}
	}

	function normalizeLayoutName(name) {
		if (!name || typeof name !== 'string') return '';
		var lower = name.toLowerCase();
		if (lower === 'crmdeal') return 'crmDeal';
		if (lower === 'notifychat') return 'notifyChat';
		if (lower.indexOf('customcat_') === 0) return CUSTOM_PREFIX + name.substring(name.indexOf('_') + 1);
		return name;
	}

	function isCustomLayout(name) {
		var normalized = normalizeLayoutName(name);
		return CUSTOM_LAYOUTS.indexOf(normalized) !== -1 || normalized.indexOf(CUSTOM_PREFIX) === 0;
	}

	function ensureNamespace(path) {
		var parts = path.split('.');
		var obj = window;
		for (var i = 0; i < parts.length; i++) {
			obj[parts[i]] = obj[parts[i]] || {};
			obj = obj[parts[i]];
		}
		return obj;
	}

	// =========================================================
	// Фильтр чатов по активному layout'у.
	// chat.type соответствует ChatType (im.v2.const/chat.js):
	//   crm, sonetGroup, calendar — наши целевые типы.
	// На вкладке "Чаты" (Layout.chat) скрываем CRM и события (они — отдельные
	// разделы). Категории customCat — НЕ исключаем оттуда, т.к. это пользовательские
	// группировки, а не отдельный класс чатов.
	// =========================================================
	function filterRecentItem(item, layoutName, store) {
		layoutName = normalizeLayoutName(layoutName);
		var chat = store.getters['chats/get'] && store.getters['chats/get'](item.dialogId);

		if (layoutName === 'chat') {
			if (!chat) return true;
			if (chat.type === 'crm') return false;
			if (chat.type === 'sonetGroup' || chat.type === 'calendar') return false;
			return true;
		}
		if (!chat) return !isCustomLayout(layoutName);

		if (layoutName === 'crmDeal') {
			return chat.type === 'crm';
		}
		if (layoutName === 'notifyChat') {
			return chat.type === 'sonetGroup' || chat.type === 'calendar';
		}
		if (layoutName.indexOf(CUSTOM_PREFIX) === 0) {
			// Mapping {categoryId: [dialogId, ...]} прокидывается серверным
			// classnyisait.chatcategories/EventHandler::onProlog в Asset::addString.
			var catId = layoutName.substring(CUSTOM_PREFIX.length);
			var map = window.classnyisaitCategoriesMap || {};
			var dialogIds = map[catId] || [];
			return dialogIds.indexOf(item.dialogId) !== -1;
		}
		return true;
	}

	function patchRecentListOptions(opts) {
		if (!opts || !opts.computed || opts.__customPatched) return opts;
		opts.__customPatched = true;

		var origPrepared = opts.computed.preparedItems;
		if (typeof origPrepared !== 'function') return opts;

		opts.computed.preparedItems = function () {
			var orig;
			try { orig = origPrepared.call(this); } catch (e) { return []; }
			if (!Array.isArray(orig)) return orig;

			try {
				var store = this.$store;
				ensureCategoriesTickModule(store);
				if (store && store.state && store.state.classnyisaitCategories) {
					void store.state.classnyisaitCategories.tick;
				}
				var layout = store && store.getters && store.getters['application/getLayout'];
				var layoutName = (layout && layout.name) || 'chat';
				return orig.filter(function (item) {
					return filterRecentItem(item, layoutName, store);
				});
			} catch (e) { return orig; }
		};

		log('RecentList.preparedItems patched (filter by layout)');
		return opts;
	}

	function patchMessengerOptions(opts) {
		if (!opts || !opts.computed || opts.__customPatched) return opts;
		opts.__customPatched = true;

		var origList = opts.computed.listComponent;
		var origContent = opts.computed.contentComponent;
		var origHas = opts.computed.hasListComponent;

		opts.computed.listComponent = function () {
			if (isCustomLayout(this.layoutName)) {
				var List = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Component && window.BX.Messenger.v2.Component.List;
				return List && List.RecentListContainer ? List.RecentListContainer : null;
			}
			try { return origList.call(this); } catch (e) { return null; }
		};
		opts.computed.contentComponent = function () {
			if (isCustomLayout(this.layoutName)) {
				var Content = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Component && window.BX.Messenger.v2.Component.Content;
				return Content && Content.ChatContent ? Content.ChatContent : null;
			}
			try { return origContent.call(this); } catch (e) { return null; }
		};
		opts.computed.hasListComponent = function () {
			try {
				if (isCustomLayout(this.layoutName)) return true;
				if (typeof origHas === 'function') return origHas.call(this);
				return Boolean(this.listComponent);
			} catch (e) { return false; }
		};

		// RecentListContainer.onChatClick хардкодит Layout.chat в emit('selectEntity')
		// → при клике на чат в кастомной вкладке нас выкидывает в общий список.
		// Перехватываем родительский обработчик и сохраняем текущий layoutName,
		// если кликнули в кастомной вкладке.
		// ВАЖНО: try/catch вокруг ТОЛЬКО подготовки fixed-payload. Если обернуть
		// сам вызов origOnEntitySelect — любое внутреннее исключение приведёт к
		// двойному вызову (чат откроется 2 раза, требует двойного "Назад").
		opts.methods = opts.methods || {};
		var origOnEntitySelect = opts.methods.onEntitySelect;
		opts.methods.onEntitySelect = function (payload) {
			var fixed = payload || {};
			try {
				var current = this.$store && this.$store.getters && this.$store.getters['application/getLayout'];
				var currentName = current && current.name;
				if (isCustomLayout(currentName) && fixed.layoutName !== currentName) {
					fixed = { layoutName: currentName, entityId: fixed.entityId };
				}
			} catch (e) { /* fall through with original payload */ }

			if (typeof origOnEntitySelect === 'function') {
				return origOnEntitySelect.call(this, fixed);
			}
			// Fallback на случай если оригинальный метод исчез:
			var lm = window.BX.Messenger.v2.Lib.LayoutManager.getInstance();
			return lm.setLayout({ name: fixed.layoutName, entityId: fixed.entityId });
		};

		log('Messenger options computed patched (synchronous via setter)');
		return opts;
	}

	// =========================================================
	// 1. Property hijack ТОЛЬКО на Component.Messenger.
	// Делается СИНХРОННО при загрузке скрипта, ДО messenger.bundle.js.
	// =========================================================
	function installMessengerInterceptor() {
		var ns = ensureNamespace('BX.Messenger.v2.Component');
		var prevDescriptor = Object.getOwnPropertyDescriptor(ns, 'Messenger');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var stored = ns.Messenger;

		if (stored && stored.computed) {
			patchMessengerOptions(stored);
		}

		try {
			Object.defineProperty(ns, 'Messenger', {
				get: function () { return stored; },
				set: function (value) {
					stored = value;
					if (prevSetter) {
						try { prevSetter(value); } catch (e) {}
					}
					patchMessengerOptions(stored);
				},
				configurable: true,
				enumerable: true
			});
			log('Messenger interceptor installed');
		} catch (e) {
			log('Failed to install Messenger interceptor: ' + e.message);
		}
	}

	// =========================================================
	// 1b. Property hijack на Component.List.RecentList — для фильтрации списка.
	// Безопасен: messenger.bundle.js не импортирует RecentList напрямую (только
	// RecentListContainer, который мы НЕ перехватываем). recent-container.bundle.js
	// зависит от recent-list.bundle.js — порядок гарантирован Runtime.loadExtension.
	// =========================================================
	function installRecentListInterceptor() {
		var ns = ensureNamespace('BX.Messenger.v2.Component.List');
		var prevDescriptor = Object.getOwnPropertyDescriptor(ns, 'RecentList');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var stored = ns.RecentList;

		if (stored && stored.computed) {
			patchRecentListOptions(stored);
		}

		try {
			Object.defineProperty(ns, 'RecentList', {
				get: function () { return stored; },
				set: function (value) {
					stored = value;
					if (prevSetter) {
						try { prevSetter(value); } catch (e) {}
					}
					patchRecentListOptions(stored);
				},
				configurable: true,
				enumerable: true
			});
			log('RecentList interceptor installed');
		} catch (e) {
			log('Failed to install RecentList interceptor: ' + e.message);
		}
	}

	// =========================================================
	// 2. Поллинг для остальных патчей (Layout const, LayoutManager,
	// NavigationManager) — они расширяют существующие объекты безопасно.
	// =========================================================
	var done = {
		layoutConst: false,
		layoutManager: false,
		navManager: false,
		permissionManager: false,
		badges: false
	};

	function patchLayoutConst() {
		var Const = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Const;
		if (!Const || !Const.Layout) return false;

		CUSTOM_LAYOUTS.forEach(function (name) {
			if (!Const.Layout[name]) {
				try { Const.Layout[name] = name; } catch (e) {}
			}
		});

		log('Layout const extended');
		return true;
	}

	function patchLayoutManager() {
		var Lib = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Lib;
		var LM = Lib && Lib.LayoutManager;
		if (!LM || !LM.prototype || typeof LM.prototype.isValidLayout !== 'function') return false;
		if (LM.prototype.__customPatched) return true;

		LM.prototype.__customPatched = true;

		var origValid = LM.prototype.isValidLayout;
		LM.prototype.isValidLayout = function (name) {
			if (isCustomLayout(name)) return true;
			return origValid.call(this, name);
		};

		if (typeof LM.prototype.isChatLayout === 'function') {
			var origChat = LM.prototype.isChatLayout;
			LM.prototype.isChatLayout = function (name) {
				if (isCustomLayout(name)) return true;
				return origChat.call(this, name);
			};
		}

		log('LayoutManager patched');
		return true;
	}

	// Блокирует звонки в перечисленных чатах (CALL_DISABLED_DIALOG_IDS) на UI-уровне.
	// Bitrix v26 проверяет PermissionManager.canPerformActionByRole('call', dialogId)
	// перед отрисовкой кнопок звонка → возврат false скрывает их везде.
	function patchPermissionManager() {
		var Lib = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Lib;
		var PM = Lib && Lib.PermissionManager;
		if (!PM || !PM.prototype || typeof PM.prototype.canPerformActionByRole !== 'function') return false;
		if (PM.prototype.__customCallBlock) return true;
		PM.prototype.__customCallBlock = true;

		var origCanPerform = PM.prototype.canPerformActionByRole;
		PM.prototype.canPerformActionByRole = function (actionType, dialogId) {
			if (actionType === 'call' && CALL_DISABLED_DIALOG_IDS.indexOf(dialogId) !== -1) {
				return false;
			}
			return origCanPerform.call(this, actionType, dialogId);
		};

		log('PermissionManager.canPerformActionByRole patched (call disabled in: ' + CALL_DISABLED_DIALOG_IDS.join(',') + ')');
		return true;
	}

	var crmRecentLoading = null;

	function loadCrmRecentItems() {
		if (crmRecentLoading) return crmRecentLoading;
		var store = getStore();
		if (!window.BX || !BX.ajax || !store) return null;

		crmRecentLoading = BX.ajax.runAction('classnyisait:crmchat.Controller.Recent.load').then(function (response) {
			var result = response.data;
			if (result.available === false) return;
			return Promise.all([
				store.dispatch('chats/set', result.chats || []),
				store.dispatch('users/set', result.users || []),
				store.dispatch('messages/store', result.messages || []),
				store.dispatch('files/set', result.files || []),
				store.dispatch('recent/setCollection', {
				type: 'default',
				items: result.recentItems || [],
				parentChatId: 0
				})
			]);
		}).catch(function (error) {
			crmRecentLoading = null;
			console.error('Не удалось загрузить CRM чаты', error);
		});
		return crmRecentLoading;
	}

	function patchNavigationManager() {
		var Lib = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Lib;
		var NM = Lib && Lib.NavigationManager;
		if (!NM || typeof NM.open !== 'function') return false;
		if (NM.__customPatched) return true;

		NM.__customPatched = true;

		var origOpen = NM.open.bind(NM);
		NM.open = function (payload) {
			if (payload && isCustomLayout(payload.id)) {
				if (normalizeLayoutName(payload.id) === 'crmDeal') loadCrmRecentItems();
				var layoutManager = Lib.LayoutManager && Lib.LayoutManager.getInstance && Lib.LayoutManager.getInstance();
				if (!layoutManager) {
					return origOpen(payload);
				}

				var entityId = payload.entityId;
				if (!entityId && typeof layoutManager.getLastOpenedElement === 'function') {
					entityId = layoutManager.getLastOpenedElement(payload.id) || '';
				}

				log('routing custom layout: ' + payload.id);
				return layoutManager.setLayout({ name: payload.id, entityId: entityId || '' });
			}

			return origOpen(payload);
		};

		log('NavigationManager.open patched');
		return true;
	}

	function tryPatchRest() {
		if (!done.layoutConst)      done.layoutConst      = patchLayoutConst();
		if (!done.layoutManager)    done.layoutManager    = patchLayoutManager();
		if (!done.navManager)       done.navManager       = patchNavigationManager();
		if (!done.permissionManager) done.permissionManager = patchPermissionManager();
		if (!done.badges)           done.badges           = initBadgeUpdater();
		return done.layoutConst && done.layoutManager && done.navManager && done.permissionManager && done.badges;
	}

	// =========================================================
	// Бейдж-счётчики непрочитанных для кастомных вкладок навигации:
	//   - crmDeal      — все чаты с chat.type === 'crm'
	//   - notifyChat   — все чаты с chat.type === 'sonetGroup' | 'calendar'
	//   - customCat_*  — dialogIds из window.classnyisaitCategoriesMap[id]
	//
	// Источник: store.state.counters.collection[chatId] — обновляется на каждый
	// PULL message через MessagePullHandler.#updateDialog. Замьюченные чаты (.isMuted)
	// исключаются — Bitrix-нативное поведение, в общем счётчике их тоже не учитывают.
	//
	// Архитектура v26 (см. bitrix/modules/im/install/js/im/v2/model/src/counters/):
	//   counters.collection: {[chatId]: {counter, isMuted, isMarkedAsUnread, ...}}
	//   chats.collection:    {[dialogId]: {chatId, type, ...}}
	//
	// UI: BX.Main.interfaceButtonsManager.getById('chat-menu' | 'top_menu_id_collaboration')
	// .updateCounter(layoutId, N). Подтверждено в bitrix24/src/js/chat-menu.js v26 —
	// ядро тоже шлёт обновления через эти контейнеры.
	// =========================================================
	var BADGE_DEBOUNCE_MS = 100;
	var badgeLastValues = {};
	var badgeTimer = null;
	var badgeStoreWatched = false;

	function getStore() {
		try {
			var App = window.BX && window.BX.Messenger && window.BX.Messenger.v2 && window.BX.Messenger.v2.Application;
			var Core = App && App.Core;
			if (Core && typeof Core.getStore === 'function') {
				var s = Core.getStore();
				if (s) return s;
			}
		} catch (e) {}
		return null;
	}

	function getChatMenus() {
		var menus = [];
		try {
			var manager = window.BX && window.BX.Main && window.BX.Main.interfaceButtonsManager;
			if (!manager) return menus;
			var m1 = manager.getById('chat-menu');
			var m2 = manager.getById('top_menu_id_collaboration');
			if (m1) menus.push(m1);
			if (m2) menus.push(m2);
		} catch (e) {}
		return menus;
	}

	function chatCounterValue(countersColl, chatId) {
		var item = countersColl[chatId];
		if (!item) return 0;
		if (item.isMuted) return 0;
		if (item.counter > 0) return item.counter;
		if (item.isMarkedAsUnread) return 1;
		return 0;
	}

	function getLayoutIds() {
		var ids = ['crmDeal', 'crmdeal', 'notifyChat', 'notifychat'];
		var list = window.classnyisaitCategoriesList || [];
		for (var i = 0; i < list.length; i++) {
			var cat = list[i];
			if (cat && (cat.id || cat.id === 0)) {
				ids.push(CUSTOM_PREFIX + cat.id);
			}
		}
		return ids;
	}

	function computeBadge(layoutId, chatsColl, countersColl) {
		layoutId = normalizeLayoutName(layoutId);
		var total = 0;
		if (layoutId === 'crmDeal' || layoutId === 'notifyChat') {
			var keys = Object.keys(chatsColl);
			for (var i = 0; i < keys.length; i++) {
				var chat = chatsColl[keys[i]];
				if (!chat || !chat.chatId) continue;
				var t = chat.type;
				if (layoutId === 'crmDeal') {
					if (t !== 'crm') continue;
				} else {
					if (t !== 'sonetGroup' && t !== 'calendar') continue;
				}
				total += chatCounterValue(countersColl, chat.chatId);
			}
			return total;
		}
		if (layoutId.indexOf(CUSTOM_PREFIX) === 0) {
			var catId = layoutId.substring(CUSTOM_PREFIX.length);
			var map = window.classnyisaitCategoriesMap || {};
			var dialogIds = map[catId] || [];
			for (var j = 0; j < dialogIds.length; j++) {
				var c = chatsColl[dialogIds[j]];
				if (c && c.chatId) total += chatCounterValue(countersColl, c.chatId);
			}
			return total;
		}
		return 0;
	}

	function updateAllBadges() {
		var store = getStore();
		if (!store || !store.state) return;
		var menus = getChatMenus();
		if (menus.length === 0) return;

		var chatsColl = store.state.chats && store.state.chats.collection;
		var countersColl = store.state.counters && store.state.counters.collection;
		if (!chatsColl || !countersColl) return;

		var ids = getLayoutIds();
		for (var i = 0; i < ids.length; i++) {
			var layoutId = ids[i];
			var n = computeBadge(layoutId, chatsColl, countersColl);
			if (badgeLastValues[layoutId] === n) continue;
			badgeLastValues[layoutId] = n;
			for (var j = 0; j < menus.length; j++) {
				try { menus[j].updateCounter(layoutId, n); } catch (e) {}
			}
			log('badge ' + layoutId + '=' + n);
		}
	}

	function scheduleBadgeUpdate() {
		if (badgeTimer) return;
		badgeTimer = setTimeout(function () {
			badgeTimer = null;
			updateAllBadges();
		}, BADGE_DEBOUNCE_MS);
	}

	function getActiveNavigationLayoutName() {
		var selectors = [
			'#chat-menu .main-buttons-item',
			'#top_menu_id_collaboration .main-buttons-item'
		];
		for (var i = 0; i < selectors.length; i++) {
			var items = document.querySelectorAll(selectors[i]);
			for (var j = 0; j < items.length; j++) {
				var item = items[j];
				var cls = item.className || '';
				if (cls.indexOf('active') !== -1 || cls.indexOf('--active') !== -1) {
					return normalizeLayoutName(item.dataset && item.dataset.id || '');
				}
			}
		}
		return '';
	}

	function getKnownCrmDialogIds() {
		var ids = window.classnyisaitCrmDialogIds;
		return Array.isArray(ids) ? ids.map(String) : [];
	}

	function isKnownCrmDialog(dialogId) {
		var did = String(dialogId);
		var ids = getKnownCrmDialogIds();
		if (ids.indexOf(did) !== -1) return true;

		try {
			var store = getStore();
			var chat = store && store.getters && store.getters['chats/get'] && store.getters['chats/get'](did);
			return !!(chat && chat.type === 'crm');
		} catch (e) {}
		return false;
	}

	function isHiddenByOtherDomFilter(item) {
		return item.dataset.notifyChatHidden === '1' || item.dataset.chatCatHidden === '1';
	}

	function applyCrmVisibility(item, visible) {
		if (visible) {
			delete item.dataset.crmChatHidden;
			item.style.display = isHiddenByOtherDomFilter(item) ? 'none' : '';
		} else {
			item.dataset.crmChatHidden = '1';
			item.style.display = 'none';
		}
	}

	function maintainCrmDomFilter() {
		var layoutName = getActiveNavigationLayoutName();
		var isCrmTab = layoutName === 'crmDeal';
		if (isCrmTab) loadCrmRecentItems();
		var isCommonChatTab = layoutName === 'chat';
		var items = document.querySelectorAll('.bx-im-list-recent-item__wrap[data-id]');

		if (!isCrmTab && !isCommonChatTab) {
			items.forEach(function (item) {
				if (item.dataset.crmChatHidden === '1') {
					delete item.dataset.crmChatHidden;
					item.style.display = isHiddenByOtherDomFilter(item) ? 'none' : '';
				}
			});
			return;
		}

		var knownIds = getKnownCrmDialogIds();
		if (isCrmTab && knownIds.length === 0) return;

		items.forEach(function (item) {
			var isCrm = isKnownCrmDialog(item.dataset.id);
			var visible = isCrmTab ? isCrm : !isCrm;
			applyCrmVisibility(item, visible);
		});
	}

	function startCrmDomFallback() {
		maintainCrmDomFilter();

		var attempts = 0;
		var pollId = setInterval(function () {
			attempts++;
			maintainCrmDomFilter();
			if (attempts > 600) clearInterval(pollId);
		}, 50);

		try {
			var obs = new MutationObserver(maintainCrmDomFilter);
			obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-id'] });
		} catch (e) {}
	}
	function initBadgeUpdater() {
		var store = getStore();
		if (!store || !store.state || !store.watch) return false;
		if (badgeStoreWatched) return true;
		badgeStoreWatched = true;

		// Trigger 1 (primary): сумма всех counters.collection.counter — обновляется на каждый PULL
		try {
			store.watch(
				function (state) {
					var coll = state.counters && state.counters.collection;
					if (!coll) return 0;
					var total = 0;
					var keys = Object.keys(coll);
					for (var i = 0; i < keys.length; i++) {
						var c = coll[keys[i]];
						if (c && !c.isMuted) {
							if (c.counter > 0) total += c.counter;
							else if (c.isMarkedAsUnread) total += 1;
						}
					}
					return total;
				},
				scheduleBadgeUpdate
			);
		} catch (e) {}

		// Trigger 2 (backup): chats.collection — на случай если у кастомной вкладки
		// добавились/убрались чаты (например ENTITY_TYPE появился, тип чата поменялся)
		try {
			store.watch(
				function (state) {
					var coll = state.chats && state.chats.collection;
					if (!coll) return 0;
					return Object.keys(coll).length;
				},
				scheduleBadgeUpdate
			);
		} catch (e) {}

		// Trigger 3 (backup): нативный 'IM.Counters:onUpdate' — тот же event, что
		// слушает ChatMenu (bitrix24/src/js/chat-menu.js), но он шлёт только id ядра
		// (chat, copilot, lines...) — наши customCat/crmDeal/notifyChat пересчитываем сами.
		try {
			var EE = window.BX && window.BX.Event && window.BX.Event.EventEmitter;
			if (EE && typeof EE.subscribe === 'function') {
				EE.subscribe('IM.Counters:onUpdate', scheduleBadgeUpdate);
			}
		} catch (e) {}

		// Первый расчёт после регистрации watcher'ов
		scheduleBadgeUpdate();
		log('badge updater initialized');
		return true;
	}

	// =========================================================
	// Init
	// =========================================================
	// Phase 1: ставим перехватчики Messenger и RecentList СИНХРОННО (без ожидания DOMContentLoaded)
	installMessengerInterceptor();
	installRecentListInterceptor();

	// Phase 2: поллинг готовности рантайм-объектов для остальных патчей
	function startRestPolling() {
		if (tryPatchRest()) return;

		var attempts = 0;
		var MAX_ATTEMPTS = 600; // ~30 секунд при интервале 50мс
		var timerId = setInterval(function () {
			attempts++;
			if (tryPatchRest() || attempts > MAX_ATTEMPTS) {
				clearInterval(timerId);
				log('rest patches done in ' + attempts + ' attempts');
			}
		}, 50);
		try {
			document.addEventListener('click', function () {
				setTimeout(maintainCrmDomFilter, 0);
				setTimeout(maintainCrmDomFilter, 150);
			}, true);
		} catch (e) {}

	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', startRestPolling);
		document.addEventListener('DOMContentLoaded', startCrmDomFallback);
	} else {
		startRestPolling();
		startCrmDomFallback();
	}
})();
