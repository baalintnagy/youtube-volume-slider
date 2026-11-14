'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/shared/format.js');

test('percent picks precision by magnitude', () => {
    assert.equal(F.percent(0), '0%');
    assert.equal(F.percent(0.123), '0.12%');
    assert.equal(F.percent(5.55), '5.5%');
    assert.equal(F.percent(42.4), '42%');
});

test('decibels', () => {
    assert.equal(F.decibels(0), '−∞ dB');
    assert.equal(F.decibels(1), '0 dB');
    assert.equal(F.decibels(0.1), '−20.0 dB');
});

test('sliderText labels by mode', () => {
    assert.deepEqual(F.sliderText(0.5, 0.1, 'none'), { label: '', tooltip: '50%  ·  −20.0 dB' });
    assert.equal(F.sliderText(0.5, 0.1, 'position').label, '50%');
    assert.equal(F.sliderText(0.5, 0.1, 'output').label, '10%');
    assert.equal(F.sliderText(0.5, 0.1, 'db').label, '−20.0 dB');
    assert.equal(F.sliderText(0.5, 0.1, 'toString').label, '');
});

test('hexToRgb', () => {
    assert.deepEqual(F.hexToRgb('#ff8000'), [255, 128, 0]);
    assert.equal(F.hexToRgb('red'), null);
});
