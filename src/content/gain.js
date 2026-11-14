/*
 * Page-world audio gain. YouTube writes `video.volume = volume/100 *
 * loudnessNormalization`; this class overrides the `volume` property on each
 * tracked <video> element instance:
 *   - writes from YouTube are remembered (so its loudness normalization keeps
 *     working) and the element really plays `ytValue * gain`;
 *   - reads return YouTube's own value, so the player never notices and never
 *     "fights back" (no jitter, no feedback loops).
 * The gain is applied with full floating-point precision (not YouTube's 1%
 * integer steps) and is smoothed over a few milliseconds to avoid zipper noise.
 */
(function (root) {
    'use strict';

    const { clamp01 } = root.YVS_Curves;
    const descriptor = Object.getOwnPropertyDescriptor(root.HTMLMediaElement.prototype, 'volume');
    const nativeGet = descriptor.get;
    const nativeSet = descriptor.set;

    const MAX_FRAME_MS = 100;
    const SETTLE_ABSOLUTE = 1e-5;
    const SETTLE_RELATIVE = 0.002;

    class VolumeGain {
        /**
         * @param {object} opts
         *   smoothingMs()        current smoothing time in milliseconds
         *   onVolumeChange(v)    called on every 'volumechange' of a tracked video
         */
        constructor(opts) {
            this.opts = opts;
            this.states = new WeakMap(); // video -> { yt }
            this.videos = new Set();
            this.target = 1;
            this.current = 1;
            this._rafId = 0;
            this._lastFrame = 0;
            this._onVolumeChange = (e) => opts.onVolumeChange(e.target);
            this._step = (t) => this._animate(t);
        }

        /** Sets both the target and the applied gain without smoothing. */
        reset(gain) {
            this.target = gain;
            this.current = gain;
        }

        track(video) {
            if (this.states.has(video)) {
                this.videos.add(video);
                return;
            }
            const state = { yt: nativeGet.call(video) };
            this.states.set(video, state);
            const write = () => this._write(video, state);
            Object.defineProperty(video, 'volume', {
                configurable: true,
                enumerable: true,
                get() {
                    return state.yt;
                },
                set(value) {
                    const n = Number(value);
                    if (!(n >= 0 && n <= 1)) {
                        nativeSet.call(video, value); // throw the same error the browser would
                        return;
                    }
                    state.yt = n;
                    write();
                },
            });
            video.addEventListener('volumechange', this._onVolumeChange);
            this.videos.add(video);
            write();
        }

        untrack(video) {
            const state = this.states.get(video);
            if (!state) {
                return;
            }
            delete video.volume; // falls back to HTMLMediaElement.prototype accessor
            video.removeEventListener('volumechange', this._onVolumeChange);
            try {
                nativeSet.call(video, clamp01(state.yt));
            } catch {
                // The element may already be detached or in an error state.
            }
            this.states.delete(video);
            this.videos.delete(video);
        }

        untrackAll() {
            this.stopAnimation();
            Array.from(this.videos).forEach((v) => this.untrack(v));
        }

        /** Forgets videos that left the document (their override stays harmless). */
        prune() {
            Array.from(this.videos)
                .filter((v) => !v.isConnected)
                .forEach((v) => this.videos.delete(v));
        }

        setTarget(gain, immediate) {
            this.target = gain;
            if (immediate || this.opts.smoothingMs() <= 0 || root.document.hidden) {
                this.stopAnimation();
                this.current = gain;
                this._applyAll();
                return;
            }
            if (!this._rafId) {
                this._lastFrame = root.performance.now();
                this._rafId = root.requestAnimationFrame(this._step);
            }
        }

        stopAnimation() {
            if (this._rafId) {
                root.cancelAnimationFrame(this._rafId);
            }
            this._rafId = 0;
        }

        _animate(t) {
            this._rafId = 0;
            const dt = Math.max(0, Math.min(MAX_FRAME_MS, t - this._lastFrame));
            this._lastFrame = t;
            const tau = Math.max(1, this.opts.smoothingMs() / 4);
            this.current += (this.target - this.current) * (1 - Math.exp(-dt / tau));
            const settleBand = Math.max(SETTLE_ABSOLUTE, this.target * SETTLE_RELATIVE);
            if (Math.abs(this.target - this.current) <= settleBand || root.document.hidden) {
                this.current = this.target;
            }
            this._applyAll();
            if (this.current !== this.target) {
                this._rafId = root.requestAnimationFrame(this._step);
            }
        }

        _applyAll() {
            this.videos.forEach((v) => {
                const state = this.states.get(v);
                if (state) {
                    this._write(v, state);
                }
            });
        }

        _write(video, state) {
            const out = clamp01(state.yt * this.current);
            if (Math.abs(nativeGet.call(video) - out) >= 1e-7) {
                nativeSet.call(video, out);
            }
        }
    }

    root.YVS_VolumeGain = VolumeGain;
})(globalThis);
