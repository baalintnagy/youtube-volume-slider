/*
 * Volume curve math. Shared by the content script (page world), the options
 * page and the unit tests. Every curve maps a slider position p in [0, 1] to an
 * output gain in [0, 1], with f(0) = 0 (silence) guaranteed.
 */
(function (root) {
    'use strict';

    const EPSILON = 1e-7;
    const DEFAULT_BEZIER = [0.5, 0, 0.9, 0.4];

    const TYPES = [
        { id: 'logarithmic', label: 'Logarithmic (dB)' },
        { id: 'power', label: 'Power (x^n)' },
        { id: 'linear', label: 'Linear' },
        { id: 'bezier', label: 'Bézier' },
        { id: 'custom', label: 'Custom points' },
    ];

    function clamp01(v) {
        if (v <= 0) {
            return 0;
        }
        return v >= 1 ? 1 : v;
    }

    function round(v, digits) {
        const factor = 10 ** digits;
        return Math.round(v * factor) / factor;
    }

    function isPoint(q) {
        return Array.isArray(q) && q.length >= 2 && isFinite(q[0]) && isFinite(q[1]);
    }

    /* Exponential taper that hits exactly 0 and 1 at the ends.
     * Over most of the range every slider step is the same number of dB. */
    function logarithmic(dbRange) {
        const range = Math.max(1, Number(dbRange) || 40);
        const k = 10 ** (range / 20);
        return (p) => clamp01((k ** clamp01(p) - 1) / (k - 1));
    }

    function power(exponent) {
        const n = Math.max(0.1, Number(exponent) || 2);
        return (p) => clamp01(p) ** n;
    }

    /* CSS-style cubic Bézier from (0,0) to (1,1) with control points
     * (x1,y1) and (x2,y2). x1/x2 are clamped to [0,1] so x(t) is monotonic. */
    function bezier(controlPoints) {
        const [x1, y1, x2, y2] = controlPoints.map((v) => clamp01(Number(v)));
        const coefficients = (c1, c2) => {
            const c = 3 * c1;
            const b = 3 * (c2 - c1) - c;
            return { a: 1 - c - b, b, c };
        };
        const cx = coefficients(x1, x2);
        const cy = coefficients(y1, y2);
        const evaluate = ({ a, b, c }, t) => ((a * t + b) * t + c) * t;
        const slopeX = (t) => (3 * cx.a * t + 2 * cx.b) * t + cx.c;

        function newton(x) {
            let t = x;
            for (let i = 0; i < 8; i++) {
                const err = evaluate(cx, t) - x;
                if (Math.abs(err) < EPSILON) {
                    return t;
                }
                const d = slopeX(t);
                if (Math.abs(d) < 1e-6) {
                    return null;
                }
                t -= err / d;
            }
            return null;
        }

        function bisect(x) {
            let lo = 0;
            let hi = 1;
            let t = x;
            for (let i = 0; i < 40; i++) {
                const v = evaluate(cx, t);
                if (Math.abs(v - x) < EPSILON) {
                    break;
                }
                if (v < x) {
                    lo = t;
                } else {
                    hi = t;
                }
                t = (lo + hi) / 2;
            }
            return t;
        }

        return (p) => {
            const x = clamp01(p);
            if (x === 0 || x === 1) {
                return x;
            }
            const t = newton(x) ?? bisect(x);
            return clamp01(evaluate(cy, t));
        };
    }

    /* Fritsch–Carlson tangents: guarantees a monotone interpolant. */
    function monotoneTangents(xs, ys) {
        const n = xs.length;
        const secants = xs.slice(0, -1).map((x, i) => {
            const dx = xs[i + 1] - x;
            return dx > 0 ? (ys[i + 1] - ys[i]) / dx : 0;
        });
        const m = xs.map((_, i) => {
            if (i === 0) {
                return secants[0];
            }
            if (i === n - 1) {
                return secants[n - 2];
            }
            const [prev, next] = [secants[i - 1], secants[i]];
            return prev * next <= 0 ? 0 : (prev + next) / 2;
        });
        secants.forEach((d, i) => {
            if (d === 0) {
                m[i] = 0;
                m[i + 1] = 0;
                return;
            }
            const a = m[i] / d;
            const b = m[i + 1] / d;
            const s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                m[i] = t * a * d;
                m[i + 1] = t * b * d;
            }
        });
        return m;
    }

    /* Monotone cubic (Fritsch–Carlson) interpolation through user points.
     * No overshoot between points, so the curve never exceeds what you drew. */
    function custom(points) {
        const pts = normalizePoints(points);
        const xs = pts.map((q) => q[0]);
        const ys = pts.map((q) => q[1]);
        const m = monotoneTangents(xs, ys);
        const lastSegment = pts.length - 2;

        return (p) => {
            const x = clamp01(p);
            if (x <= 0) {
                return 0; // position 0 is always silence
            }
            let i = 0;
            while (i < lastSegment && x > xs[i + 1]) {
                i++;
            }
            const h = xs[i + 1] - xs[i];
            if (h <= 0) {
                return clamp01(ys[i + 1]);
            }
            const t = (x - xs[i]) / h;
            const t2 = t * t;
            const t3 = t2 * t;
            const v =
                (2 * t3 - 3 * t2 + 1) * ys[i] +
                (t3 - 2 * t2 + t) * h * m[i] +
                (-2 * t3 + 3 * t2) * ys[i + 1] +
                (t3 - t2) * h * m[i + 1];
            return clamp01(v);
        };
    }

    /* Sorted, de-duplicated (keeping the last of equal x) points that always
     * start at x = 0 and end at x = 1. */
    function normalizePoints(points) {
        const sorted = (Array.isArray(points) ? points : [])
            .filter(isPoint)
            .map((q) => [clamp01(Number(q[0])), clamp01(Number(q[1]))])
            .sort((a, b) => a[0] - b[0]);
        const pts = sorted.reduce((out, q) => {
            const last = out[out.length - 1];
            if (last && Math.abs(last[0] - q[0]) < 1e-6) {
                out[out.length - 1] = q;
            } else {
                out.push(q);
            }
            return out;
        }, []);
        if (!pts.length || pts[0][0] > 0) {
            pts.unshift([0, 0]);
        }
        if (pts[pts.length - 1][0] < 1) {
            pts.push([1, pts.length > 1 ? pts[pts.length - 1][1] : 1]);
        }
        pts[0] = [0, pts[0][1]];
        pts[pts.length - 1] = [1, pts[pts.length - 1][1]];
        return pts;
    }

    const FACTORIES = {
        linear: () => clamp01,
        power: (cfg) => power(cfg.exponent),
        bezier: (cfg) => bezier(Array.isArray(cfg.bezier) ? cfg.bezier : DEFAULT_BEZIER),
        custom: (cfg) => custom(cfg.points),
        logarithmic: (cfg) => logarithmic(cfg.dbRange),
    };

    function makeCurve(cfg = {}) {
        const type = Object.hasOwn(FACTORIES, cfg.type) ? cfg.type : 'logarithmic';
        const fn = FACTORIES[type](cfg);
        return (p) => (p <= 0 ? 0 : fn(p));
    }

    /* Smallest position whose output reaches y (curves are non-decreasing in
     * practice; for odd custom shapes this still returns a sensible match). */
    function invert(fn, gain) {
        const y = clamp01(gain);
        if (y <= 0) {
            return 0;
        }
        if (fn(1) <= y) {
            return 1;
        }
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            if (fn(mid) < y) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        return hi;
    }

    function toDb(gain) {
        return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
    }

    function sample(fn, count) {
        const n = Math.max(2, Math.trunc(count) || 0);
        return Array.from({ length: n }, (_, i) => {
            const x = i / (n - 1);
            return [round(x, 4), round(fn(x), 4)];
        });
    }

    const api = { TYPES, makeCurve, invert, toDb, sample, normalizePoints, clamp01, round };
    root.YVS_Curves = api;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(globalThis);
