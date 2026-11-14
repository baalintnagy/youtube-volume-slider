// End-to-end test of the page-world script against a mock YouTube player,
// in real Chrome. Run: npm run test:e2e   (set CHROME_PATH if Chrome isn't found)
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
};

const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const launch = process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' };
const browser = await chromium.launch({ ...launch, headless: true });
const results = [];
async function check(name, fn) {
    try {
        await fn();
        results.push(['ok', name]);
        console.log('ok   ', name);
    } catch (e) {
        results.push(['FAIL', name]);
        console.log('FAIL ', name, '\n      ', e.message.split('\n').join('\n       '));
    }
}

const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

async function open(query) {
    await page.goto(`${base}/test/e2e/mock-youtube.html?${query}`);
    await page.waitForSelector('.yvs-slider');
}
const state = () =>
    page.evaluate(() => {
        const v = document.querySelector('video');
        const native = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'volume',
        ).get.call(v);
        const s = document.querySelector('.yvs-slider');
        return {
            native,
            yt: v.volume,
            ytVol: document.getElementById('movie_player').getVolume(),
            aria: s && Number(s.getAttribute('aria-valuenow')),
            p: s && Number(getComputedStyle(s).getPropertyValue('--yvs-p')),
            panelDisplay: getComputedStyle(document.querySelector('.ytp-volume-panel')).display,
            muted: v.muted,
            mutedClass: s && s.classList.contains('yvs-muted'),
            saved: window.savedPositions.slice(-1)[0],
            ytKeyHits: window.ytKeyHits,
        };
    });
const gainAt = (p, cfg) =>
    page.evaluate(([p, cfg]) => window.YVS_Curves.makeCurve(cfg)(p), [p, cfg]);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const LOG40 = { type: 'logarithmic', dbRange: 40 };

/* ---------------------------------------------------------------- tests */
await page.goto(`${base}/test/e2e/mock-youtube.html`);
await page.evaluate(() => localStorage.setItem('mockYtVol', '60'));

await check('first run: takes over at the same loudness YouTube had (60%)', async () => {
    await open('');
    const s = await state();
    assert.equal(s.ytVol, 100, 'YouTube volume pinned to 100');
    near(s.native, 0.6 * 0.8, 1e-3, 'output loudness preserved');
    near(s.yt, 0.8, 1e-9, 'getter returns what YouTube wrote');
    assert.equal(s.panelDisplay, 'none', 'native slider hidden');
    assert.ok(s.saved > 0.5 && s.saved < 1, `initial position saved: ${s.saved}`);
});

await check('stored position is applied with the log curve', async () => {
    await open('pos=0.5');
    const s = await state();
    near(s.native, 0.8 * (await gainAt(0.5, LOG40)), 1e-6, 'native = norm * f(0.5)');
    assert.equal(s.aria, 50);
});

await check('YouTube loudness-normalization writes are respected instantly', async () => {
    await page.evaluate(() => (document.querySelector('video').volume = 0.5));
    const s = await state();
    near(s.yt, 0.5, 1e-9, 'getter');
    near(s.native, 0.5 * (await gainAt(0.5, LOG40)), 1e-6, 'native');
    await page.evaluate(() => (document.querySelector('video').volume = 0.8));
});

await check('dragging the slider moves smoothly (no jumps) and lands on the curve', async () => {
    const box = await page.locator('.yvs-track').boundingBox();
    await page.evaluate(() => {
        window.__samples = [];
        const v = document.querySelector('video');
        const g = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume').get;
        v.addEventListener('volumechange', () => window.__samples.push(g.call(v)));
        return true;
    });
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const s = await state();
    near(s.p, 0.9, 0.02, 'position');
    near(s.native, 0.8 * (await gainAt(s.p, LOG40)), 1e-5, 'native after settling');
    const sm = await page.evaluate(() => window.__samples);
    assert.ok(sm.length >= 4, `ramped over several frames: ${sm.length}`);
    for (let i = 1; i < sm.length; i++) {
        assert.ok(sm[i] >= sm[i - 1] - 1e-9, 'monotonic ramp');
    }
    assert.ok(s.saved > 0.85, 'position persisted on release');
});

await check('↑/↓ in the player move our slider and YouTube never sees them', async () => {
    await page.focus('#movie_player');
    const before = (await state()).p;
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    const s = await state();
    near(s.p, before - 0.1, 1e-6, 'two 5% steps down');
    assert.equal(s.ytKeyHits, 0, 'YouTube handler not reached');
    assert.equal(s.ytVol, 100);
    assert.ok(await page.locator('.yvs-osd').isVisible(), 'OSD shown');
});

