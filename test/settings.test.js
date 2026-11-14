'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/shared/settings.js');

test('sanitize(undefined) returns defaults', () => {
    assert.deepEqual(S.sanitize(undefined), JSON.parse(JSON.stringify(S.DEFAULTS)));
});

test('sanitize clamps and rejects bad values', () => {
    const s = S.sanitize({
        enabled: 'yes',
        curve: {
            type: 'nope',
            dbRange: 9999,
            bezier: [2, -1, 'x', 0.5],
            points: [
                [0.5, 2],
                [0.1, 0.1],
            ],
        },
        maxVolume: 500,
        appearance: { width: 5, fillColor: 'red', label: 'weird', trackOpacity: 3 },
        behavior: { smoothingMs: -10 },
    });
    assert.equal(s.enabled, true);
    assert.equal(s.curve.type, 'logarithmic');
    assert.equal(s.curve.dbRange, 90);
    assert.deepEqual(s.curve.bezier, [1, 0, S.DEFAULTS.curve.bezier[2], 0.5]);
    assert.deepEqual(s.curve.points, [
        [0, 0.1],
        [1, 1],
    ]);
    assert.equal(s.maxVolume, 100);
    assert.equal(s.appearance.width, 30);
    assert.equal(s.appearance.fillColor, S.DEFAULTS.appearance.fillColor);
    assert.equal(s.appearance.label, 'none');
    assert.equal(s.appearance.trackOpacity, 1);
    assert.equal(s.behavior.smoothingMs, 0);
});

test('sanitize is idempotent and JSON-small enough for chrome.storage.sync', () => {
    const s = S.sanitize({
        curve: { type: 'custom', points: Array.from({ length: 40 }, (_, i) => [i / 39, i / 39]) },
    });
    assert.deepEqual(S.sanitize(s), s);
    assert.equal(s.curve.points.length, 32);
    assert.ok(JSON.stringify(s).length < 8000);
});

test('presets only contain valid appearance keys', () => {
    for (const id of Object.keys(S.PRESETS)) {
        const merged = S.sanitize({ appearance: S.PRESETS[id].appearance });
        for (const k of Object.keys(S.PRESETS[id].appearance)) {
            assert.equal(merged.appearance[k], S.PRESETS[id].appearance[k], `${id}.${k}`);
        }
    }
});
