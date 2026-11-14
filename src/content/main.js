/*
 * Page-world content script: replaces YouTube's volume slider and applies the
 * selected volume curve. YouTube's own volume is pinned at 100; the audible
 * gain is applied per <video> element by VolumeGain (see gain.js).
 */
(function () {
    'use strict';

    if (window.__yvsMainLoaded) {
        return;
    }
    window.__yvsMainLoaded = true;

    const C = window.YVS_Curves;
    const F = window.YVS_Format;
    const Slider = window.YVS_Slider;
    const VolumeGain = window.YVS_VolumeGain;
    if (!C || !F || !Slider || !VolumeGain) {
        return;
    }

    const { clamp01 } = C;
    const PLAYER = '.html5-video-player';
    const SCAN_DELAY_MS = 120;
    const SAFETY_SCAN_MS = 2500;
    const OSD_MS = 900;
    const PLAYER_SETTLE_MS = 1500;
    const MAX_EXTERNAL_STEP = 0.2;
    const isEmbed =
        location.pathname.startsWith('/embed/') ||
        location.hostname.includes('youtube-nocookie.com');

    let settings = null;
    let gainFn = (p) => p;
    let position = null; // slider position 0..1 (null until known)
    let gotInitialState = false;
    let active = false;

    const players = new Map(); // player element -> PlayerState
    let observer = null;
    let scanTimer = 0;
    let safetyTimer = 0;

    const gain = new VolumeGain({
        smoothingMs: () => (settings ? settings.behavior.smoothingMs : 0),
        onVolumeChange: (video) => playerStateOf(video)?.slider?.setMuted(video.muted),
    });

    function safe(fn, fallback) {
        try {
            return fn();
        } catch {
            return fallback;
        }
    }

    function playerOf(el) {
        return el?.closest?.(PLAYER) || null;
    }

    function playerStateOf(el) {
        const pl = playerOf(el);
        return pl ? players.get(pl) : undefined;
    }

    function shouldGain(video) {
        if (!isEmbed) {
            return true;
        }
        return players.has(playerOf(video));
    }

    function trackIfNeeded(video) {
        if (shouldGain(video)) {
            gain.track(video);
        }
    }

    /* -------------------------------------------------------------- position */

    function setPosition(p, source) {
        position = clamp01(p);
        players.forEach((ps) => {
            if (ps.slider && ps.slider.value !== position) {
                ps.slider.setValue(position);
            }
        });
        gain.setTarget(gainFn(position), source === 'init');
    }

    function savePosition() {
        if (position === null) {
            return;
        }
        document.dispatchEvent(new CustomEvent('yvs:save-position', { detail: String(position) }));
    }

    function unmuteIfNeeded(pl) {
        const video = pl.querySelector('video');
        const muted = safe(
            () => (typeof pl.isMuted === 'function' ? pl.isMuted() : video?.muted),
            false,
        );
        if (!muted) {
            return;
        }
        if (typeof pl.unMute === 'function') {
            safe(() => pl.unMute());
        } else if (video) {
            video.muted = false;
        }
    }

    function userSet(pl, p, source) {
        if (p > 0) {
            unmuteIfNeeded(pl);
        }
        setPosition(p, source);
    }

    function format(p) {
        return F.sliderText(p, gainFn(p), settings.appearance.label);
    }

    /* --------------------------------------------------------------- players */

    function isPlayerReady(pl) {
        return typeof pl.setVolume === 'function' && typeof pl.getVolume === 'function';
    }

    function pinYouTubeVolume(pl) {
        safe(() => {
            if (pl.getVolume() !== 100) {
                pl.setVolume(100);
            }
        });
    }

    function adoptPlayer(pl) {
        const area = pl.querySelector('.ytp-volume-area');
        if (!area || !isPlayerReady(pl)) {
            return;
        }
        let ps = players.get(pl);
        if (!ps) {
            ps = createPlayerState(pl);
        }
        if (!ps.slider || !ps.slider.el.isConnected || ps.area !== area) {
            mountSlider(pl, ps, area);
        }
    }

    function createPlayerState(pl) {
        const ps = { area: null, slider: null, osd: null, osdTimer: 0, adoptedAt: 0 };
        ps.adoptedAt = performance.now();
        ps.listener = (e) => onPlayerVolume(pl, ps, e);
        players.set(pl, ps);
        safe(() => pl.addEventListener('onVolumeChange', ps.listener));
        if (position === null) {
            // First run: start where YouTube's own slider was, at the same loudness.
            const ytVolume = Number(safe(() => pl.getVolume(), 100)) || 0;
            setPosition(C.invert(gainFn, ytVolume / 100), 'init');
            savePosition();
        }
        pinYouTubeVolume(pl);
        pl.querySelectorAll('video').forEach((v) => gain.track(v));
        return ps;
    }

    function releasePlayer(pl, restoreVolume) {
        const ps = players.get(pl);
        if (!ps) {
            return;
        }
        safe(() => pl.removeEventListener('onVolumeChange', ps.listener));
        if (restoreVolume && position !== null) {
            // Hand YouTube back the loudness of the curve in use.
            const g = gainFn(position);
            safe(() => pl.setVolume(g > 0 ? Math.max(1, Math.round(g * 100)) : 0));
        }
        ps.slider?.destroy();
        ps.osd?.remove();
        clearTimeout(ps.osdTimer);
        ps.area?.classList.remove('yvs-host');
        players.delete(pl);
    }

    function onPlayerVolume(pl, ps, e) {
        if (!active) {
            return;
        }
        const volume = typeof e?.volume === 'number' ? e.volume : safe(() => pl.getVolume(), 100);
        if (volume === 100) {
            return;
        }
        // Something inside YouTube changed its own volume (e.g. a shortcut we did
        // not intercept). Translate small steps into slider movement, then re-pin.
        const delta = (volume - 100) / 100;
        const settled = performance.now() - ps.adoptedAt > PLAYER_SETTLE_MS;
        if (settled && delta < 0 && delta >= -MAX_EXTERNAL_STEP && position !== null) {
            setPosition(position + delta, 'external');
            savePosition();
            ps.slider?.flash();
        }
        queueMicrotask(() => pinYouTubeVolume(pl));
    }

    function insertSlider(area, sliderEl) {
        const panel = area.querySelector('.ytp-volume-panel');
        const mute = area.querySelector('.ytp-mute-button');
        if (panel?.parentNode === area) {
            area.insertBefore(sliderEl, panel);
        } else if (mute?.parentNode === area) {
            area.insertBefore(sliderEl, mute.nextSibling);
        } else {
            area.appendChild(sliderEl);
        }
    }

    function mountSlider(pl, ps, area) {
        ps.slider?.destroy();
        const slider = new Slider({
            ariaLabel: 'Volume',
            onInput: (p, source) => userSet(pl, p, source),
            onCommit: savePosition,
            format,
            getStep: (kind) => Slider.stepFor(settings.behavior, kind),
        });
        slider.setAppearance(settings.appearance);
        slider.setValue(position ?? 1);
        insertSlider(area, slider.el);
        slider.setTooltipHost(pl.querySelector('.ytp-chrome-bottom') || pl);
        area.classList.add('yvs-host');
        ps.area = area;
        ps.slider = slider;
        slider.setMuted(pl.querySelector('video')?.muted);
    }

    function showOsd(pl, ps) {
        if (!ps.osd?.isConnected) {
            ps.osd = document.createElement('div');
            ps.osd.className = 'yvs-osd';
            pl.appendChild(ps.osd);
        }
        ps.osd.textContent = `Volume ${format(position).tooltip}`;
        ps.osd.classList.add('yvs-osd-show');
        clearTimeout(ps.osdTimer);
        ps.osdTimer = setTimeout(() => ps.osd?.classList.remove('yvs-osd-show'), OSD_MS);
    }

    /* -------------------------------------------------------------- keyboard */

    function isEditable(t) {
        if (t?.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
    }

    function playerForKey(target) {
        const fromTarget = playerOf(target);
        if (players.has(fromTarget)) {
            return fromTarget;
        }
        const fs = document.fullscreenElement;
        const fromFullscreen = fs && (fs.matches(PLAYER) ? fs : fs.querySelector(PLAYER));
        if (players.has(fromFullscreen)) {
            return fromFullscreen;
        }
        return isEmbed ? (players.keys().next().value ?? null) : null;
    }

    function isVolumeKey(e) {
        return (
            (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
            !(e.ctrlKey || e.altKey || e.metaKey || e.shiftKey)
        );
    }

    function onKeyDown(e) {
        if (!active || !settings.behavior.arrowKeys || !isVolumeKey(e)) {
            return;
        }
        const target = e.target;
        if (isEditable(target) || target?.closest?.('.yvs-slider')) {
            return; // text input, or the slider handles its own keys
        }
        const pl = playerForKey(target);
        if (!pl || position === null) {
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        const step = settings.behavior.keyStep / 100;
        userSet(pl, position + (e.key === 'ArrowUp' ? step : -step), 'key');
        savePosition();
        const ps = players.get(pl);
        if (ps) {
            ps.slider?.flash();
            showOsd(pl, ps);
        }
    }

    /* -------------------------------------------------------------- scanning */

    function scan() {
        if (!active) {
            return;
        }
        document.querySelectorAll(PLAYER).forEach(adoptPlayer);
        Array.from(players.keys())
            .filter((pl) => !pl.isConnected)
            .forEach((pl) => releasePlayer(pl, false));
        document.querySelectorAll('video').forEach(trackIfNeeded);
        gain.prune();
    }

    function scheduleScan() {
        if (scanTimer) {
            return;
        }
        scanTimer = setTimeout(() => {
            scanTimer = 0;
            scan();
        }, SCAN_DELAY_MS);
    }

    function onMutations(records) {
        const added = records
            .flatMap((r) => Array.from(r.addedNodes))
            .filter((n) => n.nodeType === Node.ELEMENT_NODE);
        // Track new <video> elements synchronously, before they can make a sound.
        added.forEach((n) => {
            if (n.nodeName === 'VIDEO') {
                trackIfNeeded(n);
            } else if (n.firstElementChild) {
                Array.from(n.getElementsByTagName('video')).forEach(trackIfNeeded);
            }
        });
        if (added.length) {
            scheduleScan();
        }
    }

    const NAVIGATION_EVENTS = ['yt-navigate-finish', 'yt-player-updated'];

    function start() {
        active = true;
        gain.reset(position === null ? 1 : gainFn(position));
        observer = new MutationObserver(onMutations);
        observer.observe(document.documentElement || document, { childList: true, subtree: true });
        window.addEventListener('keydown', onKeyDown, true);
        NAVIGATION_EVENTS.forEach((type) => document.addEventListener(type, scheduleScan));
        safetyTimer = setInterval(scan, SAFETY_SCAN_MS);
        scan();
    }

    function stop() {
        active = false;
        observer?.disconnect();
        observer = null;
        window.removeEventListener('keydown', onKeyDown, true);
        NAVIGATION_EVENTS.forEach((type) => document.removeEventListener(type, scheduleScan));
        clearInterval(safetyTimer);
        clearTimeout(scanTimer);
        scanTimer = 0;
        gain.untrackAll();
        Array.from(players.keys()).forEach((pl) => releasePlayer(pl, true));
    }

    /* -------------------------------------------------------------- settings */

    function isValidSettings(s) {
        return (
            s !== null &&
            typeof s === 'object' &&
            Boolean(s.curve && s.appearance && s.behavior) &&
            typeof s.maxVolume === 'number' &&
            typeof s.enabled === 'boolean'
        );
    }

    function refreshSliders() {
        players.forEach((ps) => {
            ps.slider?.setAppearance(settings.appearance);
            ps.slider?.refreshText();
        });
    }

    function applySettings(s) {
        // Disable first, so YouTube gets back the loudness of the curve in use.
        if (!s.enabled && active) {
            stop();
        }
        settings = s;
        const curve = C.makeCurve(s.curve);
        const max = clamp01(s.maxVolume / 100);
        gainFn = (p) => clamp01(curve(p) * max);
        if (s.enabled && !active) {
            start();
            return;
        }
        if (!active) {
            return;
        }
        refreshSliders();
        if (position !== null) {
            gain.setTarget(gainFn(position), false);
        }
    }

    function parseState(detail) {
        try {
            const d = JSON.parse(detail);
            return d && typeof d === 'object' ? d : null;
        } catch {
            return null;
        }
    }

    function isValidPosition(p) {
        return typeof p === 'number' && p >= 0 && p <= 1;
    }

    document.addEventListener('yvs:state', (e) => {
        const d = parseState(e.detail);
        if (!d) {
            return;
        }
        if (!gotInitialState && 'position' in d) {
            gotInitialState = true;
            if (isValidPosition(d.position)) {
                position = d.position;
            }
        }
        if (isValidSettings(d.settings)) {
            applySettings(d.settings);
        }
    });

    document.dispatchEvent(new CustomEvent('yvs:hello'));
})();
