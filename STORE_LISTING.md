# Chrome Web Store listing: ready to paste

## Store listing tab

**Name** (from manifest): Volume Curve Slider for YouTube

**Summary** (from manifest, 126/132 chars):
Replace YouTube's volume slider with a customizable one: size, colors, and logarithmic, power, Bézier or custom volume curves.

**Category:** Tools. Alternative: Accessibility.

**Language:** English

**Description:**

```
YouTube's volume slider is linear, but your ears aren't. Most of the useful range ends up crammed into the bottom quarter of the slider: 10% is already loud, and fine control near silence is impossible.

Volume Curve Slider replaces YouTube's slider with one you can shape and style yourself.

VOLUME CURVES
• Logarithmic (dB): every step is the same number of decibels. You choose the dynamic range.
• Power (xⁿ): a simple, popular perceptual curve.
• Bézier: drag two handles to shape the curve.
• Custom points: draw your own curve on an interactive graph, with a dB view for precise control near silence.
• Linear: the classic behavior, if you ever want it back.
• Maximum-output cap.

APPEARANCE
• Any width from 30 to 400 px.
• Track height, handle size and corner radius.
• Fill, handle, track and label colors, plus track opacity.
• Optional label next to the slider: position %, real output % or dB.
• Hover tooltip, a YouTube-style "collapse until hovered" mode, and five presets.

SMOOTH, GLITCH-FREE AUDIO
• High-precision volume: not limited to YouTube's 1% steps.
• Changes are smoothly ramped, so there are no clicks while dragging.
• Keeps YouTube's loudness normalization.
• No volume jumps between videos or ads.

CONTROLS
• Drag, click, or use the mouse wheel or trackpad.
• ↑ / ↓ keys in the player move the new slider, with an on-screen readout.
• Mute button and the M key work as usual.
• Works in embedded YouTube players too.

PRIVATE BY DESIGN
No data collection, no analytics, no network requests. Settings sync through your own Chrome profile.

Not affiliated with YouTube or Google.
```

**Graphic assets** (in `store/`):

| Asset                         | File                                  | Size     |
| ----------------------------- | ------------------------------------- | -------- |
| Store icon                    | `icons/icon128.png`                   | 128×128  |
| Screenshot 1                  | `store/screenshot-1-log-curve.png`    | 1280×800 |
| Screenshot 2                  | `store/screenshot-2-custom-curve.png` | 1280×800 |
| Screenshot 3                  | `store/screenshot-3-bezier.png`       | 1280×800 |
| Small promo tile              | `store/promo-small-440x280.png`       | 440×280  |
| Marquee promo tile (optional) | `store/promo-marquee-1400x560.png`    | 1400×560 |

> Tip: add one real screenshot of the slider on a YouTube watch page. Use 1280×800, and crop or scale to fit. Reviewers and users like to see it in context.

## Privacy practices tab

**Single purpose:**

```
Replaces the YouTube video player's volume slider with a customizable slider that maps the slider position to volume through a user-selected curve.
```

**Permission justification: `storage`:**

```
Saves the user's slider appearance and volume-curve settings (chrome.storage.sync) and the last slider position (chrome.storage.local) so they persist between sessions. No other data is stored.
```

**Host permission justification** (content scripts on `https://www.youtube.com/*` and `https://www.youtube-nocookie.com/*`):

```
The extension must run on YouTube watch pages and embedded YouTube players to replace the player's volume slider and set the video element's volume. It does not run on any other site and does not read page content beyond the player's volume controls.
```

**Remote code:** No, I am not using remote code. All JavaScript is packaged in the extension.

**Data usage:** Check **none** of the data categories. Then certify all three statements:

- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** a public URL for `PRIVACY.md`. For example: `https://github.com/<you>/youtube-volume-slider/blob/main/PRIVACY.md`.

## Distribution tab

- Visibility: Public. You can choose Unlisted first for a soft launch.
- Regions: All regions.
- Pricing: Free.

## Trademark note

The name uses "for YouTube" only to say what the extension works with. Don't use the YouTube logo or the red play-button mark in the icon or the promo images. The supplied assets don't use them.
