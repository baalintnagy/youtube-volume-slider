// Renders the options page (standalone, localStorage-backed) to store screenshots.
// Run: node scripts/screenshots.mjs   (set CHROME_PATH if needed)
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = `file://${path.join(ROOT, 'src/options/options.html')}`;
const launch = process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' };
const browser = await chromium.launch(launch);
const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

async function shot(name, settings, pos) {
    await page.goto(url);
    await page.evaluate((s) => localStorage.setItem('yvs:settings', JSON.stringify(s)), settings);
    await page.reload();
    await page.waitForTimeout(300);
    if (pos !== undefined) {
        const box = await page.locator('#previewHost .yvs-track').boundingBox();
        await page.mouse.click(box.x + box.width * pos, box.y + box.height / 2);
        await page.mouse.move(box.x + box.width * pos, box.y + box.height / 2);
        await page.waitForTimeout(200);
    }
    await page.screenshot({ path: path.join(ROOT, 'store', name) });
}

await shot(
    'screenshot-1-log-curve.png',
    { curve: { type: 'logarithmic', dbRange: 40 }, appearance: { width: 160, label: 'db' } },
    0.55,
);
await shot(
    'screenshot-2-custom-curve.png',
    {
        curve: {
            type: 'custom',
            points: [
                [0, 0],
                [0.2, 0.01],
                [0.45, 0.06],
                [0.7, 0.25],
                [0.88, 0.55],
                [1, 1],
            ],
        },
        appearance: {
            width: 220,
            trackHeight: 6,
            thumbSize: 14,
            radius: 6,
            trackColor: '#1de9b6',
            trackOpacity: 0.2,
            fillColor: '#1de9b6',
            thumbColor: '#e0fff7',
            labelColor: '#1de9b6',
            label: 'output',
        },
    },
    0.7,
);
await shot(
    'screenshot-3-bezier.png',
    {
        curve: { type: 'bezier', bezier: [0.6, 0.02, 0.85, 0.3] },
        appearance: { width: 120, fillColor: '#ff0033', thumbColor: '#ff0033', label: 'position' },
    },
    0.4,
);
await browser.close();
if (errors.length) {
    console.error(errors);
    process.exit(1);
}
console.log('screenshots written to store/');
