/*
 * Interactive canvas graph of the volume curve.
 * - Bézier: drag the two control handles (linear view).
 * - Custom: click to add points, drag to move, double-click / right-click to delete.
 */
(function (root) {
    'use strict';

    const C = root.YVS_Curves;
    const F = root.YVS_Format;
    const { clamp01 } = C;

    const DB_FLOOR = -60;
    const DB_TICKS = [0, -10, -20, -30, -40, -50, -60];
    const LINEAR_TICKS = [0, 0.25, 0.5, 0.75, 1];
    const X_TICKS = 4;
    const PAD = { l: 46, r: 16, t: 14, b: 34 };
    const CURVE_SAMPLES = 240;
    const REFERENCE_SAMPLES = 120;
    const HIT_RADIUS = 11;
    const MAX_POINTS = 32;
    const POINT_GAP = 0.005;
    const FALLBACK_ACCENT = [255, 78, 69];

    function rgba(hex, alpha) {
        const rgb = F.hexToRgb(hex) || FALLBACK_ACCENT;
        return `rgba(${rgb.join(',')},${alpha})`;
    }

    function copy(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function dbTickLabel(db) {
        if (db === DB_FLOOR) {
            return '−∞';
        }
        return db === 0 ? '0 dB' : `−${-db}`;
    }

    class CurveEditor {
        constructor(canvas, opts = {}) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.opts = opts;
            this.cfg = null;
            this.max = 1;
            this.scale = 'linear';
            this.marker = null;
            this.drag = null; // { kind: 'bezier', idx } | { kind: 'point', idx }
            this.hover = null;
            this._bind();
            this._resize();
            if (root.ResizeObserver) {
                new ResizeObserver(() => this._resize()).observe(canvas);
            }
        }

        _resize() {
            const dpr = root.devicePixelRatio || 1;
            const rect = this.canvas.getBoundingClientRect();
            const w = Math.max(200, Math.round(rect.width || 560));
            const h = Math.max(160, Math.round(rect.height || 380));
            if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
                this.canvas.width = w * dpr;
                this.canvas.height = h * dpr;
            }
            this.w = w;
            this.h = h;
            this.dpr = dpr;
            this.draw();
        }

        setConfig(cfg, maxVolume) {
            this.cfg = copy(cfg);
            this.max = clamp01((maxVolume || 100) / 100);
            this.fn = C.makeCurve(this.cfg);
            this.draw();
        }

        setScale(scale) {
            this.scale = scale === 'db' ? 'db' : 'linear';
            this.draw();
        }

        setMarker(p) {
            this.marker = p;
            this.draw();
        }

        /* --------------------------------------------------- coordinate mapping */

        get plotW() {
            return this.w - PAD.l - PAD.r;
        }

        get plotH() {
            return this.h - PAD.t - PAD.b;
        }

        get bottom() {
            return PAD.t + this.plotH;
        }

        xToPx(x) {
            return PAD.l + x * this.plotW;
        }

        pxToX(px) {
            return clamp01((px - PAD.l) / this.plotW);
        }

        /** y is a gain 0..1. */
        yToPx(y) {
            return PAD.t + (1 - clamp01(this._yToUnit(y))) * this.plotH;
        }

        _yToUnit(y) {
            if (this.scale !== 'db') {
                return y;
            }
            const db = C.toDb(y);
            return isFinite(db) ? Math.max(0, (db - DB_FLOOR) / -DB_FLOOR) : 0;
        }

        pxToY(py) {
            const v = clamp01(1 - (py - PAD.t) / this.plotH);
            if (this.scale !== 'db') {
                return v;
            }
            return v <= 0.002 ? 0 : 10 ** ((DB_FLOOR + v * -DB_FLOOR) / 20);
        }

        /** Pixel position of a curve point (x, unscaled gain y). */
        _toPx(x, y) {
            return [this.xToPx(x), this.yToPx(y * this.max)];
        }

        _points() {
            return C.normalizePoints(this.cfg.points);
        }

        _bezierHandles() {
            const b = this.cfg.bezier;
            return [this._toPx(b[0], b[1]), this._toPx(b[2], b[3])];
        }

        _showsBezierHandles() {
            return this.cfg.type === 'bezier' && this.scale === 'linear';
        }

        /* --------------------------------------------------------------- drawing */

        draw() {
            if (!this.cfg || !this.w) {
                return;
            }
            const ctx = this.ctx;
            ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            ctx.clearRect(0, 0, this.w, this.h);
            const css = getComputedStyle(this.canvas);
            const theme = {
                accent: css.getPropertyValue('--accent').trim() || '#ff4e45',
                grid: css.getPropertyValue('--grid').trim() || 'rgba(255,255,255,0.08)',
                text: css.getPropertyValue('--muted').trim() || '#9aa0a6',
            };
            this._drawGrid(theme);
            this._drawReference();
            this._drawCurve(theme);
            this._drawHandles(theme);
            this._drawMarker(theme);
        }

        _yTicks() {
            if (this.scale === 'db') {
                return DB_TICKS.map((db) => ({
                    y: db === DB_FLOOR ? 0 : 10 ** (db / 20),
                    label: dbTickLabel(db),
                }));
            }
            return LINEAR_TICKS.map((y) => ({ y, label: F.position(y) }));
        }

        _line(x0, y0, x1, y1) {
            const ctx = this.ctx;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        }

        _drawGrid(theme) {
            const ctx = this.ctx;
            const right = PAD.l + this.plotW;
            ctx.lineWidth = 1;
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = theme.text;
            ctx.strokeStyle = theme.grid;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            this._yTicks().forEach((tick) => {
                const py = Math.round(this.yToPx(tick.y)) + 0.5;
                this._line(PAD.l, py, right, py);
                ctx.fillText(tick.label, PAD.l - 6, py);
            });
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            for (let i = 0; i <= X_TICKS; i++) {
                const x = i / X_TICKS;
                const px = Math.round(this.xToPx(x)) + 0.5;
                this._line(px, PAD.t, px, this.bottom);
                ctx.fillText(F.position(x), px, this.bottom + 6);
            }
            ctx.fillText('slider position →', PAD.l + this.plotW / 2, this.bottom + 19);
        }

        _polyline(points) {
            const ctx = this.ctx;
            ctx.beginPath();
            points.forEach(([px, py]) => ctx.lineTo(px, py));
        }

        _drawReference() {
            const ctx = this.ctx;
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            const line = Array.from({ length: REFERENCE_SAMPLES + 1 }, (_, i) => {
                const x = i / REFERENCE_SAMPLES;
                return [this.xToPx(x), this.yToPx(x)];
            });
            this._polyline(line);
            ctx.stroke();
            ctx.restore();
        }

        _drawCurve(theme) {
            const ctx = this.ctx;
            const pts = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
                const x = i / CURVE_SAMPLES;
                return this._toPx(x, this.fn(x));
            });
            const grad = ctx.createLinearGradient(0, PAD.t, 0, this.bottom);
            grad.addColorStop(0, rgba(theme.accent, 0.28));
            grad.addColorStop(1, rgba(theme.accent, 0.02));
            this._polyline([
                [pts[0][0], this.bottom],
                ...pts,
                [pts[CURVE_SAMPLES][0], this.bottom],
            ]);
            ctx.closePath();
            ctx.fillStyle = grad;
            ctx.fill();
            this._polyline(pts);
            ctx.strokeStyle = theme.accent;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }

        _drawHandles(theme) {
            const ctx = this.ctx;
            if (this._showsBezierHandles()) {
                const [h1, h2] = this._bezierHandles();
                ctx.strokeStyle = 'rgba(255,255,255,0.55)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(...this._toPx(0, 0));
                ctx.lineTo(...h1);
                ctx.moveTo(...this._toPx(1, 1));
                ctx.lineTo(...h2);
                ctx.stroke();
                this._handle(h1, this._isActive('bezier', 0));
                this._handle(h2, this._isActive('bezier', 1));
            }
            if (this.cfg.type === 'custom') {
                this._points().forEach((q, i) => {
                    this._handle(this._toPx(q[0], q[1]), this._isActive('point', i));
                });
            }
            if (this.cfg.type === 'bezier' && this.scale === 'db') {
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(
                    'Switch to linear view to drag the Bézier handles',
                    PAD.l + 8,
                    PAD.t + 6,
                );
            }
        }

        _drawMarker(theme) {
            if (this.marker === null || this.marker === undefined) {
                return;
            }
            const ctx = this.ctx;
            const [px, py] = this._toPx(this.marker, this.fn(this.marker));
            ctx.strokeStyle = 'rgba(255,255,255,0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            this._polyline([
                [px, this.bottom],
                [px, py],
                [PAD.l, py],
            ]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(px, py, 5, 0, Math.PI * 2);
            ctx.fillStyle = theme.accent;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        _isActive(kind, idx) {
            const a = this.drag || this.hover;
            return Boolean(a) && a.kind === kind && a.idx === idx;
        }

        _handle([px, py], isActive) {
            const ctx = this.ctx;
            ctx.beginPath();
            ctx.arc(px, py, isActive ? 7.5 : 6, 0, Math.PI * 2);
            ctx.fillStyle = '#1f1f1f';
            ctx.fill();
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
        }

        /* ----------------------------------------------------------- interaction */

        _local(e) {
            const r = this.canvas.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        }

        _hit(px, py) {
            const near = ([hx, hy]) => Math.hypot(hx - px, hy - py) <= HIT_RADIUS;
            if (this._showsBezierHandles()) {
                const [h1, h2] = this._bezierHandles();
                if (near(h2)) {
                    return { kind: 'bezier', idx: 1 };
                }
                if (near(h1)) {
                    return { kind: 'bezier', idx: 0 };
                }
            }
            if (this.cfg.type === 'custom') {
                const idx = this._points().findLastIndex((q) => near(this._toPx(q[0], q[1])));
                if (idx >= 0) {
                    return { kind: 'point', idx };
                }
            }
            return null;
        }

        /** Gain (before the max-volume scale) under a vertical pixel position. */
        _gainAt(py) {
            return clamp01(this.pxToY(py) / (this.max || 1));
        }

        _addPoint(px, py) {
            const points = this._points();
            const x = this.pxToX(px);
            if (x <= POINT_GAP || x >= 1 - POINT_GAP || points.length >= MAX_POINTS) {
                return null;
            }
            points.push([x, this._gainAt(py)]);
            points.sort((a, b) => a[0] - b[0]);
            this.cfg.points = points;
            this._changed();
            return { kind: 'point', idx: points.findIndex((q) => q[0] === x) };
        }

        _dragBezier(idx, x, y) {
            const b = this.cfg.bezier.slice();
            b[idx * 2] = C.round(x, 3);
            b[idx * 2 + 1] = C.round(y, 3);
            this.cfg.bezier = b;
        }

        _dragPoint(idx, x, y) {
            const points = this._points();
            const last = points.length - 1;
            let nx;
            if (idx === 0) {
                nx = 0;
            } else if (idx === last) {
                nx = 1;
            } else {
                const min = points[idx - 1][0] + POINT_GAP;
                const max = points[idx + 1][0] - POINT_GAP;
                nx = Math.min(max, Math.max(min, x));
            }
            points[idx] = [C.round(nx, 4), C.round(y, 4)];
            this.cfg.points = points;
        }

        _idleCursor(hit) {
            if (hit) {
                return 'grab';
            }
            return this.cfg.type === 'custom' ? 'crosshair' : 'default';
        }

        _onPointerDown(e) {
            if (e.button !== 0 || !this.cfg) {
                return;
            }
            const [px, py] = this._local(e);
            let hit = this._hit(px, py);
            if (!hit && this.cfg.type === 'custom') {
                hit = this._addPoint(px, py);
            }
            if (!hit) {
                return;
            }
            e.preventDefault();
            this.canvas.setPointerCapture(e.pointerId);
            this.drag = hit;
            this.draw();
        }

        _onPointerMove(e) {
            if (!this.cfg) {
                return;
            }
            const [px, py] = this._local(e);
            if (!this.drag) {
                const hit = this._hit(px, py);
                const changed = JSON.stringify(hit) !== JSON.stringify(this.hover);
                this.hover = hit;
                this.canvas.style.cursor = this._idleCursor(hit);
                if (changed) {
                    this.draw();
                }
                return;
            }
            this.canvas.style.cursor = 'grabbing';
            const x = this.pxToX(px);
            const y = this._gainAt(py);
            if (this.drag.kind === 'bezier') {
                this._dragBezier(this.drag.idx, x, y);
            } else {
                this._dragPoint(this.drag.idx, x, y);
            }
            this._changed();
        }

        _onPointerEnd() {
            if (!this.drag) {
                return;
            }
            this.drag = null;
            this.draw();
            this.opts.onCommit?.(this.cfg);
        }

        _onPointerLeave() {
            if (this.hover && !this.drag) {
                this.hover = null;
                this.draw();
            }
        }

        _onRemove(e) {
            if (this.cfg?.type !== 'custom') {
                return;
            }
            e.preventDefault();
            const hit = this._hit(...this._local(e));
            const points = this._points();
            if (!hit || hit.idx === 0 || hit.idx === points.length - 1) {
                return;
            }
            points.splice(hit.idx, 1);
            this.cfg.points = points;
            this.hover = null;
            this._changed();
            this.opts.onCommit?.(this.cfg);
        }

        _bind() {
            const cv = this.canvas;
            const onEnd = () => this._onPointerEnd();
            const onRemove = (e) => this._onRemove(e);
            cv.addEventListener('pointerdown', (e) => this._onPointerDown(e));
            cv.addEventListener('pointermove', (e) => this._onPointerMove(e));
            cv.addEventListener('pointerup', onEnd);
            cv.addEventListener('pointercancel', onEnd);
            cv.addEventListener('pointerleave', () => this._onPointerLeave());
            cv.addEventListener('dblclick', onRemove);
            cv.addEventListener('contextmenu', onRemove);
        }

        _changed() {
            this.fn = C.makeCurve(this.cfg);
            this.draw();
            this.opts.onChange?.(copy(this.cfg));
        }
    }

    root.YVS_CurveEditor = CurveEditor;
})(globalThis);
