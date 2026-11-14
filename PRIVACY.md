# Privacy Policy: Custom Volume Slider for YouTube

_Last updated: 14 November 2026_

Custom Volume Slider for YouTube ("the extension") does **not** collect, transmit, sell or share any personal data.

## What the extension stores

The extension uses Chrome's built-in `chrome.storage` API to save two things:

- **Your settings**: curve type and parameters, slider size and colors, and behavior options. These are stored in `chrome.storage.sync`. If Chrome Sync is turned on, Chrome syncs them across your own signed-in browsers.
- **The last slider position**: a single number between 0 and 1, stored in `chrome.storage.local` on your device.

Nothing else is stored. In particular, the extension does not store:

- the videos you watch
- your browsing history
- your account information

## Network access

The extension makes **no network requests**. It contains no analytics, tracking or advertising code, and it does not load remote code.

## Website access

The extension runs only on `www.youtube.com` and `www.youtube-nocookie.com` (embedded players). It needs this access for one purpose: to replace the volume slider in the video player and adjust the player's volume. It does not read or change page content beyond the video player's volume controls.

## Removing your data

Uninstalling the extension deletes all stored data. You can also reset everything at any time with **Settings → Backup → Reset to defaults**.

## Contact

Questions? [Open an issue](https://github.com/baalintnagy/youtube-volume-slider/issues) in the project's repository.
