// Mimics the parts of YouTube's player API that main.js relies on.
(function () {
    const pl = document.getElementById('movie_player');
    const video = pl.querySelector('video');
    const listeners = [];
    let vol = Number(localStorage.getItem('mockYtVol') || 60);
    let muted = false;
    window.mockNorm = 0.8; // loudness normalization factor
    function apply() {
        video.volume = (vol / 100) * window.mockNorm;
        video.muted = muted;
    }
    const domAdd = pl.addEventListener.bind(pl);
    pl.addEventListener = function (type, fn, opt) {
        if (type === 'onVolumeChange') {
            listeners.push(fn);
            return;
        }
        return domAdd(type, fn, opt);
    };
    pl.removeEventListener = function (type, fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) {
            listeners.splice(i, 1);
        }
    };
    const emit = () => listeners.forEach((f) => f({ volume: vol, muted }));
    pl.setVolume = (v) => {
        vol = Math.max(0, Math.min(100, Math.round(v)));
        localStorage.setItem('mockYtVol', vol);
        apply();
        emit();
    };
    pl.getVolume = () => vol;
    pl.mute = () => {
        muted = true;
        apply();
        emit();
    };
    pl.unMute = () => {
        muted = false;
        apply();
        emit();
    };
    pl.isMuted = () => muted;
    window.ytKeyHits = 0;
    // YouTube's own shortcut handler (should be pre-empted by the extension).
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            window.ytKeyHits++;
            pl.setVolume(vol - 5);
        }
        if (e.key === 'ArrowUp') {
            window.ytKeyHits++;
            pl.setVolume(vol + 5);
        }
    });
    document
        .getElementById('mute')
        .addEventListener('click', () => (muted ? pl.unMute() : pl.mute()));
    apply();
})();
