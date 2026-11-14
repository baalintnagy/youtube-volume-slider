(function () {
    'use strict';

    const S = window.YVS_Settings;
    const C = window.YVS_Curves;
    const F = window.YVS_Format;
    const Slider = window.YVS_Slider;
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => Array.from(document.querySelectorAll(sel));

    const SAVE_DELAY_MS = 200;
    const SAVED_BADGE_MS = 1400;
    const TO_CUSTOM_XS = [0, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1];
    const EXPORT_FILENAME = 'volume-curve-slider-settings.json';

    let settings = S.clone(S.DEFAULTS);
    let previewPosition = 0.5;
    let saveTimer = 0;
    let savedTimer = 0;
    let lastSavedJson = '';

    /* ---------------------------------------------------------- path helpers */

    function getPath(obj, path) {
        return path.split('.').reduce((o, k) => o?.[k], obj);
    }

    function setPath(obj, path, value) {
        const keys = path.split('.');
        const last = keys.pop();
        keys.reduce((o, k) => o[k], obj)[last] = value;
    }

    /* ---------------------------------------------------------------- saving */

    function showSavedBadge() {
        const badge = $('#saved');
        badge.textContent = 'Saved';
        badge.classList.add('show');
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => badge.classList.remove('show'), SAVED_BADGE_MS);
    }

    async function persist() {
        const json = JSON.stringify(settings);
        if (json === lastSavedJson) {
            return;
        }
        lastSavedJson = json;
        await S.save(settings);
        showSavedBadge();
    }

    function commit(opts) {
        settings = S.sanitize(settings);
        render(opts);
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persist, SAVE_DELAY_MS);
    }

    /* ---------------------------------------------------------- form binding */

    function readInput(el) {
        if (el.type === 'checkbox') {
            return el.checked;
        }
        if (el.type === 'range' || el.type === 'number') {
            return parseFloat(el.value);
        }
        return el.value;
    }

    function bindInputs() {
        $$('[data-path]').forEach((el) => {
            const event = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(event, () => {
                const value = readInput(el);
                if (typeof value === 'number' && !isFinite(value)) {
                    return;
                }
                setPath(settings, el.dataset.path, value);
                commit({ skip: el });
            });
        });
    }

    function fillInputs(skip) {
        $$('[data-path]')
            .filter((el) => el !== skip)
            .forEach((el) => {
                const value = getPath(settings, el.dataset.path);
                if (el.type === 'checkbox') {
                    el.checked = Boolean(value);
                } else {
                    el.value = String(value);
                }
            });
        $$('output[data-out]').forEach((out) => {
            const value = getPath(settings, out.dataset.out);
            const shown = out.dataset.scale ? Math.round(value * Number(out.dataset.scale)) : value;
            out.textContent = `${shown}${out.dataset.unit || ''}`;
        });
    }

    /* ------------------------------------------------------------ curve type */

    function buildCurveSegment() {
        const seg = $('#curveSeg');
        C.TYPES.forEach((t) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = t.label;
            button.dataset.type = t.id;
            button.setAttribute('role', 'radio');
            button.addEventListener('click', () => {
                settings.curve.type = t.id;
                commit();
            });
            seg.appendChild(button);
        });
    }

    function bindCurveActions(editor) {
        const scaleButtons = $$('#scaleSeg button');
        scaleButtons.forEach((button) =>
            button.addEventListener('click', () => {
                scaleButtons.forEach((b) => b.classList.toggle('on', b === button));
                editor.setScale(button.dataset.scale);
            }),
        );
        $('#toCustom').addEventListener('click', () => {
            const fn = C.makeCurve(settings.curve);
            settings.curve.points = TO_CUSTOM_XS.map((x) => [x, C.round(fn(x), 4)]);
            settings.curve.type = 'custom';
            commit();
        });
        $('#resetPoints').addEventListener('click', () => {
            settings.curve.points = S.clone(S.DEFAULTS.curve.points);
            commit();
        });
    }

    /* --------------------------------------------------------------- presets */

    function presetButton(preset) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'preset';
        button.title = preset.label;
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.setProperty('--a', preset.appearance.fillColor);
        swatch.style.setProperty('--b', preset.appearance.trackColor);
        const text = document.createElement('span');
        text.textContent = preset.label;
        button.append(swatch, text);
        button.addEventListener('click', () => {
            Object.assign(settings.appearance, preset.appearance);
            commit();
        });
        return button;
    }

    function buildPresets() {
        $('#presets').append(...Object.values(S.PRESETS).map(presetButton));
    }

    /* --------------------------------------------------------------- preview */

    function gain(p) {
        return C.makeCurve(settings.curve)(p) * (settings.maxVolume / 100);
    }

    function updateReadout() {
        const g = gain(previewPosition);
        const output = F.percent(g * 100);
        $('#readout').textContent =
            `Slider at ${F.position(previewPosition)}  →  output ${output}  (${F.decibels(g)})`;
    }

    const slider = new Slider({
        ariaLabel: 'Preview volume',
        format: (p) => F.sliderText(p, gain(p), settings.appearance.label),
        onInput: (p) => {
            previewPosition = p;
            editor.setMarker(p);
            updateReadout();
        },
        getStep: (kind) => Slider.stepFor(settings.behavior, kind),
    });
    $('#previewHost').appendChild(slider.el);

    /* ---------------------------------------------------------------- editor */

    const editor = new window.YVS_CurveEditor($('#curveCanvas'), {
        onChange: (curve) => {
            settings.curve = curve;
            settings = S.sanitize(settings);
            fillInputs();
            slider.refreshText();
            updateReadout();
        },
        onCommit: (curve) => {
            settings.curve = curve;
            commit();
        },
    });

    /* ---------------------------------------------------------------- render */

    function render(opts = {}) {
        const type = settings.curve.type;
        fillInputs(opts.skip);
        $$('#curveSeg button').forEach((button) => {
            const on = button.dataset.type === type;
            button.classList.toggle('on', on);
            button.setAttribute('aria-checked', String(on));
        });
        $$('[data-for-curve]').forEach((el) => {
            el.hidden = el.dataset.forCurve !== type;
        });
        $('#toCustom').hidden = type === 'custom';
        document.body.classList.toggle('disabled', !settings.enabled);
        editor.setConfig(settings.curve, settings.maxVolume);
        editor.setMarker(previewPosition);
        slider.setAppearance(settings.appearance);
        slider.setValue(previewPosition);
        updateReadout();
    }

    /* ---------------------------------------------------------------- backup */

    function exportSettings() {
        const json = JSON.stringify(settings, null, 2);
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        link.download = EXPORT_FILENAME;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    async function importSettings(e) {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }
        try {
            settings = S.sanitize(JSON.parse(await file.text()));
            commit();
        } catch {
            alert('That file does not look like a settings export.');
        }
        e.target.value = '';
    }

    function resetSettings() {
        if (!confirm('Reset all settings to defaults?')) {
            return;
        }
        settings = S.clone(S.DEFAULTS);
        commit();
    }

    function bindBackup() {
        $('#exportBtn').addEventListener('click', exportSettings);
        $('#importBtn').addEventListener('click', () => $('#importFile').click());
        $('#importFile').addEventListener('change', importSettings);
        $('#resetBtn').addEventListener('click', resetSettings);
    }

    /* ------------------------------------------------------------------ init */

    function onStoredSettings(s) {
        const json = JSON.stringify(s);
        if (json === lastSavedJson) {
            return;
        }
        lastSavedJson = json;
        settings = s;
        render();
    }

    buildCurveSegment();
    bindCurveActions(editor);
    buildPresets();
    bindInputs();
    bindBackup();
    S.load().then(onStoredSettings);
    S.onChange(onStoredSettings);
    render();
})();
