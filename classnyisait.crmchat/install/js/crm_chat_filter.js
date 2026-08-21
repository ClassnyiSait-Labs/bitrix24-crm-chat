/**
 * custom.crmchat — CRM chat filter service
 *
 * When messenger layout is 'crmDeal':
 * - Loads CRM deal chats from im.v2.Recent.ExternalChat.Tail REST API
 * - Patches LegacyRecentService.getCollection to return CRM deal items
 * - Patches loadNextPage for CRM deal pagination
 * - Auto-selects first CRM deal chat when switching to layout
 *
 * Two-phase approach (mirrors notify_chat_filter.js):
 * Phase 1 (immediate): property trap on BX.Messenger.v2.Application.Core
 *   → wraps store._actions['recent/setRecent'] to cache dialogId→chatType
 *     from the raw payload (before formatFields strips chat.type)
 *   → wraps store._mutations['recent/setRecentCollection'] to filter out
 *     CRM dialogIds using the type cache (zero-flash approach)
 * Phase 2 (interval): patch LegacyRecentService.getCollection + cleanup safety net
 *
 * Why action patch? state.recent.collection uses recentFieldsConfig which only
 * keeps dialogId/messageId/draft/pinned/etc — chat.type is NOT preserved.
 * The raw chat.type is only available in the recent/setRecent action payload.
 *
 * NOTE: chats/get returns type='chat' for CRM chats (not 'crm') because
 * buildDialogueItem normalizes the type. Only the raw REST payload is reliable.
 */
