/*
 * Settings schema, defaults, presets and validation. Shared by the isolated
 * content script, the options page, the popup and the unit tests.
 */
(function (root) {
    'use strict';

    const KEY = 'settings';
    const LOCAL_KEY = `yvs:${KEY}`;
    const MAX_POINTS = 32;

    const DEFAULTS = Object.freeze({
        version: 1,
        enabled: true,
        curve: {
            type: 'logarithmic',
            dbRange: 40,
            exponent: 2.5,
            bezier: [0.55, 0.0, 0.9, 0.35],
            points: [
                [0, 0],
                [0.25, 0.03],
                [0.5, 0.12],
                [0.75, 0.4],
                [1, 1],
            ],
        },
        maxVolume: 100,
        appearance: {
            width: 100,
            trackHeight: 4,
            thumbSize: 13,
            radius: 4,
            trackColor: '#ffffff',
            trackOpacity: 0.3,
            fillColor: '#ffffff',
            thumbColor: '#ffffff',
            labelColor: '#ffffff',
            label: 'none', // none | position | output | db
            tooltip: true,
            expandOnHover: false,
        },
        behavior: {
            wheel: true,
            wheelStep: 5,
            arrowKeys: true,
            keyStep: 5,
            smoothingMs: 60,
        },
    });

    function preset(label, colors, shape) {
        return { label, appearance: { ...colors, ...shape } };
    }

    function palette(trackColor, trackOpacity, fillColor, thumbColor, labelColor) {
        return { trackColor, trackOpacity, fillColor, thumbColor, labelColor };
    }

    function shape(trackHeight, thumbSize, radius) {
        return { trackHeight, thumbSize, radius };
    }

    const PRESETS = {
        classic: preset(
            'Classic white',
            palette('#ffffff', 0.3, '#ffffff', '#ffffff', '#ffffff'),
            shape(4, 13, 4),
        ),
        red: preset(
            'Red accent',
            palette('#ffffff', 0.25, '#ff0033', '#ff0033', '#ffffff'),
            shape(4, 13, 4),
        ),
        neon: preset(
            'Neon',
            palette('#1de9b6', 0.2, '#1de9b6', '#e0fff7', '#1de9b6'),
            shape(6, 14, 6),
        ),
        sunset: preset(
            'Sunset',
            palette('#ffb36b', 0.25, '#ff7a45', '#ffd8a8', '#ffd8a8'),
            shape(5, 12, 3),
        ),
        minimal: preset(
            'Minimal',
            palette('#ffffff', 0.2, '#e6e6e6', '#ffffff', '#e6e6e6'),
            shape(2, 0, 0),
        ),
    };

    const LABELS = ['none', 'position', 'output', 'db'];
    const CURVES = ['logarithmic', 'power', 'linear', 'bezier', 'custom'];

    /* ------------------------------------------------------------ validators */

    function num(v, min, max, def) {
        const n = Number(v);
        if (!isFinite(n)) {
            return def;
        }
        return Math.min(max, Math.max(min, n));
    }

    function bool(v, def) {
        return typeof v === 'boolean' ? v : def;
    }

    function color(v, def) {
        return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : def;
    }

    function oneOf(v, list, def) {
        return list.includes(v) ? v : def;
    }

    function section(v) {
        return v && typeof v === 'object' ? v : {};
    }

    function round4(v) {
        return Math.round(v * 10000) / 10000;
    }

    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function isPoint(q) {
        return Array.isArray(q) && q.length >= 2 && isFinite(q[0]) && isFinite(q[1]);
    }

    function sanitizePoints(points, def) {
        if (!Array.isArray(points)) {
            return clone(def);
        }
        const pts = points
            .filter(isPoint)
            .slice(0, MAX_POINTS)
            .map((q) => [num(q[0], 0, 1, 0), num(q[1], 0, 1, 0)])
            .sort((a, b) => a[0] - b[0]);
        if (pts.length < 2) {
            return clone(def);
        }
        pts[0][0] = 0;
        pts[pts.length - 1][0] = 1;
        return pts.map((q) => q.map(round4));
    }

    function sanitizeCurve(input) {
        const c = section(input);
        const d = DEFAULTS.curve;
        const bezier = Array.isArray(c.bezier) && c.bezier.length === 4 ? c.bezier : d.bezier;
        return {
            type: oneOf(c.type, CURVES, d.type),
            dbRange: num(c.dbRange, 10, 90, d.dbRange),
            exponent: num(c.exponent, 0.2, 8, d.exponent),
            bezier: bezier.map((v, i) => num(v, 0, 1, d.bezier[i])),
            points: sanitizePoints(c.points, d.points),
        };
    }

    function sanitizeAppearance(input) {
        const a = section(input);
        const d = DEFAULTS.appearance;
        return {
            width: Math.round(num(a.width, 30, 400, d.width)),
            trackHeight: num(a.trackHeight, 1, 16, d.trackHeight),
            thumbSize: num(a.thumbSize, 0, 28, d.thumbSize),
            radius: num(a.radius, 0, 14, d.radius),
            trackColor: color(a.trackColor, d.trackColor),
            trackOpacity: num(a.trackOpacity, 0, 1, d.trackOpacity),
            fillColor: color(a.fillColor, d.fillColor),
            thumbColor: color(a.thumbColor, d.thumbColor),
            labelColor: color(a.labelColor, d.labelColor),
            label: oneOf(a.label, LABELS, d.label),
            tooltip: bool(a.tooltip, d.tooltip),
            expandOnHover: bool(a.expandOnHover, d.expandOnHover),
        };
    }

    function sanitizeBehavior(input) {
        const b = section(input);
        const d = DEFAULTS.behavior;
        return {
            wheel: bool(b.wheel, d.wheel),
            wheelStep: num(b.wheelStep, 0.5, 25, d.wheelStep),
            arrowKeys: bool(b.arrowKeys, d.arrowKeys),
            keyStep: num(b.keyStep, 0.5, 25, d.keyStep),
            smoothingMs: Math.round(num(b.smoothingMs, 0, 500, d.smoothingMs)),
        };
    }

    function sanitize(input) {
        const s = section(input);
        return {
            version: 1,
            enabled: bool(s.enabled, DEFAULTS.enabled),
            curve: sanitizeCurve(s.curve),
            maxVolume: num(s.maxVolume, 1, 100, DEFAULTS.maxVolume),
            appearance: sanitizeAppearance(s.appearance),
            behavior: sanitizeBehavior(s.behavior),
        };
    }

    /* --------------------------------------------------------------- storage */

    /* chrome.storage when running as an extension, otherwise localStorage
     * (used for the standalone preview / tests). */
    const chromeStore = {
        read: () =>
            new Promise((resolve) => {
                root.chrome.storage.sync.get(KEY, (r) => resolve(r && r[KEY]));
            }),
        write: (value) =>
            new Promise((resolve) => {
                root.chrome.storage.sync.set({ [KEY]: value }, resolve);
            }),
        subscribe: (cb) => {
            root.chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'sync' && changes[KEY]) {
                    cb(changes[KEY].newValue);
                }
            });
        },
    };

    const localStore = {
        read: async () => {
            try {
                return JSON.parse(root.localStorage.getItem(LOCAL_KEY) || 'null');
            } catch {
                return null;
            }
        },
        write: async (value) => {
            try {
                root.localStorage.setItem(LOCAL_KEY, JSON.stringify(value));
            } catch {
                // Storage may be unavailable (e.g. file:// in some browsers).
            }
        },
        subscribe: () => {},
    };

    function store() {
        try {
            return root.chrome?.storage?.sync ? chromeStore : localStore;
        } catch {
            return localStore;
        }
    }

    async function load() {
        return sanitize(await store().read());
    }

    async function save(settings) {
        const clean = sanitize(settings);
        await store().write(clean);
        return clean;
    }

    function onChange(cb) {
        store().subscribe((value) => cb(sanitize(value)));
    }

    const api = {
        DEFAULTS,
        PRESETS,
        LABELS,
        CURVES,
        KEY,
        sanitize,
        clone,
        load,
        save,
        onChange,
    };
    root.YVS_Settings = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis);
