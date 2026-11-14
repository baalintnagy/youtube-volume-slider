/*
 * Display helpers shared by the page-world content script and the options
 * page: volume/dB text and colour parsing.
 */
(function (root) {
    'use strict';

    function percent(v) {
        if (v <= 0) {
            return '0%';
        }
        if (v >= 9.95) {
            return `${Math.round(v)}%`;
        }
        return `${v.toFixed(v >= 1 ? 1 : 2)}%`;
    }

    function decibels(gain) {
        if (!(gain > 0)) {
            return '−∞ dB';
        }
        const db = 20 * Math.log10(gain);
        if (!isFinite(db)) {
            return '−∞ dB';
        }
        if (db > -0.05) {
            return '0 dB';
        }
        return `−${Math.abs(db).toFixed(1)} dB`;
    }

    function position(p) {
        return `${Math.round(p * 100)}%`;
    }

    const LABEL_FORMATTERS = {
        none: () => '',
        position: (p) => position(p),
        output: (_, gain) => percent(gain * 100),
        db: (_, gain) => decibels(gain),
    };

    /** Slider label and tooltip text for position p producing the given gain. */
    function sliderText(p, gain, labelMode) {
        const label = Object.hasOwn(LABEL_FORMATTERS, labelMode)
            ? LABEL_FORMATTERS[labelMode](p, gain)
            : '';
        return { label, tooltip: `${position(p)}  ·  ${decibels(gain)}` };
    }

    /** Parses '#rrggbb' into [r, g, b], or returns null. */
    function hexToRgb(hex) {
        const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
        return m ? m.slice(1).map((h) => parseInt(h, 16)) : null;
    }

    const api = { percent, decibels, position, sliderText, hexToRgb };
    root.YVS_Format = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis);
