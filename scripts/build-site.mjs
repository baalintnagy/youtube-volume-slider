// Builds the GitHub Pages site into dist/site.
// Usage: node scripts/build-site.mjs
//
// Pages come from site/*.html with {{placeholders}}. privacy.html gets its body
// from PRIVACY.md, so the policy has a single source. Images are copied from
// store/ and icons/.
//
// Optional environment:
//   CWS_EXTENSION_ID   when set, the main button links to the Chrome Web Store item;
//                      otherwise it links to the GitHub releases page.
//   SITE_REPO_URL      overrides the repository URL (defaults to the GitHub repo).
//   SITE_URL           overrides the public site URL, used for absolute og:image links.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'site');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const repoUrl = process.env.SITE_REPO_URL || 'https://github.com/baalintnagy/youtube-volume-slider';
const siteUrl = process.env.SITE_URL || 'https://baalintnagy.github.io/youtube-volume-slider/';
const extensionId = (process.env.CWS_EXTENSION_ID || '').trim();
if (extensionId && !/^[a-p]{32}$/.test(extensionId)) {
    console.error(`CWS_EXTENSION_ID is not a valid extension ID: ${extensionId}`);
    process.exit(1);
}

const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- minimal Markdown (headings, paragraphs, lists, inline marks) ---------- */
function inline(text) {
    return escapeHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])_([^_]+)_(?=[\s).,:;!?]|$)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function markdown(src) {
    const html = [];
    let paragraph = [];
    let list = null;
    const flush = () => {
        if (paragraph.length) {
            html.push(`<p>${inline(paragraph.join(' '))}</p>`);
            paragraph = [];
        }
        if (list) {
            html.push(`<ul>${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
            list = null;
        }
    };
    for (const line of src.split(/\r?\n/)) {
        const heading = /^(#{1,6})\s+(.*)$/.exec(line);
        const item = /^\s*[-*]\s+(.*)$/.exec(line);
        if (heading) {
            flush();
            const level = heading[1].length;
            html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        } else if (item) {
            if (paragraph.length) {
                flush();
            }
            (list ||= []).push(item[1]);
        } else if (!line.trim()) {
            flush();
        } else if (list) {
            list[list.length - 1] += ` ${line.trim()}`;
        } else {
            paragraph.push(line.trim());
        }
    }
    flush();
    return html.join('\n');
}

/* ---------- render ---------- */
const vars = {
    name: escapeHtml(manifest.name),
    description: escapeHtml(manifest.description),
    version: escapeHtml(manifest.version),
    repoUrl: escapeHtml(repoUrl),
    siteUrl: escapeHtml(siteUrl),
    installUrl: extensionId
        ? `https://chromewebstore.google.com/detail/${extensionId}`
        : escapeHtml(`${repoUrl}/releases/latest`),
    installLabel: extensionId ? 'Add to Chrome' : 'Download the latest release',
    content: markdown(fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8')),
};

function render(template, file) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (!(key in vars)) {
            console.error(`${file}: unknown placeholder {{${key}}}`);
            process.exit(1);
        }
        return vars[key];
    });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });

const siteDir = path.join(ROOT, 'site');
for (const name of fs.readdirSync(siteDir)) {
    const src = path.join(siteDir, name);
    if (name.endsWith('.html')) {
        fs.writeFileSync(path.join(OUT, name), render(fs.readFileSync(src, 'utf8'), name));
    } else {
        fs.copyFileSync(src, path.join(OUT, name));
    }
}

const IMAGES = [
    'icons/icon128.png',
    'store/screenshot-1-log-curve.png',
    'store/screenshot-2-custom-curve.png',
    'store/screenshot-3-bezier.png',
    'store/promo-marquee-1400x560.png',
];
for (const rel of IMAGES) {
    fs.copyFileSync(path.join(ROOT, rel), path.join(OUT, 'images', path.basename(rel)));
}

// Every local href/src in the built pages must exist.
for (const name of fs.readdirSync(OUT).filter((n) => n.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(OUT, name), 'utf8');
    for (const m of html.matchAll(/(?:src|href|content)="([^"#:?]+\.(?:png|css|html))"/g)) {
        if (!fs.existsSync(path.join(OUT, m[1]))) {
            console.error(`${name} references missing ${m[1]}`);
            process.exit(1);
        }
    }
}

// GitHub Pages: serve files as-is, without Jekyll processing.
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log(`Built ${path.relative(ROOT, OUT)} (install link: ${vars.installUrl})`);
