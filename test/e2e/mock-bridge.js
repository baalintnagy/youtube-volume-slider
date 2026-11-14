// Stands in for bridge.js (no chrome.* here): answers hello with settings.
(function () {
    const S = window.YVS_Settings;
    const params = new URLSearchParams(location.search);
    const settings = S.sanitize(JSON.parse(params.get('settings') || '{}'));
    const pos = params.has('pos') ? Number(params.get('pos')) : null;
    window.savedPositions = [];
    window.mockSend = (payload) =>
        document.dispatchEvent(new CustomEvent('yvs:state', { detail: JSON.stringify(payload) }));
    document.addEventListener('yvs:hello', () => window.mockSend({ settings, position: pos }));
    document.addEventListener('yvs:save-position', (e) =>
        window.savedPositions.push(Number(e.detail)),
    );
    window.mockSettings = settings;
})();
