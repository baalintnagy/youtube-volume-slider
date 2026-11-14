/*
 * The slider widget. Built with DOM APIs only (YouTube enforces Trusted Types,
 * so innerHTML is not allowed in the page world). Used on YouTube and as the
 * live preview on the options page.
 */
(function (root) {
    'use strict';

    const { clamp01 } = root.YVS_Curves;
    const { hexToRgb } = root.YVS_Format;

    const DEFAULT_STEP = 5;
    const WHEEL_NOTCH_PX = 100;
    const WHEEL_MAX_CHANGE = 0.25;
    const WHEEL_COMMIT_DELAY_MS = 250;
    const FLASH_MS = 900;
    const TOOLTIP_GAP_PX = 12;
    const DELTA_MODE_SCALE = { 0: 1, 1: 33, 2: 300 }; // pixel, line, page
    const SWALLOWED_EVENTS = ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart'];

    /* Maps a key to the new position, given the current value and key step. */
    const KEY_ACTIONS = {
        ArrowRight: (v, step) => v + step,
        ArrowUp: (v, step) => v + step,
        ArrowLeft: (v, step) => v - step,
        ArrowDown: (v, step) => v - step,
        PageUp: (v, step) => v + step * 2,
        PageDown: (v, step) => v - step * 2,
        Home: () => 0,
        End: () => 1,
    };

    function tryCall(fn) {
        try {
            fn();
        } catch {
            // Pointer capture may fail if the pointer is already gone.
        }
    }

    class Slider {
        /** Step in percent for a 'wheel' or 'key' interaction, or 0 when disabled. */
        static stepFor(behavior, kind) {
            if (kind === 'wheel') {
                return behavior.wheel ? behavior.wheelStep : 0;
            }
            return behavior.keyStep;
        }

        /**
         * @param {object} opts
         *   onInput(p, source)  called continuously while the value changes
         *   onCommit(p)         called when an interaction ends
         *   format(p)           returns { label, tooltip } strings
         *   getStep(kind)       'wheel' | 'key' -> step in percent, or 0 to disable
         */
        constructor(opts = {}) {
            this.opts = opts;
            this.doc = opts.document || root.document;
            this.value = 0;
            this.dragging = false;
            this._flashTimer = 0;
            this._wheelCommit = 0;
            this._tipHost = null;
            this._tipFrame = 0;
            this._hover = false;
            this._focusVisible = false;
            this._build();
            this._bindEvents();
            this.setValue(0);
        }

        _el(tag, cls, parent) {
            const e = this.doc.createElement(tag);
            e.className = cls;
            parent?.appendChild(e);
            return e;
        }

        _build() {
            const el = this._el('div', 'yvs-slider');
            el.setAttribute('role', 'slider');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', this.opts.ariaLabel || 'Volume');
            el.setAttribute('aria-valuemin', '0');
            el.setAttribute('aria-valuemax', '100');
            el.setAttribute('data-yvs', '1');
            this.el = el;
            this.rail = this._el('div', 'yvs-rail', el);
            this.track = this._el('div', 'yvs-track', this.rail);
            this.fill = this._el('div', 'yvs-fill', this.track);
            this.thumb = this._el('div', 'yvs-thumb', this.track);
            this.tooltip = this._el('div', 'yvs-tooltip', this.thumb);
            this.label = this._el('span', 'yvs-label', el);
        }

        _bindEvents() {
            const el = this.el;
            const onPointerUp = (e) => this._onPointerUp(e);
            el.addEventListener('pointerdown', (e) => this._onPointerDown(e));
            el.addEventListener('pointermove', (e) => this._onPointerMove(e));
            el.addEventListener('pointerup', onPointerUp);
            el.addEventListener('pointercancel', onPointerUp);
            el.addEventListener('lostpointercapture', onPointerUp);
            el.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
            el.addEventListener('keydown', (e) => this._onKey(e));
            el.addEventListener('pointerenter', () => this._setHover(true));
            el.addEventListener('pointerleave', () => this._setHover(false));
            el.addEventListener('focus', () => {
                this._focusVisible = el.matches(':focus-visible');
                this._syncTooltip();
            });
            el.addEventListener('blur', () => {
                this._focusVisible = false;
                this._syncTooltip();
            });
            SWALLOWED_EVENTS.forEach((type) => {
                el.addEventListener(type, (e) => e.stopPropagation());
            });
        }

        _setHover(hover) {
            this._hover = hover;
            this._syncTooltip();
        }

        /**
         * Renders the tooltip inside `host` instead of inside the slider, so it can
         * escape a clipping or low stacking-context ancestor (YouTube's left
         * controls sit below the seek bar). Pass null to move it back.
         */
        setTooltipHost(host) {
            this._tipHost = host || null;
            this.tooltip.classList.toggle('yvs-tooltip-portal', Boolean(this._tipHost));
            if (this._tipHost) {
                this._tipHost.appendChild(this.tooltip);
            } else {
                this.tooltip.style.left = '';
                this.tooltip.style.top = '';
                this.thumb.appendChild(this.tooltip);
            }
            this._syncTooltip();
        }

        _tooltipWanted() {
            const c = this.el.classList;
            if (c.contains('yvs-no-tooltip') || !this.el.isConnected) {
                return false;
            }
            return this._hover || this.dragging || this._focusVisible || c.contains('yvs-flash');
        }

        /** Shows/positions a portaled tooltip; follows the thumb while visible. */
        _syncTooltip() {
            if (!this._tipHost) {
                return;
            }
            const show = this._tooltipWanted();
            this.tooltip.classList.toggle('yvs-tooltip-show', show);
            if (!show) {
                cancelAnimationFrame(this._tipFrame);
                this._tipFrame = 0;
                return;
            }
            const host = this._tipHost.getBoundingClientRect();
            const thumb = this.thumb.getBoundingClientRect();
            this.tooltip.style.left = `${thumb.left + thumb.width / 2 - host.left}px`;
            this.tooltip.style.top = `${thumb.top - host.top - TOOLTIP_GAP_PX}px`;
            // Keep following the thumb (rail expand animation, value changes, resizes).
            if (!this._tipFrame) {
                this._tipFrame = requestAnimationFrame(() => {
                    this._tipFrame = 0;
                    this._syncTooltip();
                });
            }
        }

        _step(kind) {
            return this.opts.getStep ? this.opts.getStep(kind) : DEFAULT_STEP;
        }

        _commit() {
            this.opts.onCommit?.(this.value);
        }

        _positionFromEvent(e) {
            const rect = this.track.getBoundingClientRect();
            if (rect.width <= 0) {
                return this.value;
            }
            return clamp01((e.clientX - rect.left) / rect.width);
        }

        _emit(p, source) {
            const value = clamp01(p);
            if (value === this.value && source !== 'drag-start') {
                return;
            }
            this.setValue(value);
            this.opts.onInput?.(value, source);
        }

        _onPointerDown(e) {
            if (e.button !== 0) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            tryCall(() => this.el.setPointerCapture(e.pointerId));
            this.dragging = true;
            this.el.classList.add('yvs-dragging');
            this.el.focus({ preventScroll: true });
            this._syncTooltip();
            this._emit(this._positionFromEvent(e), 'drag-start');
        }

        _onPointerMove(e) {
            if (!this.dragging) {
                return;
            }
            e.stopPropagation();
            this._emit(this._positionFromEvent(e), 'drag');
        }

        _onPointerUp(e) {
            if (!this.dragging) {
                return;
            }
            this.dragging = false;
            this.el.classList.remove('yvs-dragging');
            tryCall(() => this.el.releasePointerCapture(e.pointerId));
            this._syncTooltip();
            this._commit();
        }

        _onWheel(e) {
            const step = this._step('wheel');
            if (!step) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : -e.deltaX;
            const delta = raw * (DELTA_MODE_SCALE[e.deltaMode] ?? 1);
            // One classic wheel notch (~100px) = one step; trackpads scroll smoothly.
            const change = (-delta / WHEEL_NOTCH_PX) * (step / 100);
            const limited = Math.max(-WHEEL_MAX_CHANGE, Math.min(WHEEL_MAX_CHANGE, change));
            this._emit(this.value + limited, 'wheel');
            this.flash();
            clearTimeout(this._wheelCommit);
            this._wheelCommit = setTimeout(() => this._commit(), WHEEL_COMMIT_DELAY_MS);
        }

        _onKey(e) {
            if (e.altKey || e.ctrlKey || e.metaKey || !Object.hasOwn(KEY_ACTIONS, e.key)) {
                return;
            }
            const step = this._step('key') / 100 || DEFAULT_STEP / 100;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
            this._emit(KEY_ACTIONS[e.key](this.value, step), 'key');
            this.flash();
            this._commit();
        }

        /** Updates visuals only; does not fire onInput. */
        setValue(p) {
            this.value = clamp01(p);
            this.el.style.setProperty('--yvs-p', String(this.value));
            this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
            this.refreshText();
        }

        refreshText() {
            const text = this.opts.format?.(this.value);
            const label = text?.label || '';
            const tip = text ? text.tooltip : `${Math.round(this.value * 100)}%`;
            if (this.label.textContent !== label) {
                this.label.textContent = label;
            }
            this.label.style.display = label ? '' : 'none';
            if (this.tooltip.textContent !== tip) {
                this.tooltip.textContent = tip;
            }
            this.el.setAttribute('aria-valuetext', tip);
        }

        setMuted(muted) {
            this.el.classList.toggle('yvs-muted', Boolean(muted));
        }

        setAppearance(a) {
            const s = this.el.style;
            const rgb = hexToRgb(a.trackColor) || [255, 255, 255];
            s.setProperty('--yvs-width', `${a.width}px`);
            s.setProperty('--yvs-track-h', `${a.trackHeight}px`);
            s.setProperty('--yvs-thumb', `${a.thumbSize}px`);
            s.setProperty('--yvs-radius', `${a.radius}px`);
            s.setProperty('--yvs-track-rgb', rgb.join(', '));
            s.setProperty('--yvs-track-a', String(a.trackOpacity));
            s.setProperty('--yvs-fill', a.fillColor);
            s.setProperty('--yvs-thumb-c', a.thumbColor);
            s.setProperty('--yvs-label-c', a.labelColor);
            this.el.setAttribute('data-label', a.label || 'none');
            this.el.classList.toggle('yvs-collapsible', Boolean(a.expandOnHover));
            this.el.classList.toggle('yvs-no-tooltip', !a.tooltip);
            this.el.classList.toggle('yvs-no-thumb', !(a.thumbSize > 0));
            this._syncTooltip();
        }

        /** Briefly show the slider (expanded) and its tooltip, e.g. after a key press. */
        flash(ms = FLASH_MS) {
            this.el.classList.add('yvs-flash');
            this._syncTooltip();
            clearTimeout(this._flashTimer);
            this._flashTimer = setTimeout(() => {
                this.el.classList.remove('yvs-flash');
                this._syncTooltip();
            }, ms);
        }

        destroy() {
            clearTimeout(this._flashTimer);
            clearTimeout(this._wheelCommit);
            cancelAnimationFrame(this._tipFrame);
            this.tooltip.remove();
            this.el.remove();
        }
    }

    root.YVS_Slider = Slider;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = Slider;
    }
})(globalThis);
