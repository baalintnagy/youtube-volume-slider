/*
 * Isolated-world content script. The page-world script (main.js) cannot use
 * chrome.* APIs, so this bridge loads settings / the saved slider position from
 * chrome.storage and relays them over DOM CustomEvents (string payloads only).
 */
(function () {
    'use strict';

    const S = globalThis.YVS_Settings;
    const POSITION_KEY = 'position';
    const SAVE_DELAY_MS = 400;

    let state = null; // { settings, position }
    let saveTimer = 0;
    let pendingPosition = null;

    function isExtensionAlive() {
        try {
            return Boolean(chrome.runtime?.id);
        } catch {
            return false;
        }
    }

    function send(payload) {
        document.dispatchEvent(new CustomEvent('yvs:state', { detail: JSON.stringify(payload) }));
    }

    function loadAll() {
        chrome.storage.sync.get(S.KEY, (syncResult) => {
            chrome.storage.local.get(POSITION_KEY, (localResult) => {
                const stored = localResult?.[POSITION_KEY];
                state = {
                    settings: S.sanitize(syncResult?.[S.KEY]),
                    position: typeof stored === 'number' ? stored : null,
                };
                send(state);
            });
        });
    }

    function flush() {
        if (pendingPosition === null || !isExtensionAlive()) {
            return;
        }
        const value = pendingPosition;
        pendingPosition = null;
        try {
            chrome.storage.local.set({ [POSITION_KEY]: value });
        } catch {
            // The extension context was invalidated (e.g. reloaded).
        }
    }

    function onSavePosition(e) {
        const p = Number(e.detail);
        if (!isFinite(p) || p < 0 || p > 1) {
            return;
        }
        pendingPosition = Math.round(p * 100000) / 100000;
        if (state) {
            state.position = pendingPosition;
        }
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, SAVE_DELAY_MS);
    }

    function onStorageChanged(changes, area) {
        if (area !== 'sync' || !changes[S.KEY]) {
            return;
        }
        const settings = S.sanitize(changes[S.KEY].newValue);
        if (state) {
            state.settings = settings;
        }
        send({ settings });
    }

    document.addEventListener('yvs:hello', () => {
        if (state) {
            send(state);
        }
    });
    document.addEventListener('yvs:save-position', onSavePosition);
    window.addEventListener('pagehide', flush);
    chrome.storage.onChanged.addListener(onStorageChanged);
    loadAll();
})();
