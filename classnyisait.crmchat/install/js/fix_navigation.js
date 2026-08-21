/**
 * custom.crmchat — runtime patches for crmDeal layout support
 *
 * All patches are applied at runtime so we don't depend on modified
 * bitrix bundles. This script MUST load before the messenger Vue app
 * is created (loaded via Asset::addString in OnBeforeProlog).
 *
 * Patches:
 * 1. Messenger component — listComponent/contentComponent for crmDeal
 * 2. LayoutManager — isValidLayout, isChatLayout
 * 3. NavigationManager — open() handler for crmDeal
 * 4. RecentListContainer — onChatClick preserves crmDeal layout
 * 5. Menu active state fix (ChatMenu lowercases 'crmDeal' → 'crmdeal')
 * 6. Direct link support via ?IM_CRMDEAL
 */
(function () {
	'use strict';

	var MENU_ID = 'crmDeal';
	var CRM_CHAT_TYPE = 'crm';
	var GET_PARAM = 'IM_CRMDEAL';

	function log(msg) {
		if (window.LB_DEBUG) { try { console.log('[DealChat Nav] ' + msg); } catch (e) {} }
	}

	// =========================================================
	// 1. Patch Messenger component BEFORE Vue app compiles it
	// =========================================================
	// The Messenger component reads LayoutComponentMap[layoutName].
	// Since Layout.crmDeal may be undefined in frozen const,
	// the map key is 'undefined' instead of 'crmDeal'.
	// We patch listComponent/contentComponent to fall back to 'chat'.

	function patchMessengerComponent() {
		ensureNamespace('BX.Messenger.v2.Component');

		var patched = false;
		var ns = BX.Messenger.v2.Component;
		var prevDescriptor = Object.getOwnPropertyDescriptor(ns, 'Messenger');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var origMessenger = ns.Messenger;

		Object.defineProperty(ns, 'Messenger', {
			get: function () {
				return origMessenger;
			},
			set: function (val) {
				origMessenger = val;
				if (prevSetter) {
					prevSetter(val);
				}
				if (val && val.computed && !patched) {
					patched = true;
					applyMessengerPatch(val);
				}
			},
			configurable: true,
			enumerable: true
		});

		// If already set before our trap
		if (origMessenger && origMessenger.computed && !patched) {
			patched = true;
			applyMessengerPatch(origMessenger);
		}
	}

	function applyMessengerPatch(comp) {
		var origList = comp.computed.listComponent;
		var origContent = comp.computed.contentComponent;
		function withChatLayout(self) {
			return new Proxy(self, {
				get: function (target, prop) {
					if (prop === 'layoutName') return 'chat';
					return target[prop];
				}
			});
		}

		comp.computed.listComponent = function () {
			try {
				var result = origList.call(this);
				if (result) return result;
			} catch (e) {}
			// Fallback: if crmDeal layout has no entry, use chat's components
			if (this.layoutName === MENU_ID) {
				try {
					return origList.call(withChatLayout(this));
				} catch (e2) {}
			}
			return origList.call(this);
		};

		comp.computed.contentComponent = function () {
			try {
				var result = origContent.call(this);
				if (result) return result;
			} catch (e) {}
			if (this.layoutName === MENU_ID) {
				try {
					return origContent.call(withChatLayout(this));
				} catch (e2) {}
			}
			return origContent.call(this);
		};

		log('Messenger component patched (listComponent/contentComponent)');
	}

	// =========================================================
	// 2. Patch RecentListContainer — preserve crmDeal on click
	// =========================================================

	function patchRecentListContainer() {
		ensureNamespace('BX.Messenger.v2.Component.List');

		var patched = false;
		var ns = BX.Messenger.v2.Component.List;
		var prevDescriptor = Object.getOwnPropertyDescriptor(ns, 'RecentListContainer');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var origComp = ns.RecentListContainer;

		Object.defineProperty(ns, 'RecentListContainer', {
			get: function () {
				return origComp;
			},
			set: function (val) {
				origComp = val;
				if (prevSetter) {
					prevSetter(val);
				}
				if (val && val.methods && !patched) {
					patched = true;
					applyRecentContainerPatch(val);
				}
			},
			configurable: true,
			enumerable: true
		});

		if (origComp && origComp.methods && !patched) {
			patched = true;
			applyRecentContainerPatch(origComp);
		}
	}

	function applyRecentContainerPatch(comp) {
		var origOnChatClick = comp.methods.onChatClick;

		comp.methods.onChatClick = function (dialogId) {
			var currentLayout = this.$store.state.application.layout.name;
			if (currentLayout === MENU_ID) {
				this.$emit('selectEntity', {
					layoutName: MENU_ID,
					entityId: dialogId
				});
				return;
			}
			return origOnChatClick.call(this, dialogId);
		};

		log('RecentListContainer patched (onChatClick)');
	}

	// =========================================================
	// 3. Patch RecentItem — isChatSelected includes crmDeal
	// =========================================================

	function patchRecentItem() {
		ensureNamespace('BX.Messenger.v2.Component.List');

		var patched = false;
		var ns = BX.Messenger.v2.Component.List;
		var prevDescriptor = Object.getOwnPropertyDescriptor(ns, 'RecentItem');
		var prevSetter = prevDescriptor && prevDescriptor.set;
		var origComp = ns.RecentItem;

		Object.defineProperty(ns, 'RecentItem', {
			get: function () {
				return origComp;
			},
			set: function (val) {
				origComp = val;
				if (prevSetter) {
					prevSetter(val);
				}
				if (val && val.computed && val.computed.isChatSelected && !patched) {
					patched = true;
					applyRecentItemPatch(val);
				}
			},
			configurable: true,
			enumerable: true
		});

		if (origComp && origComp.computed && origComp.computed.isChatSelected && !patched) {
			patched = true;
			applyRecentItemPatch(origComp);
		}
	}

	function applyRecentItemPatch(comp) {
		var origIsChatSelected = comp.computed.isChatSelected;

		comp.computed.isChatSelected = function () {
			// Check if crmDeal layout and matching dialogId
			if (this.layout && this.layout.name === MENU_ID) {
				return this.layout.entityId === this.recentItem.dialogId;
			}
			return origIsChatSelected.call(this);
		};

		log('RecentItem patched (isChatSelected)');
	}

	// =========================================================
	// 4. Patch LayoutManager — isValidLayout, isChatLayout
	// =========================================================

	function patchLayoutManager() {
		var lib = getLib();
		if (!lib || !lib.LayoutManager) return false;

		var proto = lib.LayoutManager.prototype;

		if (!proto.__crmDealPatched) {
			proto.__crmDealPatched = true;

			var origIsValid = proto.isValidLayout;
			proto.isValidLayout = function (name) {
				if (name === MENU_ID) return true;
				return origIsValid.call(this, name);
			};

			var origIsChatLayout = proto.isChatLayout;
			proto.isChatLayout = function (name) {
				if (name === MENU_ID) return true;
				return origIsChatLayout.call(this, name);
			};

			// Patch setLayout: redirect CRM chats to crmDeal layout
			var origSetLayout = proto.setLayout;
			proto.setLayout = function (payload) {
				if (payload && payload.name !== MENU_ID && payload.entityId) {
					try {
						var store = BX.Messenger.v2.Application.Core.getStore();
						if (store) {
							var dialog = store.getters['chats/get'](payload.entityId);
							if (dialog && dialog.type === CRM_CHAT_TYPE) {
								log('Redirecting CRM chat ' + payload.entityId + ' to crmDeal layout');
								payload = Object.assign({}, payload, { name: MENU_ID });
							}
						}
					} catch (e) {}
				}
				return origSetLayout.call(this, payload);
			};

			log('LayoutManager patched (isValidLayout, isChatLayout, setLayout)');
		}
		return true;
	}

	// =========================================================
	// 5. Patch NavigationManager.open — handle crmDeal click
	// =========================================================

	function patchNavigationManager() {
		var lib = getLib();
		if (!lib || !lib.NavigationManager) return false;

		var nm = lib.NavigationManager;
		if (nm.__crmDealPatched) return true;
		nm.__crmDealPatched = true;

		var origOpen = nm.open.bind(nm);
		nm.open = function (payload) {
			var payloadId = payload && typeof payload.id === 'string' ? payload.id.toLowerCase() : '';
			if (payloadId === MENU_ID.toLowerCase()) {
				log('NavigationManager.open intercepted for crmDeal');
				// Ensure LayoutManager is patched
				patchLayoutManager();
				var lm = getLayoutManager();
				if (lm) {
					var entityId = payload.entityId || '';
					// Restore last opened chat if no specific entity requested
					if (!entityId && typeof lm.getLastOpenedElement === 'function') {
						entityId = lm.getLastOpenedElement(MENU_ID) || '';
					}
					lm.setLayout({ name: MENU_ID, entityId: entityId });
				}
				return;
			}
			return origOpen(payload);
		};

		log('NavigationManager patched (open)');
		return true;
	}

	// =========================================================
	// 6. Fix menu active state
	// =========================================================

	function initMenuFix() {
		try {
			var EventEmitter = BX.Event && BX.Event.EventEmitter;
			if (!EventEmitter) return false;

			EventEmitter.subscribe('IM.Layout:onLayoutChange', function (event) {
				var data = event.getData();
				if (!data || !data.to) return;

				var toName = data.to.name;
				var fromName = data.from ? data.from.name : '';

				if (toName === MENU_ID) {
					setTimeout(function () {
						var chatMenu = getChatMenu();
						if (chatMenu) {
							chatMenu.setActive(MENU_ID);
						}
					}, 0);
				}

				if (fromName === MENU_ID) {
					setTimeout(function () {
						var chatMenu = getChatMenu();
						if (chatMenu) {
							chatMenu.unsetActive(MENU_ID);
						}
					}, 0);
				}
			});

			log('Menu active state fix initialized');
			return true;
		} catch (e) {
			return false;
		}
	}

	// =========================================================
	// 7. Direct link support: /online/?IM_CRMDEAL
	// =========================================================

	function handleDirectLink() {
		if (window.location.search.indexOf(GET_PARAM) === -1) return;

		log('GET param detected, will activate crmDeal on load');

		var tryActivate = function () {
			var lm = getLayoutManager();
			if (!lm) {
				setTimeout(tryActivate, 300);
				return;
			}
			patchLayoutManager();
			lm.setLayout({ name: MENU_ID, entityId: '' });
			log('crmDeal activated via direct link');
		};

		setTimeout(tryActivate, 500);
	}

	// =========================================================
	// Helpers
	// =========================================================

	function ensureNamespace(path) {
		var parts = path.split('.');
		var obj = window;
		for (var i = 0; i < parts.length; i++) {
			obj[parts[i]] = obj[parts[i]] || {};
			obj = obj[parts[i]];
		}
		return obj;
	}

	function getLib() {
		try {
			return BX.Messenger.v2.Lib;
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

	function getChatMenu() {
		try {
			var manager = BX.Main.interfaceButtonsManager;
			return manager ? manager.getById('chat-menu') : null;
		} catch (e) {
			return null;
		}
	}

	// =========================================================
	// Init
	// =========================================================

	// Phase 1: Set up property traps IMMEDIATELY (before bundles load)
	patchMessengerComponent();
	patchRecentListContainer();
	patchRecentItem();

	// Phase 2: Wait for runtime objects, then patch
	function initRuntimePatches() {
		var done = { lm: false, nm: false, menu: false };

		var intervalId = setInterval(function () {
			if (!done.lm) done.lm = patchLayoutManager();
			if (!done.nm) done.nm = patchNavigationManager();
			if (!done.menu) done.menu = initMenuFix();

			if (done.lm && done.nm && done.menu) {
				clearInterval(intervalId);
				log('All runtime patches applied');
			}
		}, 300);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', function () {
			initRuntimePatches();
			handleDirectLink();
		});
	} else {
		initRuntimePatches();
		handleDirectLink();
	}
})();
