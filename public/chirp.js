// CyberDuck sync-chirp auto-beacon (phone 1 / admin).
// Plays /sync_chirp.wav ~1s after the synchronized recording starts,
// so every sensor phone captures a clean acoustic sync anchor from the center.
(function () {
  var ctx = null, buf = null, loading = null;
  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') { ctx.resume(); }
    return ctx;
  }
  function loadBuf() {
    if (buf) return Promise.resolve(buf);
    if (loading) return loading;
    loading = fetch('/sync_chirp.wav')
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (a) { return ctx.decodeAudioData(a); })
      .then(function (b) { buf = b; return b; });
    return loading;
  }
  function playChirp() {
    try {
      var s = ctx.createBufferSource();
      s.buffer = buf; s.connect(ctx.destination); s.start();
      var t = document.getElementById('st-title');
      if (t) t.textContent = '\uD83D\uDD0A \uD83D\uDD0A \uD83D\uDD0A';
    } catch (e) { console.log('chirp play error', e); }
  }
  function armForSession() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      fetch('/cmd').then(function (r) { return r.json(); }).then(function (c) {
        if (c && c.session && c.session.startAt) {
          clearInterval(iv);
          var delay = Math.max(0, c.session.startAt - c.now) + 1000;
          loadBuf().then(function () { setTimeout(playChirp, delay); });
        }
      }).catch(function () {});
      if (tries > 25) clearInterval(iv);
    }, 150);
  }
  function hook() {
    var btn = document.getElementById('startBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      ensureCtx();      // unlock audio inside the user gesture
      loadBuf();        // start fetching/decoding the chirp
      armForSession();  // wait for the session to start, then play
    });
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();
