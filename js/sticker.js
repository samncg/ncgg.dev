/* Sticker auto-drawer demo (the drawer on the Work card).
   Runs the real tool's engine (sticker/engine.js, in the tool's own worker) on the sample with the
   settings auto-match picks for it, and replays the strokes at phone scale (880 px canvas, 6 px brush,
   8 px eraser), tile by tile, looping. */
(function () {
  'use strict';

  var ENGINE = 'sticker/engine.js?v=34', WORKER = 'sticker/worker.js?v=34';
  // what the tool's auto-match chooses for the sample with "fill the canvas"
  var SETTINGS = { mode: 'z', fit: 'cover', br: 3, co: -30, gm: 140, lc: 50, ps: 10, tn: 4, pen: 6, esz: 8, rw: 880, rh: 880 };
  var DRAW_MS = 13000, HOLD_MS = 2600, FADE_MS = 500;

  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function loadEngine(done) {
    if (window.StickerEngine) { done(); return; }
    var s = document.createElement('script');
    s.src = ENGINE; s.onload = done; s.onerror = done;
    document.head.appendChild(s);
  }
  // plan in the tool's worker; fall back to the main thread where workers or OffscreenCanvas are missing
  function planAsync(img, done) {
    function onMain() {
      loadEngine(function () {
        var E = window.StickerEngine;
        if (!E) return;
        setTimeout(function () {
          var P = E.withDefaults(SETTINGS), G = E.grid(P), base = E.luminance(img, G.W, G.H, P.fit, makeCanvas);
          var r = E.plan(E.adjust(base, G.W, G.H, P), G.W, G.H, P);
          done({ W: G.W, H: G.H, strokes: r.strokes.map(function (p) { return { p: p, er: p.er ? 1 : 0, band: p.band, pass: p.pass }; }) });
        }, 0);
      });
    }
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') { onMain(); return; }
    var w;
    try { w = new Worker(WORKER); } catch (e) { onMain(); return; }
    w.onerror = function () { w.terminate(); onMain(); };
    w.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'ready') { loadEngine(function () { w.postMessage({ type: 'plan', id: 1, P: window.StickerEngine ? window.StickerEngine.withDefaults(SETTINGS) : SETTINGS }); }); }
      else if (m.type === 'planned') { w.terminate(); done(m.result); }
      else if (m.type === 'error') { w.terminate(); onMain(); }
    };
    createImageBitmap(img).then(function (bmp) { w.postMessage({ type: 'image', bitmap: bmp, id: 0 }, [bmp]); }, function () { w.terminate(); onMain(); });
  }

  function Demo(root) {
    var img = root.querySelector('[data-sticker-src]');
    var cv = root.querySelector('[data-sticker-canvas]');
    var pen = root.querySelector('[data-sticker-pen]');
    var hud = root.querySelector('[data-sticker-hud]');
    var count = root.querySelector('[data-sticker-count]');
    var toggle = root.querySelector('[data-sticker-toggle]');
    var dlg = root.closest('dialog');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var R = null, planning = false, ctx = cv.getContext('2d'), sc = 0, tiles = SETTINGS.tn * SETTINGS.tn;
    var raf = 0, idx = 0, paused = false, pausedAt = 0, phase = 'draw', phaseAt = 0;

    function size() { sc = SETTINGS.rw / R.W; cv.width = R.W * sc; cv.height = R.H * sc; }
    function clear() {
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.lineCap = ctx.lineJoin = 'round';
      idx = 0;
    }
    function drawTo(n) {
      var cur = -1;
      ctx.beginPath();
      for (; idx < n; idx++) {
        var s = R.strokes[idx], p = s.p;
        if (s.er !== cur) {
          if (cur !== -1) { ctx.stroke(); ctx.beginPath(); }
          ctx.strokeStyle = s.er ? '#fff' : '#111';
          ctx.lineWidth = s.er ? SETTINGS.esz : SETTINGS.pen;   // canvas is in phone pixels
          cur = s.er;
        }
        ctx.moveTo((p[0][0] + 0.5) * sc, (p[0][1] + 0.5) * sc);
        for (var j = 1; j < p.length; j++) ctx.lineTo((p[j][0] + 0.5) * sc, (p[j][1] + 0.5) * sc);
      }
      ctx.stroke();
    }
    var hudLast = '';
    function hudSet(parts) {
      var k = parts.join('|');
      if (k === hudLast) return;
      hudLast = k;
      hud.innerHTML = '<span>' + parts.join('</span><span>') + '</span>';
    }
    function label(s) {
      if (!s) return;
      hudSet(['tile ' + ((s.band || 0) + 1) + '/' + tiles, 'pass ' + ((s.pass || 0) + 1) + '/' + SETTINGS.ps, s.er ? 'eraser 8 px' : 'brush 6 px']);
      var q = s.p[s.p.length - 1];
      pen.style.left = ((q[0] + 0.5) / R.W * 100) + '%';
      pen.style.top = ((q[1] + 0.5) / R.H * 100) + '%';
      pen.classList.toggle('is-eraser', !!s.er);
    }
    function setCount(n) { count.textContent = n.toLocaleString('en-US') + ' / ' + R.strokes.length.toLocaleString('en-US') + ' strokes'; }
    function finish() {
      drawTo(R.strokes.length);
      pen.hidden = true;
      hudSet(['done', tiles + ' tiles', 'up to ' + SETTINGS.ps + ' passes each']);
      setCount(R.strokes.length);
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (paused) return;
      var el = now - phaseAt;
      if (phase === 'draw') {
        var k = Math.min(1, el / DRAW_MS), n = Math.round(k * R.strokes.length);
        drawTo(n);
        label(R.strokes[Math.max(0, n - 1)]);
        setCount(n);
        if (k >= 1) { finish(); phase = 'hold'; phaseAt = now; }
      } else if (phase === 'hold') {
        if (el > HOLD_MS) { phase = 'fade'; phaseAt = now; }
      } else if (phase === 'fade') {
        cv.style.opacity = String(Math.max(0, 1 - el / FADE_MS));
        if (el > FADE_MS) { clear(); cv.style.opacity = ''; pen.hidden = false; phase = 'draw'; phaseAt = now; }
      }
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function setPaused(v) {
      var now = performance.now();
      if (v && !paused) pausedAt = now;
      if (!v && paused) phaseAt += now - pausedAt;
      paused = v;
      toggle.querySelector('span').textContent = v ? 'play' : 'pause';
      toggle.querySelector('path').setAttribute('d', v ? 'M5 3.5v9l7.5-4.5z' : 'M5.5 4v8M10.5 4v8');
    }
    toggle.addEventListener('click', function () { setPaused(!paused); });
    function start() {
      if (!R) return;
      stop();
      size(); clear(); cv.style.opacity = '';
      if (reduce.matches) { finish(); toggle.hidden = true; return; }
      toggle.hidden = false; setPaused(false);
      label(R.strokes[0]); setCount(0);
      pen.hidden = false; phase = 'draw'; phaseAt = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function ready(fn) {
      if (img.complete && img.naturalWidth) fn();
      else img.addEventListener('load', fn, { once: true });
    }
    function open() {
      if (R) { start(); return; }
      if (planning) return;
      planning = true;
      hudSet(['planning strokes…']);
      ready(function () {
        planAsync(img, function (r) {
          R = r; planning = false;
          if (dlg && !dlg.open) return;
          start();
        });
      });
    }
    if (dlg) {
      dlg.addEventListener('drawer:open', open);
      dlg.addEventListener('close', stop);
    } else open();
  }

  document.querySelectorAll('[data-sticker-demo]').forEach(function (el) { Demo(el); });
})();