(function () {
	'use strict';

	var CRM_DEAL_CHAT_TYPE = 'crm';
	var CRM_DEAL_REST_TYPE = 'crm_deal';
	var LAYOUT_NAME = 'crmDeal';
	var REST_ENDPOINT = 'im.v2.Recent.ExternalChat.Tail';
	var ITEMS_PER_PAGE = 50;

	// Cache of dialogId → raw chat.type captured from recent/setRecent payload
	var dialogTypeCache = {};

	// Explicit set of CRM dialogIds populated from REST loading via im.v2.Recent.ExternalChat.Tail.
	// This is the most reliable source because it comes directly from the CRM-specific endpoint.
	// NOTE: recent/setRecent is NEVER called for CRM chats (PULL skips 'crm' section, REST load
	// uses recent/store directly), so dialogTypeCache is always empty. Use knownCrmDialogIds instead.
	var knownCrmDialogIds = {};

	var state = {
		isLoading: false,
		firstPageLoaded: false,
		hasMoreItems: true,
		lastMessageDate: null,
		patched: false,
		actionPatched: false,
		mutationPatched: false,
	};

	function log(msg) {
		if (window.LB_DEBUG) { try { console.log('[CRM Chat] ' + msg); } catch (e) {} }
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

	function getStore() {
		try {
			var core = BX.Messenger.v2.Application.Core;
			return core && typeof core.getStore === 'function' ? core.getStore() : null;
		} catch (e) {
			return null;
		}
	}

	function getLayoutManager() {
		try {
			var lm = BX.Messenger.v2.Lib.LayoutManager.getInstance();
			return lm && typeof lm.setLayout === 'function' ? lm : null;
		} catch (e) {
			return null;
		}
	}

	function getCurrentLayoutName() {
		var store = getStore();
		if (!store) return '';
		var layout = store.state.application && store.state.application.layout;
		return layout ? layout.name : '';
	}

	/**
	 * Check if a dialogId belongs to a CRM chat.
	 * Primary: knownCrmDialogIds — explicitly populated from REST loading.
	 * Secondary: type cache from recent/setRecent action patch (rarely populated for CRM).
	 * Fallback: chats/get model — populated by PULL events via MessagePullHandler.#setMessageChat.
	 */
	function isDialogCrm(store, dialogId) {
		if (knownCrmDialogIds[dialogId]) return true;

		var cachedType = dialogTypeCache[dialogId];
		if (cachedType === CRM_DEAL_CHAT_TYPE) return true;

		try {
			var dialog = store.getters['chats/get'] && store.getters['chats/get'](dialogId);
			if (dialog && dialog.type === CRM_DEAL_CHAT_TYPE) return true;
		} catch (e) {}

		return false;
	}

	// =========================================================
	// Phase 1a: Action patch — capture chat.type from raw payload
	// =========================================================

	function installActionPatch(store) {
		if (state.actionPatched) return true;

		var handlers = store._actions && store._actions['recent/setRecent'];
		if (!handlers || !handlers.length) return false;

		var original = handlers[0];
		handlers[0] = function (payload) {
			// Synchronously cache dialogId → chatType before async chain starts
			if (Array.isArray(payload)) {
				payload.forEach(function (item) {
					var dialogId = item.id || item.dialogId;
					var chatType = item.chat && item.chat.type;
					if (dialogId && chatType) {
						dialogTypeCache[dialogId] = chatType;
					}
				});
			}
			return original(payload);
		};

		state.actionPatched = true;
		log('Action patch installed');
		return true;
	}

	// =========================================================
	// Phase 1b: Mutation patch — filter CRM chats from
	// recentCollection before they are added (zero-flash approach)
	// =========================================================

	function installMutationPatch(store) {
		if (state.mutationPatched) return true;

		var handlers = store._mutations && store._mutations['recent/setRecentCollection'];
		if (!handlers || !handlers.length) return false;

		var original = handlers[0];
		handlers[0] = function (payload) {
			var filtered = payload.filter(function (dialogId) {
				return !isDialogCrm(store, dialogId);
			});
			return original(filtered);
		};

		state.mutationPatched = true;
		log('Mutation patch installed');
		return true;
	}

	function tryInstallPatches(coreRef) {
		var store = coreRef && coreRef.getStore && coreRef.getStore();
		if (!store) return;

		if (!state.actionPatched) installActionPatch(store);

		if (!state.mutationPatched) {
			if (!installMutationPatch(store)) {
				// Mutations not registered yet — poll until they are
				var tries = 0;
				var pollId = setInterval(function () {
					tries++;
					var s = coreRef && coreRef.getStore && coreRef.getStore();
					if ((s && installMutationPatch(s)) || tries > 150) {
						clearInterval(pollId);
					}
				}, 20);
			}
		}
	}

	// =========================================================
	// Core trap — intercept Core assignment to install patches ASAP
	// =========================================================

	function setupCoreTrap() {
		ensureNamespace('BX.Messenger.v2.Application');
		var app = BX.Messenger.v2.Application;

		// Core already set — install patches immediately
		if (app.Core) {
			tryInstallPatches(app.Core);
			return;
		}

		// Trap Core assignment — chain with any existing trap (e.g. from notify_chat_filter)
		var prevDescriptor = Object.getOwnPropertyDescriptor(app, 'Core');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var origCore;
		Object.defineProperty(app, 'Core', {
			get: function () { return origCore; },
			set: function (val) {
				origCore = val;
				if (prevSetter) prevSetter(val);
				tryInstallPatches(val);
			},
			configurable: true,
			enumerable: true,
		});

		log('Core trap installed');
	}

	// =========================================================
	// Safety net: remove any CRM chats already in recentCollection
	// =========================================================

	function cleanCrmFromRecentCollection(store) {
		var recentCollection = store.state.recent && store.state.recent.recentCollection;
		if (!recentCollection) return;
		var toDelete = [];
		recentCollection.forEach(function (dialogId) {
			if (isDialogCrm(store, dialogId)) {
				toDelete.push(dialogId);
			}
		});
		toDelete.forEach(function (dialogId) {
			recentCollection.delete(dialogId);
		});
		log('cleanCrmFromRecentCollection: removed ' + toDelete.length + ' items');
	}

	// =========================================================
	// REST API loading
	// =========================================================

	function loadCrmDeals(firstPage) {
		if (state.isLoading) return Promise.resolve();
		if (!firstPage && !state.hasMoreItems) return Promise.resolve();

		state.isLoading = true;

		var data = {
			limit: ITEMS_PER_PAGE,
			filter: {
				lastMessageDate: firstPage ? null : state.lastMessageDate
			},
			type: CRM_DEAL_REST_TYPE
		};

		log('Loading CRM deals (firstPage=' + firstPage + ')');

		return BX.ajax.runAction(REST_ENDPOINT, { data: data })
			.then(function (response) {
				var result = response && response.data ? response.data : {};
				log('Loaded: ' + (result.recentItems ? result.recentItems.length : 0) +
					' items, hasNext=' + result.hasNextPage);

				state.hasMoreItems = typeof result.hasNextPage === 'boolean' ? result.hasNextPage : false;
				state.isLoading = false;

				// Update lastMessageDate for pagination (find earliest non-pinned message)
				if (result.messages && result.messages.length > 0) {
					var pinnedChatIds = {};
					if (result.recentItems) {
						result.recentItems.forEach(function (item) {
							if (item.pinned) pinnedChatIds[item.chatId] = true;
						});
					}
					var earliest = null;
					result.messages.forEach(function (msg) {
						if (pinnedChatIds[msg.chat_id]) return;
						if (earliest === null || msg.date < earliest) {
							earliest = msg.date;
						}
					});
					if (earliest) {
						state.lastMessageDate = earliest;
					}
				}

				return updateModels(result).then(function () {
					updateCrmBadge();
				});
			})
			.catch(function (error) {
				log('Load error: ' + (error && error.message || JSON.stringify(error)));
				state.hasMoreItems = false;
				state.isLoading = false;
				return Promise.resolve();
			});
	}

	function updateModels(result) {
		var store = getStore();
		if (!store) return Promise.resolve();

		var promises = [];

		// Merge counters from recentItems into chats
		if (result.chats) {
			var chatsToStore = result.chats;
			if (result.recentItems) {
				var chatMap = {};
				chatsToStore.forEach(function (chat) { chatMap[chat.id] = chat; });
				result.recentItems.forEach(function (item) {
					if (item.counter > 0 && item.chatId && chatMap[item.chatId]) {
						chatMap[item.chatId] = Object.assign({}, chatMap[item.chatId], { counter: item.counter });
					}
				});
				chatsToStore = Object.values(chatMap);
			}
			promises.push(store.dispatch('chats/set', chatsToStore));
		}

		if (result.users) {
			promises.push(store.dispatch('users/set', result.users));
		}
		if (result.messages) {
			promises.push(store.dispatch('messages/store', result.messages));
		}
		if (result.files) {
			promises.push(store.dispatch('files/set', result.files));
		}
		if (result.recentItems) {
			// Populate knownCrmDialogIds so badge updates and isDialogCrm work reliably.
			// recent/setRecent is never called for CRM sections, so dialogTypeCache stays empty.
			result.recentItems.forEach(function (item) {
				if (item.chatId) {
					knownCrmDialogIds['chat' + item.chatId] = true;
				}
			});
			promises.push(store.dispatch('recent/store', result.recentItems));
		}

		return Promise.all(promises);
	}

	// =========================================================
	// Collection getter for CRM tab
	// Uses chats/get (reliable after CRM data is loaded via updateModels
	// which dispatches chats/set with type 'crm')
	// =========================================================

	function getCrmDealCollection(store) {
		var collection = store.state.recent && store.state.recent.collection
			? store.state.recent.collection
			: {};
		var result = [];

		Object.keys(collection).forEach(function (dialogId) {
			if (isDialogCrm(store, dialogId)) {
				result.push(collection[dialogId]);
			}
		});

		return result;
	}

	// =========================================================
	// Phase 2: LegacyRecentService patch
	// =========================================================

	function patchService(LegacyRecentService) {
		var originalGetCollection = LegacyRecentService.prototype.getCollection;
		var originalLoadNextPage = LegacyRecentService.prototype.loadNextPage;

		LegacyRecentService.prototype.getCollection = function () {
			var layout = getCurrentLayoutName();
			if (layout === LAYOUT_NAME) {
				var store = getStore();
				if (store) {
					return getCrmDealCollection(store);
				}
			}
			var result = originalGetCollection.call(this);
			// Filter out CRM chats from the regular chat list
			if (layout === 'chat') {
				var store = getStore();
				if (store) {
					return result.filter(function (item) {
						return !isDialogCrm(store, item.dialogId);
					});
				}
			}
			return result;
		};

		LegacyRecentService.prototype.loadNextPage = function () {
			if (getCurrentLayoutName() === LAYOUT_NAME) {
				if (state.isLoading || !state.hasMoreItems) {
					return Promise.resolve();
				}
				return loadCrmDeals(false);
			}
			return originalLoadNextPage.call(this);
		};

		patchInstanceHasMore(LegacyRecentService);

		log('Patched LegacyRecentService');
		state.patched = true;
	}

	function patchInstanceHasMore(LegacyRecentService) {
		var instance = LegacyRecentService.getInstance();
		if (!instance) return;

		var origValue = instance.hasMoreItemsToLoad;
		Object.defineProperty(instance, 'hasMoreItemsToLoad', {
			get: function () {
				if (getCurrentLayoutName() === LAYOUT_NAME) {
					return state.hasMoreItems;
				}
				return origValue;
			},
			set: function (val) {
				origValue = val;
			},
			configurable: true,
		});
	}

	// =========================================================
	// Layout change watcher
	// =========================================================

	function watchLayout() {
		var store = getStore();
		if (!store) return;

		store.watch(
			function () {
				return store.state.application && store.state.application.layout;
			},
			function (newLayout) {
				if (!newLayout || newLayout.name !== LAYOUT_NAME) return;

				if (!state.firstPageLoaded) {
					loadCrmDeals(true).then(function () {
						state.firstPageLoaded = true;
						if (!newLayout.entityId) {
							autoSelectFirstChat();
						}
					});
				} else if (!newLayout.entityId) {
					autoSelectFirstChat();
				}
			},
			{ deep: true }
		);

		// Handle case when crmDeal layout is already active before watcher is registered
		var currentLayout = store.state.application && store.state.application.layout;
		if (currentLayout && currentLayout.name === LAYOUT_NAME) {
			if (!state.firstPageLoaded) {
				loadCrmDeals(true).then(function () {
					state.firstPageLoaded = true;
					if (!currentLayout.entityId) {
						autoSelectFirstChat();
					}
				});
			} else if (!currentLayout.entityId) {
				autoSelectFirstChat();
			}
		}
	}

	function autoSelectFirstChat() {
		var store = getStore();
		if (!store) return;

		var collection = getCrmDealCollection(store);
		if (collection.length === 0) {
			log('autoSelect: no CRM deal chats');
			return;
		}

		// Sort by date descending
		collection.sort(function (a, b) {
			var dateA = store.getters['recent/getSortDate'](a.dialogId);
			var dateB = store.getters['recent/getSortDate'](b.dialogId);
			return (dateB || 0) - (dateA || 0);
		});

		var lm = getLayoutManager();
		if (lm) {
			log('autoSelect: selecting ' + collection[0].dialogId);
			lm.setLayout({ name: LAYOUT_NAME, entityId: collection[0].dialogId });
		}
	}

	// =========================================================
	// Badge counter for the "CRM чаты" navigation menu item
	// =========================================================

	/**
	 * Returns all available navigation menu instances that may host the crmDeal counter.
	 * Handles both the standard 'chat-menu' layout and the collaboration sidebar.
	 */
	function getChatMenus() {
		var menus = [];
		try {
			var manager = window.BX && BX.Main && BX.Main.interfaceButtonsManager;
			if (manager) {
				var m1 = manager.getById('chat-menu');
				var m2 = manager.getById('top_menu_id_collaboration');
				if (m1) { menus.push(m1); }
				if (m2) { menus.push(m2); }
			}
		} catch (e) {}
		return menus;
	}

	/**
	 * Recomputes the total unread count for CRM chats and pushes it to
	 * the native navigation badge via menu.updateCounter('crmDeal', N).
	 *
	 * Why chats.collection instead of recent.collection:
	 *   - CRM chats (hasOwnRecentSection=true) are NOT in im.v2.Recent.Load
	 *   - PULL events skip 'crm' section → recent/setRecent is never called
	 *   - recent.collection.unread is NEVER updated for CRM chats via PULL
	 *   - BUT MessagePullHandler.#setMessageChat dispatches chats/set (type='crm')
	 *     and #updateDialog dispatches chats/update(counter) for every new message
	 *   - So chats.collection IS updated by PULL events even before CRM tab is visited
	 *
	 * Sources (in priority order):
	 *   1. store.state.chats.collection entries with type === 'crm' → use chat.counter
	 *   2. knownCrmDialogIds (from REST load) → use chats/get counter or recent.unread
	 */
	function updateCrmBadge() {
		var store = getStore();
		if (!store) { return; }

		var menus = getChatMenus();
		if (menus.length === 0) { return; }

		var totalCount = 0;
		var counted = {};
		var recentColl = store.state.recent && store.state.recent.collection;

		// Source 1: chats model — updated by PULL events via MessagePullHandler
		var chatsColl = store.state.chats && store.state.chats.collection;
		if (chatsColl) {
			Object.keys(chatsColl).forEach(function (dialogId) {
				var chat = chatsColl[dialogId];
				if (!chat || chat.type !== CRM_DEAL_CHAT_TYPE) { return; }
				counted[dialogId] = true;
				if (chat.counter > 0) {
					totalCount += chat.counter;
				} else if (recentColl && recentColl[dialogId] && recentColl[dialogId].unread) {
					totalCount += 1;
				}
			});
		}

		// Source 2: knownCrmDialogIds — from REST loading, handles items not yet in chats model
		Object.keys(knownCrmDialogIds).forEach(function (dialogId) {
			if (counted[dialogId]) { return; }
			var chat = null;
			try { chat = store.getters['chats/get'] && store.getters['chats/get'](dialogId); } catch (e) {}
			if (chat && chat.counter > 0) {
				totalCount += chat.counter;
			} else if (recentColl && recentColl[dialogId] && recentColl[dialogId].unread) {
				totalCount += 1;
			}
		});

		menus.forEach(function (menu) {
			menu.updateCounter('crmDeal', totalCount);
		});
		log('Badge updated: ' + totalCount + ' (chats: ' + Object.keys(counted).length + ', known: ' + Object.keys(knownCrmDialogIds).length + ')');
	}

	/**
	 * Subscribes to counter/recent changes and keeps the crmDeal badge in sync.
	 *
	 * Three triggers:
	 *   1. store.watch on chats.collection — THE PRIMARY TRIGGER.
	 *      PULL events update chats.collection via MessagePullHandler.#setMessageChat (type)
	 *      and #updateDialog (counter). This fires even before the CRM tab is visited.
	 *   2. store.watch on recent.collection.unread — backup for REST-loaded items where
	 *      counter=0 but unread=true (e.g. "marked unread" manually).
	 *   3. IM.Counters:onUpdate — backup for cases where standard counter fires alongside CRM.
	 *
	 * Why NOT watch recent.collection.unread as primary:
	 *   CRM sections are skipped by ActionNameByRecentType in RecentPullHandler →
	 *   recent/setRecent is never called for CRM → unread never set via PULL.
	 */
	function watchForBadgeUpdates(store) {
		// Trigger 1: watch chats.collection — fires when PULL events update CRM chat counter
		try {
			store.watch(
				function (storeState) {
					var chatsColl = storeState.chats && storeState.chats.collection;
					if (!chatsColl) { return 0; }
					var total = 0;
					Object.keys(chatsColl).forEach(function (dialogId) {
						var chat = chatsColl[dialogId];
						if (chat && chat.type === CRM_DEAL_CHAT_TYPE && chat.counter > 0) {
							total += chat.counter;
						}
					});
					return total;
				},
				function () { updateCrmBadge(); }
			);
		} catch (e) {}

		// Trigger 2: watch recent.collection for unread changes in known CRM items (backup)
		try {
			store.watch(
				function (storeState) {
					var recentColl = storeState.recent && storeState.recent.collection;
					if (!recentColl) { return 0; }
					var count = 0;
					Object.keys(knownCrmDialogIds).forEach(function (dialogId) {
						var item = recentColl[dialogId];
						if (item && item.unread) { count++; }
					});
					return count;
				},
				function () { updateCrmBadge(); }
			);
		} catch (e) {}

		// Trigger 3: IM.Counters:onUpdate — backup when standard counter fires
		try {
			var EventEmitter = window.BX && BX.Event && BX.Event.EventEmitter;
			if (EventEmitter) {
				EventEmitter.subscribe('IM.Counters:onUpdate', function () {
					setTimeout(updateCrmBadge, 0);
				});
			}
		} catch (e) {}
	}

	// =========================================================
	// Init
	// =========================================================

	function initRuntimePatches() {
		// Fast poll: backup in case Core trap missed action/mutation install
		var fastId = setInterval(function () {
			if (state.actionPatched && state.mutationPatched) { clearInterval(fastId); return; }
			var store = getStore();
			if (!store) return;
			if (!state.actionPatched) installActionPatch(store);
			if (!state.mutationPatched) installMutationPatch(store);
			if (state.actionPatched && state.mutationPatched) clearInterval(fastId);
		}, 50);
		setTimeout(function () { clearInterval(fastId); }, 10000);

		// Slower poll: LegacyRecentService patch + cleanup safety net + badge watcher
		var intervalId = setInterval(function () {
			if (state.patched) { clearInterval(intervalId); return; }

			var Service = window.BX
				&& BX.Messenger
				&& BX.Messenger.v2
				&& BX.Messenger.v2.Service;
			var store = getStore();

			if (!Service || !Service.LegacyRecentService || !store) return;

			clearInterval(intervalId);
			patchService(Service.LegacyRecentService);
			cleanCrmFromRecentCollection(store);
			watchLayout();
			watchForBadgeUpdates(store);
			updateCrmBadge();
		}, 500);
	}

	// Phase 1: Set up Core trap IMMEDIATELY (before bundles assign Core)
	setupCoreTrap();

	// Phase 2: Wait for runtime objects, then patch
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', initRuntimePatches);
	} else {
		initRuntimePatches();
	}
})();
