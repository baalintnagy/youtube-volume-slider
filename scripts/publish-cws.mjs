// Uploads a packaged zip to the Chrome Web Store (API v2) and submits it for review.
// Usage: node scripts/publish-cws.mjs <zip> [--upload-only]
//
// Environment (GitHub Actions secrets):
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   OAuth client + refresh token
//   CWS_PUBLISHER_ID                                     Developer Dashboard > Publisher > Settings
//   CWS_EXTENSION_ID                                     the item's 32-character ID
import fs from 'node:fs';

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATUS_POLL_MS = 5000;
const STATUS_POLL_ATTEMPTS = 24;
const REQUIRED_ENV = [
    'CWS_CLIENT_ID',
    'CWS_CLIENT_SECRET',
    'CWS_REFRESH_TOKEN',
    'CWS_PUBLISHER_ID',
    'CWS_EXTENSION_ID',
];

function fail(message) {
    console.error(`::error::${message}`);
    process.exit(1);
}

function readConfig(argv, env) {
    const zip = argv.find((a) => !a.startsWith('--'));
    if (!zip || !fs.existsSync(zip)) {
        fail(`Package not found: ${zip ?? '(no path given)'}`);
    }
    const missing = REQUIRED_ENV.filter((name) => !env[name]);
    if (missing.length) {
        fail(`Missing environment variables: ${missing.join(', ')}`);
    }
    return {
        zip,
        uploadOnly: argv.includes('--upload-only'),
        clientId: env.CWS_CLIENT_ID,
        clientSecret: env.CWS_CLIENT_SECRET,
        refreshToken: env.CWS_REFRESH_TOKEN,
        itemPath: `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`,
    };
}

async function request(url, init, what) {
    const response = await fetch(url, init);
    const text = await response.text();
    let body;
    try {
        body = text ? JSON.parse(text) : {};
    } catch {
        body = { raw: text };
    }
    if (!response.ok) {
        fail(`${what} failed (HTTP ${response.status}): ${JSON.stringify(body.error ?? body)}`);
    }
    return body;
}

async function accessToken(config) {
    const body = await request(
        TOKEN_URL,
        {
            method: 'POST',
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.clientId,
                client_secret: config.clientSecret,
                refresh_token: config.refreshToken,
            }),
        },
        'OAuth token refresh',
    );
    return body.access_token;
}

async function waitForUpload(config, headers) {
    for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
        const status = await request(
            `${API}/v2/${config.itemPath}:fetchStatus`,
            { headers },
            'Status check',
        );
        if (status.lastAsyncUploadState !== 'IN_PROGRESS') {
            return status.lastAsyncUploadState;
        }
    }
    return 'IN_PROGRESS';
}

async function upload(config, headers) {
    const result = await request(
        `${API}/upload/v2/${config.itemPath}:upload`,
        { method: 'POST', headers, body: fs.readFileSync(config.zip) },
        'Upload',
    );
    const state =
        result.uploadState === 'IN_PROGRESS'
            ? await waitForUpload(config, headers)
            : result.uploadState;
    if (state !== 'SUCCEEDED') {
        fail(`Upload did not succeed (state ${state}): ${JSON.stringify(result)}`);
    }
    console.log(`Uploaded ${config.zip} (version ${result.crxVersion ?? 'unknown'})`);
}

async function publish(config, headers) {
    const result = await request(
        `${API}/v2/${config.itemPath}:publish`,
        {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH' }),
        },
        'Publish',
    );
    (result.warningInfo?.warnings ?? []).forEach((w) => {
        console.log(`::warning::${w.reason}: ${w.description}`);
    });
    console.log(`Submitted for review: ${result.state ?? 'state unknown'}`);
}

const config = readConfig(process.argv.slice(2), process.env);
const headers = { Authorization: `Bearer ${await accessToken(config)}` };
await upload(config, headers);
if (config.uploadOnly) {
    console.log('Upload only: not submitted for review.');
} else {
    await publish(config, headers);
}
