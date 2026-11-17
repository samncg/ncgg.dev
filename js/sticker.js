/* Sticker auto-drawer demo.
   A port of the "Pixel art: brush + eraser sweep" mode from the HeyTea Sticker Drawer tool.
   The image is adjusted with the same settings the tool uses, planned into brush and eraser
   strokes, and replayed onto a white canvas at phone scale (880 px, 6 px brush, 8 px eraser). */
(function () {
  'use strict';

  // Settings from the tool, as used for this image.
  var CFG = {
    rw: 880, rh: 880,          // sticker canvas on the phone, px
    pen: 6, esz: 8,            // brush and eraser, px (6 is the smallest brush the app has)
    br: 7, co: -55, gm: 114, sm: 0,
    thr: 90, tn: 5, ps: 4,
    dither: false              // set by STYLE below
  };
  // 'z' dithered sweep. ('w', the threshold sweep, draws nothing here: contrast -55 lifts every
  // tone above the darkness cutoff of 90, so the cutoff only matters in threshold mode.)
  var STYLE = 'z';
  CFG.dither = STYLE === 'z';

  var DRAW_MS = 13000, HOLD_MS = 2600, FADE_MS = 500;

  /* ---------- planning (ported from the tool) ---------- */

  function blur(g, W, H, n) {
    while (n-- > 0) {
      var o = new Float32Array(g.length);
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var s = 0, k = 0;
        for (var j = -1; j < 2; j++) for (var i = -1; i < 2; i++) {
          var X = x + i, Y = y + j;
          if (X >= 0 && Y >= 0 && X < W && Y < H) { s += g[Y * W + X]; k++; }
        }
        o[y * W + x] = s / k;
      }
      g = o;
    }
    return g;
  }

  function adjust(img, W, H) {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(W / iw, H / ih);
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    var d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H), i;
    for (i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    g = blur(g, W, H, CFG.sm);
    var b = CFG.br * 2.55, ct = CFG.co * 2.55, f = 259 * (ct + 255) / (255 * (259 - ct)), gm = CFG.gm / 100;
    for (i = 0; i < W * H; i++) {
      var v = 255 * Math.pow(g[i] / 255, 1 / gm);
      v = (v - 128) * f + 128 + b;
      g[i] = Math.max(0, Math.min(255, v));
    }
    return g;
  }

  // Coverage kernel of a round brush of diameter d (grid cells), 4x4 supersampled.
  function kern(d) {
    var r = d / 2, n = Math.ceil(r), K = [], ss = 4;
    for (var dy = -n; dy <= n; dy++) for (var dx = -n; dx <= n; dx++) {
      var c = 0;
      for (var a = 0; a < ss; a++) for (var b = 0; b < ss; b++) {
        var x = dx - 0.5 + (a + 0.5) / ss, y = dy - 0.5 + (b + 0.5) / ss;
        if (x * x + y * y <= r * r) c++;
      }
      c /= ss * ss;
      if (c > 0) K.push([dx, dy, c]);
    }
    return K;
  }

  // Greedy brush + eraser sweep. Works top to bottom in nb bands; inside each band it alternates
  // a brush pass and an eraser pass (up to ps of each), keeping a stroke only where it lowers the
  // error between the coverage so far and the target tone. Strokes are tagged with band and pass.
  function sweep(g, W, H, dith, thr, B, E, nb, ps) {
    var T = new Float32Array(W * H), i;
    for (i = 0; i < W * H; i++) T[i] = dith ? (255 - g[i]) / 255 : (g[i] < thr ? 1 : 0);
    var cov = new Float32Array(W * H), Kp = kern(B), Ke = kern(Math.max(E, 0.5)), out = [];
    var bh = Math.ceil(H / Math.max(1, nb));
    function f(t, c) { var e = t - c; return e > 0 ? 1.5 * e * e : e * e; }
    for (var y0 = 0, band = 0; y0 < H; y0 += bh, band++) {
      var y1 = Math.min(H, y0 + bh), ch = 0;
      for (var pp = 0; pp < (ps || 12) * 2; pp++) {
        var er = pp % 2, K = er ? Ke : Kp, lim = er ? -0.15 / (1 + (pp >> 1)) : 0;
        for (var y = y0; y < y1; y++) {
          var row = [], s = -1;
          for (var x = 0; x <= W; x++) {
            var on = false;
            if (x < W) {
              var d = 0, k, X, Y, q, o, n;
              for (k = 0; k < K.length; k++) {
                X = x + K[k][0]; Y = y + K[k][1];
                if (X >= 0 && X < W && Y >= 0 && Y < H) {
                  q = Y * W + X; o = cov[q];
                  n = er ? o * (1 - K[k][2]) : 1 - (1 - o) * (1 - K[k][2]);
                  d += f(T[q], n) - f(T[q], o);
                }
              }
              if (d < lim) {
                on = true; ch++;
                for (k = 0; k < K.length; k++) {
                  X = x + K[k][0]; Y = y + K[k][1];
                  if (X >= 0 && X < W && Y >= 0 && Y < H) {
                    q = Y * W + X; o = cov[q];
                    cov[q] = er ? o * (1 - K[k][2]) : 1 - (1 - o) * (1 - K[k][2]);
                  }
                }
              }
            }
            if (on && s < 0) s = x;
            if (!on && s >= 0) {
              row.push({ a: s, b: s === x - 1 ? s + 0.01 : x - 1, y: y, er: er, band: band, pass: pp >> 1 });
              s = -1;
            }
          }
          if (y % 2) { row.reverse(); row.forEach(function (p) { var t = p.a; p.a = p.b; p.b = t; }); }
          for (i = 0; i < row.length; i++) out.push(row[i]);
        }
        if (pp % 2) { if (!ch) break; ch = 0; }
      }
    }
    return { strokes: out, bands: Math.ceil(H / bh) };
  }

  function grid() {
    return {
      W: Math.min(600, Math.max(8, Math.round(CFG.rw / (CFG.pen / 3)))),
      H: Math.min(600, Math.max(8, Math.round(CFG.rh / (CFG.pen / 3))))
    };
  }
  function args(g, G) {
    return [g, G.W, G.H, CFG.dither, CFG.thr, CFG.pen * G.W / CFG.rw, CFG.esz * G.W / CFG.rw, CFG.tn, CFG.ps];
  }
  function plan(img) {
    var G = grid(), r = sweep.apply(null, args(adjust(img, G.W, G.H), G));
    r.W = G.W; r.H = G.H;
    return r;
  }
  // The sweep is ~0.5 s of number crunching; run it off the main thread when workers are available.
  function planAsync(img, done) {
    var G = grid(), g = adjust(img, G.W, G.H), w = null;
    try {
      var src = kern.toString() + '\n' + sweep.toString() +
        '\nonmessage=function(e){postMessage(sweep.apply(null,e.data))};';
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      w = new Worker(url);
      URL.revokeObjectURL(url);
    } catch (e) { w = null; }
    function sync() {
      setTimeout(function () { var r = sweep.apply(null, args(g, G)); r.W = G.W; r.H = G.H; done(r); }, 0);
    }
    if (!w) { sync(); return; }
    w.onmessage = function (e) { var r = e.data; r.W = G.W; r.H = G.H; w.terminate(); done(r); };
    w.onerror = function () { w.terminate(); sync(); };
    w.postMessage(args(g, G));
  }

  /* ---------- playback ---------- */

  function Demo(root) {
    var img = root.querySelector('[data-sticker-src]');
    var cv = root.querySelector('[data-sticker-canvas]');
    var pen = root.querySelector('[data-sticker-pen]');
    var hud = root.querySelector('[data-sticker-hud]');
    var count = root.querySelector('[data-sticker-count]');
    var toggle = root.querySelector('[data-sticker-toggle]');
    var dlg = root.closest('dialog');
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    var P = null, planning = false, ctx = cv.getContext('2d'), sc = 0;
    var raf = 0, idx = 0, t0 = 0, paused = false, pausedAt = 0, phase = 'draw', phaseAt = 0;

    function size() {
      sc = CFG.rw / P.W;                      // draw at phone pixels: 880 x 880
      cv.width = P.W * sc; cv.height = P.H * sc;
    }
    function clear() {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.lineCap = ctx.lineJoin = 'round';
      idx = 0;
    }
    function drawTo(n) {
      var cur = -1;
      ctx.beginPath();
      for (; idx < n; idx++) {
        var p = P.strokes[idx];
        if (p.er !== cur) {
          if (cur !== -1) { ctx.stroke(); ctx.beginPath(); }
          ctx.strokeStyle = p.er ? '#fff' : '#111';
          ctx.lineWidth = (p.er ? CFG.esz : CFG.pen) * sc * P.W / CFG.rw;
          cur = p.er;
        }
        ctx.moveTo((p.a + 0.5) * sc, (p.y + 0.5) * sc);
        ctx.lineTo((p.b + 0.5) * sc, (p.y + 0.5) * sc);
      }
      ctx.stroke();
    }
    function label(p) {
      if (!p) return;
      hudSet(['band ' + (p.band + 1) + '/' + P.bands, 'pass ' + (p.pass + 1) + '/' + CFG.ps, p.er ? 'eraser 8 px' : 'brush 6 px']);
      pen.style.left = ((p.b + 0.5) / P.W * 100) + '%';
      pen.style.top = ((p.y + 0.5) / P.H * 100) + '%';
      pen.classList.toggle('is-eraser', !!p.er);
    }
    var hudLast = '';
    function hudSet(parts) {
      var k = parts.join('|');
      if (k === hudLast) return;
      hudLast = k;
      hud.innerHTML = '<span>' + parts.join('</span><span>') + '</span>';
    }
    function setCount(n) { count.textContent = n + ' / ' + P.strokes.length + ' strokes'; }

    function finish() {
      drawTo(P.strokes.length);
      pen.hidden = true;
      hudSet(['done', P.bands + ' bands', CFG.ps + ' passes each']);
      setCount(P.strokes.length);
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (paused) return;
      var el = now - phaseAt;
      if (phase === 'draw') {
        var k = Math.min(1, el / DRAW_MS), n = Math.round(k * P.strokes.length);
        drawTo(n);
        label(P.strokes[Math.max(0, n - 1)]);
        setCount(n);
        if (k >= 1) { finish(); phase = 'hold'; phaseAt = now; }
      } else if (phase === 'hold') {
        if (el > HOLD_MS) { phase = 'fade'; phaseAt = now; }
      } else if (phase === 'fade') {
        cv.style.opacity = String(Math.max(0, 1 - el / FADE_MS));
        if (el > FADE_MS) {
          clear(); cv.style.opacity = ''; pen.hidden = false;
          phase = 'draw'; phaseAt = now;
        }
      }
    }
    function start() {
      if (!P) return;
      stop();
      size(); clear(); cv.style.opacity = '';
      if (reduce.matches) { finish(); toggle.hidden = true; return; }
      toggle.hidden = false; setPaused(false);
      label(P.strokes[0]); setCount(0);
      pen.hidden = false; phase = 'draw'; phaseAt = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function setPaused(v) {
      var now = performance.now();
      if (v && !paused) pausedAt = now;
      if (!v && paused) phaseAt += now - pausedAt;
      paused = v;
      toggle.querySelector('span').textContent = v ? 'play' : 'pause';
      toggle.querySelector('path').setAttribute('d', v ? 'M5 3.5v9l7.5-4.5z' : 'M5.5 4v8M10.5 4v8');
      pen.classList.toggle('is-paused', v);
    }
    toggle.addEventListener('click', function () { setPaused(!paused); });

    function ready(fn) {
      if (img.complete && img.naturalWidth) fn();
      else img.addEventListener('load', fn, { once: true });
    }
    function open() {
      if (P) { start(); return; }
      if (planning) return;
      planning = true;
      hudSet(['planning strokes…']);
      ready(function () {
        planAsync(img, function (r) {
          P = r; planning = false;
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
  window.StickerPlan = { plan: plan, CFG: CFG };
})();
