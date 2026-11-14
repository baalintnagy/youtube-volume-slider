'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/shared/curves.js');

const cfgs = [
    { type: 'linear' },
    { type: 'logarithmic', dbRange: 40 },
    { type: 'logarithmic', dbRange: 80 },
    { type: 'power', exponent: 3 },
    { type: 'bezier', bezier: [0.55, 0, 0.9, 0.35] },
    { type: 'bezier', bezier: [0, 1, 0, 1] },
    {
        type: 'custom',
        points: [
            [0, 0],
            [0.25, 0.03],
            [0.5, 0.12],
            [0.75, 0.4],
            [1, 1],
        ],
    },
];

test('every curve is silent at 0, full at 1, bounded and monotonic', () => {
    for (const cfg of cfgs) {
        const f = C.makeCurve(cfg);
        assert.equal(f(0), 0, `${cfg.type} f(0)`);
        assert.ok(Math.abs(f(1) - 1) < 1e-6, `${cfg.type} f(1)=${f(1)}`);
        let prev = -1;
        for (let i = 0; i <= 1000; i++) {
            const y = f(i / 1000);
            assert.ok(y >= 0 && y <= 1, `${cfg.type} bounded`);
            assert.ok(y >= prev - 1e-9, `${cfg.type} monotonic at ${i}`);
            prev = y;
        }
    }
});

test('logarithmic 40 dB: mid-slider is about -21 dB', () => {
    const f = C.makeCurve({ type: 'logarithmic', dbRange: 40 });
    const db = C.toDb(f(0.5));
    assert.ok(db < -20 && db > -22, String(db));
});

test('power curve equals p^n', () => {
    const f = C.makeCurve({ type: 'power', exponent: 2 });
    assert.ok(Math.abs(f(0.5) - 0.25) < 1e-12);
});

test('linear bezier (0,0,1,1) is identity', () => {
    const f = C.makeCurve({ type: 'bezier', bezier: [0.25, 0.25, 0.75, 0.75] });
    for (const p of [0.1, 0.33, 0.5, 0.9]) {
        assert.ok(Math.abs(f(p) - p) < 1e-5, String(f(p)));
    }
});

test('custom curve passes through its points without overshoot', () => {
    const pts = [
        [0, 0],
        [0.3, 0.1],
        [0.6, 0.1],
        [1, 1],
    ];
    const f = C.makeCurve({ type: 'custom', points: pts });
    for (const [x, y] of pts.slice(1)) {
        assert.ok(Math.abs(f(x) - y) < 1e-9, `f(${x})=${f(x)}`);
    }
    for (let x = 0.3; x <= 0.6; x += 0.01) {
        assert.ok(Math.abs(f(x) - 0.1) < 1e-9, 'flat segment stays flat');
    }
});

test('custom curve tolerates unsorted / missing endpoints', () => {
    const f = C.makeCurve({
        type: 'custom',
        points: [
            [0.7, 0.5],
            [0.2, 0.1],
        ],
    });
    assert.equal(f(0), 0);
    assert.ok(f(1) >= 0.5);
});

test('invert finds the position for a given gain', () => {
    for (const cfg of cfgs) {
        const f = C.makeCurve(cfg);
        for (const y of [0.01, 0.2, 0.5, 0.9]) {
            const p = C.invert(f, y);
            // p is (numerically) the smallest position whose output reaches y
            assert.ok(f(p) >= y - 1e-6, `${cfg.type} invert(${y}) -> f(${p}) = ${f(p)}`);
            assert.ok(p < 1e-5 || f(p - 1e-5) <= y + 1e-6, `${cfg.type} invert(${y}) not minimal`);
        }
    }
});

test('toDb', () => {
    assert.equal(C.toDb(1), 0);
    assert.equal(C.toDb(0), -Infinity);
    assert.ok(Math.abs(C.toDb(0.1) + 20) < 1e-9);
});
