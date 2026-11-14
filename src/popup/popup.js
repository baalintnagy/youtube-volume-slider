(function () {
    'use strict';

    const S = window.YVS_Settings;
    const C = window.YVS_Curves;
    const $ = (id) => document.getElementById(id);

    const MINI = { width: 248, height: 90, pad: 8, samples: 120 };
    const SAVE_DELAY_MS = 150;

    let settings = S.clone(S.DEFAULTS);
    let saveTimer = 0;

    function buildCurveOptions() {
        const select = $('curve');
        C.TYPES.forEach((t) => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.label;
            select.appendChild(option);
        });
    }

    function drawMiniCurve() {
        const canvas = $('mini');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = MINI.width * dpr;
        canvas.height = MINI.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const fn = C.makeCurve(settings.curve);
        const max = settings.maxVolume / 100;
        const { pad } = MINI;
        const w = MINI.width - pad * 2;
        const h = MINI.height - pad * 2;
        const toPx = (x, y) => [pad + x * w, pad + (1 - y) * h];

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(...toPx(0, 0));
        ctx.lineTo(...toPx(1, 1));
        ctx.stroke();

        ctx.setLineDash([]);
        ctx.strokeStyle = '#ff5a4e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= MINI.samples; i++) {
            const x = i / MINI.samples;
            ctx.lineTo(...toPx(x, fn(x) * max));
        }
        ctx.stroke();
    }

    function render() {
        $('enabled').checked = settings.enabled;
        $('curve').value = settings.curve.type;
        $('width').value = settings.appearance.width;
        $('widthOut').textContent = `${settings.appearance.width} px`;
        document.body.classList.toggle('off', !settings.enabled);
        drawMiniCurve();
    }

    function update(mutate) {
        mutate(settings);
        settings = S.sanitize(settings);
        render();
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => S.save(settings), SAVE_DELAY_MS);
    }

    function openOptions() {
        if (window.chrome?.runtime?.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            location.href = '../options/options.html';
        }
    }

    function bindControls() {
        $('enabled').addEventListener('change', (e) => {
            update((s) => (s.enabled = e.target.checked));
        });
        $('curve').addEventListener('change', (e) => {
            update((s) => (s.curve.type = e.target.value));
        });
        $('width').addEventListener('input', (e) => {
            update((s) => (s.appearance.width = Number(e.target.value)));
        });
        $('openOptions').addEventListener('click', openOptions);
    }

    buildCurveOptions();
    bindControls();
    render();
    S.load().then((s) => {
        settings = s;
        render();
    });
})();