await check('keyboard on the focused slider (←/→/Home/End)', async () => {
    await page.focus('.yvs-slider');
    await page.keyboard.press('Home');
    let s = await state();
    assert.equal(s.aria, 0);
    await page.waitForTimeout(250);
    s = await state();
    assert.equal(s.native, 0, 'silent at 0');
    await page.keyboard.press('ArrowRight');
    s = await state();
    assert.equal(s.aria, 5);
    await page.keyboard.press('End');
    await page.waitForTimeout(250);
    s = await state();
    near(s.native, 0.8, 1e-6, 'full at End');
});

await check('mouse wheel over the slider', async () => {
    const box = await page.locator('.yvs-track').boundingBox();
    await page.mouse.move(box.x + 10, box.y + 2);
    const before = (await state()).p;
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    near((await state()).p, before - 0.05, 1e-6, 'one notch = one 5% step');
});

await check('a volume change made inside YouTube is translated and re-pinned', async () => {
    await page.waitForTimeout(1500);
    const before = (await state()).p;
    await page.evaluate(() => document.getElementById('movie_player').setVolume(95));
    await page.waitForTimeout(50);
    const s = await state();
    near(s.p, before - 0.05, 1e-6, 'moved down 5%');
    assert.equal(s.ytVol, 100);
});

await check('mute state is shown and dragging unmutes', async () => {
    await page.click('#mute');
    await page.waitForTimeout(50); // volumechange is dispatched asynchronously
    let s = await state();
    assert.ok(s.muted && s.mutedClass, 'muted shown');
    const box = await page.locator('.yvs-track').boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.waitForTimeout(50);
    s = await state();
    assert.ok(!s.muted && !s.mutedClass, 'unmuted by slider');
});

await check(
    'live settings change: curve switch ramps to the new gain, appearance applies',
    async () => {
        await page.evaluate(() => {
            const s = JSON.parse(JSON.stringify(window.mockSettings));
            s.curve.type = 'linear';
            s.appearance.width = 180;
            s.appearance.label = 'db';
            window.mockSend({ settings: s });
        });
        await page.waitForTimeout(300);
        const s = await state();
        near(s.native, 0.8 * s.p, 1e-5, 'linear now');
        const w = await page.locator('.yvs-track').evaluate((e) => e.getBoundingClientRect().width);
        near(w, 180, 1, 'width');
        const label = await page.locator('.yvs-label').textContent();
        assert.match(label, /dB$/);
    },
);

await check('custom + bézier curves via settings', async () => {
    for (const curve of [
        {
            type: 'custom',
            points: [
                [0, 0],
                [0.5, 0.05],
                [1, 1],
            ],
        },
        { type: 'bezier', bezier: [0.6, 0, 0.9, 0.3] },
    ]) {
        await page.evaluate((curve) => {
            const s = JSON.parse(JSON.stringify(window.mockSettings));
            s.curve = Object.assign({}, s.curve, curve);
            s.behavior.smoothingMs = 0;
            window.mockSend({ settings: s });
        }, curve);
        const s = await state();
        near(s.native, 0.8 * (await gainAt(s.p, curve)), 1e-6, curve.type);
    }
});

await check(
    'disabling restores YouTube slider at the same loudness, re-enabling takes over again',
    async () => {
        const before = await state();
        await page.evaluate(() => {
            const s = JSON.parse(JSON.stringify(window.mockSettings));
            s.enabled = false;
            window.mockSend({ settings: s });
        });
        const s = await page.evaluate(() => {
            const v = document.querySelector('video');
            return {
                slider: Boolean(document.querySelector('.yvs-slider')),
                own: Object.prototype.hasOwnProperty.call(v, 'volume'),
                native: v.volume,
                ytVol: document.getElementById('movie_player').getVolume(),
                panel: getComputedStyle(document.querySelector('.ytp-volume-panel')).display,
            };
        });
        assert.equal(s.slider, false);
        assert.equal(s.own, false, 'property override removed');
        assert.notEqual(s.panel, 'none');
        near(s.native, before.native, 0.006, 'same loudness (YouTube integer %)');
        await page.evaluate(() => window.mockSend({ settings: window.mockSettings }));
        await page.waitForSelector('.yvs-slider');
        const s2 = await state();
        assert.equal(s2.ytVol, 100);
    },
);

await check('new <video> elements are patched before they can play', async () => {
    const r = await page.evaluate(async () => {
        const v = document.createElement('video');
        v.volume = 1;
        document.getElementById('movie_player').appendChild(v);
        await Promise.resolve();
        const native = Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'volume',
        ).get.call(v);
        return { own: Object.prototype.hasOwnProperty.call(v, 'volume'), native };
    });
    assert.equal(r.own, true);
    assert.ok(r.native < 1, `already attenuated: ${r.native}`);
});

await check('no page errors (Trusted Types enforced)', async () => {
    assert.deepEqual(errors, []);
});

await page.screenshot({
    path: path.join(ROOT, 'test/e2e/last-run.png'),
    clip: { x: 20, y: 470, width: 600, height: 110 },
});
await browser.close();
server.close();
const failed = results.filter((r) => r[0] !== 'ok').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
