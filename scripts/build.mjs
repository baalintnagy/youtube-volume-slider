// Packages the extension into dist/<name>-<version>.zip for the Chrome Web Store.
// No dependencies: writes a standard ZIP (deflate) with Node's zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
    console.error(
        `Version mismatch: manifest.json ${manifest.version} vs package.json ${pkg.version}`,
    );
    process.exit(1);
}

/* ---------- collect files ---------- */
const INCLUDE = [
    'manifest.json',
    'src',
    'icons/icon16.png',
    'icons/icon32.png',
    'icons/icon48.png',
    'icons/icon128.png',
];
const files = [];
function walk(rel) {
    const abs = path.join(ROOT, rel);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
        fs.readdirSync(abs)
            .sort()
            .forEach((n) => walk(path.posix.join(rel, n)));
    } else if (!/(^|\/)\.|\.map$/.test(rel)) {
        files.push(rel);
    }
}
INCLUDE.forEach(walk);

/* ---------- sanity: every file referenced by the manifest exists ---------- */
const referenced = new Set();
const add = (p) => p && referenced.add(p);
Object.values(manifest.icons || {}).forEach(add);
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(add);
add(manifest.action && manifest.action.default_popup);
add(manifest.options_page);
(manifest.content_scripts || []).forEach((cs) =>
    [...(cs.js || []), ...(cs.css || [])].forEach(add),
);
const missing = [...referenced].filter((p) => !files.includes(p));
if (missing.length) {
    console.error('Missing files referenced by manifest:', missing);
    process.exit(1);
}
// HTML pages: check local script/link/img references
for (const f of files.filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
        if (!files.includes(target)) {
            console.error(`${f} references missing ${m[1]}`);
            process.exit(1);
        }
    }
    if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) {
        console.error(`${f} contains an inline <script>, which MV3 CSP forbids`);
        process.exit(1);
    }
}

/* ---------- zip ---------- */
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) {
        c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
};
const DOS_TIME = 0; // fixed timestamp (1980-01-01) for reproducible builds
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const chunks = [];
const central = [];
let offset = 0;
for (const rel of files) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + body.length;
}
const centralBuf = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${pkg.name}-${manifest.version}.zip`);
fs.writeFileSync(out, Buffer.concat([...chunks, centralBuf, end]));
console.log(
    `Built ${path.relative(ROOT, out)} (${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(1)} KB)`,
);
files.forEach((f) => console.log(`  ${f}`));

// Unpacked copy for "Load unpacked" in chrome://extensions (local development).
const unpackedDir = path.join(outDir, 'unpacked');
fs.rmSync(unpackedDir, { recursive: true, force: true });
files.forEach((rel) => {
    const target = path.join(unpackedDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), target);
});
console.log(`Unpacked extension: ${path.relative(ROOT, unpackedDir)}`);
