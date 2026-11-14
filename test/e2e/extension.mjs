// Loads the real unpacked extension in Chrome and serves the mock player at
// https://www.youtube.com/watch (network is intercepted), so manifest, bridge,
// chrome.storage and the page-world script are all exercised together.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let html = fs.readFileSync(path.join(ROOT, 'test/e2e/mock-youtube.html'), 'utf8');
html = html
    .replace(/<link rel="stylesheet"[^>]*>/, '')
    .replace(/<script src="\.\.\/\.\.\/src[^>]*><\/script>\n?/g, '')
    .replace(/<script src="mock-bridge.js"><\/script>\n?/, '')
    .replace(
        '<script src="mock-player.js"></script>',
        `<script>${fs.readFileSync(path.join(ROOT, 'test/e2e/mock-player.js'), 'utf8')}</script>`,
    );

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yvs-'));
const launch = process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' };
const ctx = await chromium.launchPersistentContext(userDir, {
    ...launch,
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});
await ctx.route('https://www.youtube.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('https://www.youtube.com/watch?v=test');
await page.waitForSelector('.yvs-slider', { timeout: 10000 });
const r = await page.evaluate(() => ({
    ytVol: document.getElementById('movie_player').getVolume(),
    panel: getComputedStyle(document.querySelector('.ytp-volume-panel')).display,
    trackW: document.querySelector('.yvs-track').getBoundingClientRect().width,
}));
assert.equal(r.ytVol, 100);
assert.equal(r.panel, 'none');
assert.ok(r.trackW > 50, `styled by the extension CSS: ${r.trackW}`);

// Change the position, then reload: the position must persist via chrome.storage.local.
await page.focus('.yvs-slider');
await page.keyboard.press('Home');
for (let i = 0; i < 7; i++) {
    await page.keyboard.press('ArrowRight');
}
await page.waitForTimeout(800);
await page.reload();
await page.waitForSelector('.yvs-slider');
await page.waitForTimeout(300);
const aria = await page.getAttribute('.yvs-slider', 'aria-valuenow');
assert.equal(aria, '35', 'position restored after reload');

// Settings written by the options page reach the open tab live.
const extId = await (async () => {
    const p = await ctx.newPage();
    await p.goto('chrome://extensions');
    await p.waitForTimeout(300);
    const id = await p.evaluate(() => {
        const m = document.querySelector('extensions-manager');
        const items = m.shadowRoot
            .querySelector('extensions-item-list')
            .shadowRoot.querySelectorAll('extensions-item');
        return items[0] && items[0].id;
    });
    await p.close();
    return id;
})();
assert.ok(extId, 'extension id');
const opt = await ctx.newPage();
await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
await opt.waitForSelector('#curveSeg button');
await opt.click('#curveSeg button[data-type=linear]');
await opt.fill('input[data-path="appearance.width"]', '250');
await opt.dispatchEvent('input[data-path="appearance.width"]', 'input');
await page.waitForTimeout(800);
const live = await page.evaluate(() => {
    const v = document.querySelector('video');
    return {
        native: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume').get.call(v),
        width: document.querySelector('.yvs-track').getBoundingClientRect().width,
    };
});
assert.ok(Math.abs(live.native - 0.8 * 0.35) < 1e-4, `linear curve live: ${live.native}`);
assert.ok(Math.abs(live.width - 250) < 1, `width live: ${live.width}`);
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/src/popup/popup.html`);
await popup.waitForSelector('#curve option', { state: 'attached' });
await popup.waitForTimeout(200);
await popup.screenshot({ path: path.join(ROOT, 'test/e2e/popup.png') });

assert.deepEqual(errors, []);
await ctx.close();
console.log(`extension e2e: all checks passed (id ${extId})`);
