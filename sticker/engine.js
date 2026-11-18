/*
 * Sticker drawer engine. Turns an image into brush and eraser strokes for the HeyTea custom sticker
 * canvas, scores how close a drawing comes to the image, searches for the settings that come closest,
 * and writes the ADB shell script that draws it on the phone.
 * Ported from the standalone HeyTea Sticker Drawer tool: the stroke planners are unchanged, but every
 * function takes a settings object (P) instead of reading the page, so it runs in a worker as well.
 * Works in a page (window.StickerEngine) and in a worker (self.StickerEngine).
 */
(function (root) {
  'use strict';

  /* ---------- settings ---------- */

  var DEFAULTS = {
    mode: 'z', br: 0, co: 0, gm: 100, sm: 0, thr: 140, dth: 240, gap: 2, gap2: 2, auto: true,
    cross: true, era: false, trim: false, tile: false, guard: false, sen: 60, hl: 200,
    esz: 8, tw: 3, tn: 4, ps: 4, lc: 50, res: 150, min: 1, pen: 6, inv: false,
    shape: 'rect', fit: 'contain', rw: 880, rh: 880
  };

  // style id, name, one line, and which controls matter for it
  var STYLES = [
    { id: 'z', name: 'Pixel sweep', blurb: 'Brush passes build tone, eraser passes carve detail back out. Closest to photos.', keys: ['tn', 'ps'] },
    { id: 'w', name: 'Pixel sweep, two-tone', blurb: 'The same sweep, but every pixel is either ink or paper.', keys: ['thr', 'tn', 'ps'] },
    { id: 'x', name: 'Pixel dabs', blurb: 'One brush pass of dithered dabs. Fast, a little grainy.', keys: [] },
    { id: 'y', name: 'Pixel dabs, two-tone', blurb: 'Brush dabs wherever the image is darker than the cutoff.', keys: ['thr'] },
    { id: 'h', name: 'Scanlines', blurb: 'Horizontal lines, closer together in dark areas.', keys: ['thr', 'cross', 'era', 'hl'] },
    { id: 'b', name: 'Outline and scanlines', blurb: 'Traced edges on top of scanline shading.', keys: ['thr', 'sen', 'cross', 'era', 'hl'] },
    { id: 'e', name: 'Outline', blurb: 'Only the traced edges, like a line drawing.', keys: ['sen'] },
    { id: 'c', name: 'Wavy lines', blurb: 'Scanlines that wobble harder where it is darker.', keys: ['thr', 'era', 'hl'] },
    { id: 'd', name: 'Halftone dots', blurb: 'Spiral dots that grow with darkness, like print.', keys: ['dth'] },
    { id: 'p', name: 'Painterly', blurb: 'Short brush strokes that follow the shapes.', keys: [] },
    { id: 'l', name: 'Layered', blurb: 'Brush strokes and dots, then eraser strokes for highlights.', keys: ['hl'] },
    { id: 'm', name: 'Combo', blurb: 'Halftone, scanlines, outlines and eraser together.', keys: ['thr', 'dth', 'sen'] }
  ];
  function isPixel(mode) { return 'xyzw'.indexOf(mode) >= 0; }

  function copy(P) { var o = {}; for (var k in P) o[k] = P[k]; return o; }
  function withDefaults(P) { var o = copy(DEFAULTS); for (var k in P) if (P[k] !== undefined) o[k] = P[k]; return o; }

  function grid(P) {
    var rw = P.rw || 1, rh = P.rh || 1;
    if (isPixel(P.mode)) {
      return { W: Math.min(600, Math.max(8, Math.round(rw / (P.pen / 3)))), H: Math.min(600, Math.max(8, Math.round(rh / (P.pen / 3)))) };
    }
    return rw >= rh ? { W: P.res, H: Math.max(8, Math.round(P.res * rh / rw)) } : { W: Math.max(8, Math.round(P.res * rw / rh)), H: P.res };
  }
  // a physical size (phone px) in grid cells
  function px(P, W, v) { return v * W / (P.rw || 1); }

  /* ---------- image ---------- */

  // luminance 0..255 of the image fitted into W x H on white paper
  function luminance(img, W, H, fit, makeCanvas) {
    var c = makeCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var iw = img.width, ih = img.height, s = fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    var d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (var i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  }
  function blur3(g, W, H, n) {
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
  /*
   * CLAHE: contrast-limited adaptive histogram equalization. The picture is split into n x n regions; each
   * gets a tone curve that spreads its own tones over the full range (with the histogram clipped at `clip`
   * times the average, so flat areas don't turn into noise), and pixels blend the curves of the four
   * nearest regions. A uniformly dark face gets light-to-dark range of its own, so eyes, nose and mouth
   * separate from the skin instead of all falling under one cut-off.
   */
  function clahe(g, W, H, n, clip) {
    var tw = W / n, th = H / n, maps = [], tx, ty, x, y, i, k;
    for (ty = 0; ty < n; ty++) for (tx = 0; tx < n; tx++) {
      var hist = new Float32Array(256), x0 = Math.floor(tx * tw), x1 = Math.floor((tx + 1) * tw), y0 = Math.floor(ty * th), y1 = Math.floor((ty + 1) * th), cnt = 0;
      for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) { hist[Math.max(0, Math.min(255, Math.round(g[y * W + x])))]++; cnt++; }
      var limit = Math.max(1, clip * cnt / 256), excess = 0;
      for (k = 0; k < 256; k++) if (hist[k] > limit) { excess += hist[k] - limit; hist[k] = limit; }
      var add = excess / 256, map = new Float32Array(256), c = 0;
      for (k = 0; k < 256; k++) { c += hist[k] + add; map[k] = 255 * c / (cnt || 1); }
      maps.push(map);
    }
    var out = new Float32Array(W * H);
    for (y = 0; y < H; y++) {
      var fy = (y + 0.5) / th - 0.5, y0i = Math.max(0, Math.min(n - 1, Math.floor(fy))), y1i = Math.min(n - 1, y0i + 1), wy = Math.max(0, Math.min(1, fy - y0i));
      for (x = 0; x < W; x++) {
        var fx = (x + 0.5) / tw - 0.5, x0i = Math.max(0, Math.min(n - 1, Math.floor(fx))), x1i = Math.min(n - 1, x0i + 1), wx = Math.max(0, Math.min(1, fx - x0i));
        i = Math.max(0, Math.min(255, Math.round(g[y * W + x])));
        var a = maps[y0i * n + x0i][i] * (1 - wx) + maps[y0i * n + x1i][i] * wx, b = maps[y1i * n + x0i][i] * (1 - wx) + maps[y1i * n + x1i][i] * wx;
        out[y * W + x] = a * (1 - wy) + b * wy;
      }
    }
    return out;
  }
  function inCircle(x, y, W, H) { var u = (x + 0.5 - W / 2) / (W / 2), v = (y + 0.5 - H / 2) / (H / 2); return u * u + v * v <= 1; }
  // smoothing, local contrast, brightness, contrast, midtones, invert and the circle mask
  function adjust(base, W, H, P) {
    var g = blur3(base, W, H, P.sm | 0), out = new Float32Array(W * H);
    // local contrast: push each pixel away from its neighbourhood average (radius ~1/30 of the picture),
    // so faint shading, like a nose or cheek on light skin, survives being drawn in black and white
    var lc = (P.lc || 0) / 100;
    if (lc > 0) {
      // regional tone first (CLAHE), so a dark face or a pale sky gets its own full range...
      var eq = clahe(g, W, H, 8, 2.5), e = new Float32Array(W * H), j;
      for (j = 0; j < W * H; j++) e[j] = g[j] + (eq[j] - g[j]) * lc;
      // ...then fine detail
      var avg = boxBlur(e, W, H, Math.max(2, Math.round(Math.max(W, H) / 60)));
      for (j = 0; j < W * H; j++) e[j] = Math.max(0, Math.min(255, e[j] + lc * (e[j] - avg[j])));
      g = e;
    }
    var b = P.br * 2.55, ct = P.co * 2.55, f = 259 * (ct + 255) / (255 * (259 - ct)), gm = P.gm / 100, circ = P.shape === 'circle';
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = y * W + x, v = 255 * Math.pow(Math.max(0, g[i]) / 255, 1 / gm);
      v = (v - 128) * f + 128 + b;
      v = Math.max(0, Math.min(255, v));
      if (P.inv) v = 255 - v;
      if (circ && !inCircle(x, y, W, H)) v = 255;
      out[i] = v;
    }
    return out;
  }

  /* ---------- stroke planners (from the original tool) ---------- */

  function rdp(p, e) {
    if (p.length < 3) return p;
    var mx = 0, k = 0, a = p[0], b = p[p.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    for (var i = 1; i < p.length - 1; i++) { var d = Math.abs(dy * (p[i][0] - a[0]) - dx * (p[i][1] - a[1])) / L; if (d > mx) { mx = d; k = i; } }
    return mx <= e ? [a, b] : rdp(p.slice(0, k + 1), e).slice(0, -1).concat(rdp(p.slice(k), e));
  }
  function tag(p, ty, er, dot) { p.ty = ty; if (er) p.er = 1; if (dot) p.dot = 1; return p; }

  function hatch(g, W, H, t0, gap, minL, cross, g2, cf) {
    cf = cf === undefined ? 0.55 : cf;
    var out = [];
    function pass(t, v, gp) {
      var n = v ? W : H, m = v ? H : W;
      function av(k, a) { var s = 0, c = 0; for (var q = 0; q < gp && a + q < n; q++) { s += g[v ? k * W + a + q : (a + q) * W + k]; c++; } return s / c; }
      for (var a = 0, r = 0; a < n; a += gp, r++) {
        var s = -1;
        for (var k = 0; k <= m; k++) {
          var dk = k < m && av(k, a) < t;
          if (dk && s < 0) s = k;
          if (!dk && s >= 0) {
            var e = k - 1;
            if (e - s + 1 >= minL) {
              var c = a + (gp - 1) / 2, p = v ? [[c, s], [c, e]] : [[s, c], [e, c]];
              tag(p, 's'); if (r % 2) p.reverse(); out.push(p);
            }
            s = -1;
          }
        }
      }
    }
    pass(t0, 0, gap);
    if (cross) pass(t0 * cf, 1, g2);
    return out;
  }
  function order(s) {
    if (s.length > 4000) return s;
    var out = [], r = s.slice(), c = [0, 0];
    while (r.length) {
      var bi = 0, bd = 1e12, rv = false;
      for (var i = 0; i < r.length; i++) {
        var p = r[i], a = p[0], b = p[p.length - 1];
        var d1 = (a[0] - c[0]) * (a[0] - c[0]) + (a[1] - c[1]) * (a[1] - c[1]), d2 = (b[0] - c[0]) * (b[0] - c[0]) + (b[1] - c[1]) * (b[1] - c[1]);
        if (d1 < bd) { bd = d1; bi = i; rv = false; }
        if (d2 < bd) { bd = d2; bi = i; rv = true; }
      }
      var q = r.splice(bi, 1)[0];
      if (rv) q.reverse();
      out.push(q); c = q[q.length - 1];
    }
    return out;
  }
  function edges(g, W, H, sens, minL) {
    var m = new Float32Array(W * H), e = new Uint8Array(W * H), t = 400 * (1 - sens / 100) + 25, x, y, i;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      var gx = -g[i - W - 1] - 2 * g[i - 1] - g[i + W - 1] + g[i - W + 1] + 2 * g[i + 1] + g[i + W + 1];
      var gy = -g[i - W - 1] - 2 * g[i - W] - g[i - W + 1] + g[i + W - 1] + 2 * g[i + W] + g[i + W + 1];
      m[i] = Math.hypot(gx, gy);
    }
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      i = y * W + x; var v = m[i];
      if (v > t && ((v > m[i - 1] && v >= m[i + 1]) || (v > m[i - W] && v >= m[i + W]))) e[i] = 1;
    }
    var vis = new Uint8Array(W * H), NB = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]], paths = [];
    function walk(x, y, p, fr) {
      for (;;) {
        var nx = -1, ny = 0;
        for (var k = 0; k < NB.length; k++) {
          var X = x + NB[k][0], Y = y + NB[k][1];
          if (X >= 0 && Y >= 0 && X < W && Y < H && e[Y * W + X] && !vis[Y * W + X]) { nx = X; ny = Y; break; }
        }
        if (nx < 0) break;
        x = nx; y = ny; vis[y * W + x] = 1;
        if (fr) p.unshift([x, y]); else p.push([x, y]);
      }
    }
    for (i = 0; i < W * H; i++) {
      if (!e[i] || vis[i]) continue;
      var px0 = i % W, py0 = (i / W) | 0, p = [[px0, py0]];
      vis[i] = 1; walk(px0, py0, p, 0); walk(px0, py0, p, 1);
      if (p.length >= minL) paths.push(tag(rdp(p, 0.7), 'o'));
    }
    return order(paths);
  }
  function curves(g, W, H, t0, gap, minL) {
    var out = [];
    for (var a = gap / 2, r = 0; a < H; a += gap, r++) {
      var p = [], ph = 0, row = Math.min(H - 1, Math.round(a));
      var flush = function () { if (p.length >= minL) { p = tag(rdp(p, 0.25), 's'); if (r % 2) p.reverse(); out.push(p); } p = []; };
      for (var x = 0; x < W; x++) {
        var d = Math.max(0, (t0 - g[row * W + x]) / t0);
        if (d < 0.04) { flush(); continue; }
        ph += 0.3 + d * 1.2;
        p.push([x, a + Math.sin(ph) * d * gap * 0.9]);
      }
      flush();
    }
    return out;
  }
  function dots(g, W, H, S, B, dmin) {
    var out = [], dy = S * 0.866, cov = Math.PI * (B / 2) * (B / 2) / (S * S * 0.866);
    var bay = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(function (v) { return (v + 0.5) / 16; });
    for (var y = S / 2, j = 0; y < H; y += dy, j++) {
      var row = [];
      for (var x = S / 2 + (j % 2) * S / 2, i = 0; x < W; x += S, i++) {
        var v = g[Math.min(H - 1, Math.round(y)) * W + Math.min(W - 1, Math.round(x))], d = (255 - v) / 255;
        if (d < dmin) continue;
        var R = S * 0.55 * Math.sqrt(d), p;
        if (R <= B * 0.6) {
          if (d / cov <= bay[(j % 4) * 4 + i % 4]) continue;
          p = [[x, y], [x + 0.01, y]];
        } else {
          var a = 0, r = R - B / 2;
          p = [[x + r, y]];
          while (r > B * 0.3) {
            var da = Math.min(1, B * 0.9 / Math.max(r, B * 0.5));
            a += da; r -= B * 0.8 * da / 6.283;
            p.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
          }
          p.push([x, y]);
        }
        row.push(tag(p, 'd', 0, 1));
      }
      if (j % 2) row.reverse();
      for (var q = 0; q < row.length; q++) out.push(row[q]);
    }
    return out;
  }
  function brush(g, W, H, S, L, ang, off, ok, er) {
    var out = [];
    function cl(v, m) { return Math.max(0, Math.min(m - 1, v)); }
    for (var y = S / 2 + off, j = 0; y < H; y += S, j++) {
      var row = [];
      for (var x = S / 2 + off + (j % 2) * S / 2; x < W; x += S) {
        var xi = cl(Math.round(x), W), yi = cl(Math.round(y), H);
        if (!ok(g[yi * W + xi])) continue;
        var gx = g[yi * W + cl(xi + 1, W)] - g[yi * W + cl(xi - 1, W)], gy = g[cl(yi + 1, H) * W + xi] - g[cl(yi - 1, H) * W + xi];
        var t = (Math.hypot(gx, gy) > 12 ? Math.atan2(gy, gx) + Math.PI / 2 : Math.PI / 4) + ang;
        var c = Math.cos(t), s = Math.sin(t), h = L / 2, bd = L * 0.12;
        var p = [[cl(x - c * h, W), cl(y - s * h, H)], [cl(x - s * bd, W), cl(y + c * bd, H)], [cl(x + c * h, W), cl(y + s * h, H)]];
        row.push(tag(p, er ? 'e' : 'b', er));
      }
      if (j % 2) row.reverse();
      for (var q = 0; q < row.length; q++) out.push(row[q]);
    }
    return out;
  }
  function clipSeg(a, b, xm, ym) {
    var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1], pq = [[-dx, a[0] - xm], [-dy, a[1] - ym]];
    for (var i = 0; i < 2; i++) {
      var p = pq[i][0], q = pq[i][1];
      if (p === 0) { if (q < 0) return null; }
      else { var r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
    }
    return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
  }
  function clipPoly(p, xm, ym) {
    var out = [], cur = null;
    for (var i = 1; i < p.length; i++) {
      var s = clipSeg(p[i - 1], p[i], xm, ym);
      if (!s) { cur = null; continue; }
      var l = cur && cur[cur.length - 1];
      if (l && Math.hypot(l[0] - s[0][0], l[1] - s[0][1]) < 1e-6) cur.push(s[1]);
      else { cur = [s[0], s[1]]; cur.er = p.er; cur.ty = p.ty; out.push(cur); }
    }
    return out;
  }
  function splitTiles(ss, W, H, n) {
    var tw = W / n, th = H / n, out = [];
    function cl(v) { return Math.min(n - 1, Math.max(0, v)); }
    function tile(x, y) { return cl(Math.floor(y / th)) * n + cl(Math.floor(x / tw)); }
    ss.forEach(function (p) {
      var cur = null, ck = -1;
      for (var i = 1; i < p.length; i++) {
        var a = p[i - 1], b = p[i], ts = [0, 1];
        for (var k = 1; k < n; k++) {
          [[a[0], b[0] - a[0], tw], [a[1], b[1] - a[1], th]].forEach(function (q) {
            if (q[1] !== 0) { var t = (k * q[2] - q[0]) / q[1]; if (t > 0 && t < 1) ts.push(t); }
          });
        }
        ts.sort(function (u, v) { return u - v; });
        for (var m = 1; m < ts.length; m++) {
          var t0 = ts[m - 1], t1 = ts[m];
          if (t1 - t0 < 1e-9) continue;
          var s = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], e = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
          var kk = tile((s[0] + e[0]) / 2, (s[1] + e[1]) / 2);
          if (cur && kk === ck) cur.push(e);
          else { cur = [s, e]; cur.er = p.er; cur.ty = p.ty; cur.dot = p.dot; cur.k = kk; ck = kk; out.push(cur); }
        }
      }
    });
    return out;
  }
  function tileSweep(ss, W, H, n, E, guard) {
    var T = [], out = [], k;
    for (k = 0; k < n * n; k++) T.push([]);
    splitTiles(ss, W, H, n).forEach(function (p) { T[p.k].push(p); });
    T.forEach(function (L, k2) {
      var r = (k2 / n) | 0, c = k2 % n, xm = c ? c * W / n + E / 2 : -1e9, ym = r ? r * H / n + E / 2 : -1e9;
      L.forEach(function (p) { if (guard && p.er) out.push.apply(out, clipPoly(p, xm, ym)); else out.push(p); });
    });
    return out;
  }
  function minF(g, W, H, r) {
    var t = new Float32Array(W * H), o = new Float32Array(W * H), x, y, k, m;
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { m = 255; for (k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.min(m, g[y * W + k]); t[y * W + x] = m; }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) { m = 255; for (k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.min(m, t[k * W + x]); o[y * W + x] = m; }
    return o;
  }
  function thin(ss, g, W, H, Pn, E, Tw, lt) {
    var out = [], mn = minF(g, W, H, Math.ceil(E / 2));
    function inb(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
    function at(x, y) { return inb(Math.round(x), Math.round(y)) ? g[Math.round(y) * W + Math.round(x)] : 255; }
    function ok(x, y) { return !inb(Math.round(x), Math.round(y)) || mn[Math.round(y) * W + Math.round(x)] >= lt; }
    ss.forEach(function (p) {
      if (p.er || p.dot || p.length < 2) return;
      var pts = [];
      for (var i = 1; i < p.length; i++) {
        var a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
        for (var k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      [1, -1].forEach(function (sd) {
        var cur = null;
        for (var i2 = 0; i2 < pts.length; i2++) {
          var a2 = pts[Math.max(0, i2 - 2)], b2 = pts[Math.min(pts.length - 1, i2 + 2)], dx = b2[0] - a2[0], dy = b2[1] - a2[1];
          var L = Math.hypot(dx, dy) || 1, nx = -sd * dy / L, ny = sd * dx / L, q = pts[i2], hw = 0;
          while (hw < Pn / 2 && at(q[0] + nx * hw, q[1] + ny * hw) < lt) hw += 0.5;
          hw = Math.max(hw, Tw / 2);
          var ex = q[0] + nx * (hw + E / 2), ey = q[1] + ny * (hw + E / 2);
          if (hw >= Pn / 2 - 0.2 || !ok(ex, ey)) { cur = null; continue; }
          if (!cur) { cur = []; out.push(cur); }
          cur.push([ex, ey]);
        }
      });
    });
    return out.filter(function (q) { return q.length > 1; }).map(function (q) { return tag(rdp(q, 0.35), 'e', 1); });
  }
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
  function errF(t, c) { var e = t - c; return e > 0 ? 1.5 * e * e : e * e; }
  function target(g, dith, thr) {
    var T = new Float32Array(g.length);
    for (var i = 0; i < g.length; i++) T[i] = dith ? (255 - g[i]) / 255 : (g[i] < thr ? 1 : 0);
    return T;
  }
  // Brush + eraser sweep, tile by tile. The canvas is split into nt x nt tiles, drawn from the top left to
  // the bottom right; each tile gets all of its brush and eraser passes before the next one starts. Every
  // stroke stays inside its own tile, so a finished tile is never drawn over and no tile inherits stray ink
  // it can't erase. nt = 1 is one tile.
  function sweep(g, W, H, dith, thr, B, E, nt, ps, Tin) {
    var T = Tin || target(g, dith, thr), cov = new Float32Array(W * H), Kp = kern(B), Ke = kern(Math.max(E, 0.5)), out = [];
    var rad = Math.ceil(Math.max(B, E) / 2);
    // a tile must be wide enough to hold strokes that stay clear of its finished neighbours
    var n = Math.max(1, Math.min(nt || 1, Math.floor(Math.min(W, H) / (2 * rad + 2))));
    var xs = [], ys = [], i;
    for (i = 0; i <= n; i++) { xs.push(Math.round(i * W / n)); ys.push(Math.round(i * H / n)); }
    function tryAt(x, y, K, er, lim) {
      var d = 0, k, X, Y, q, o;
      for (k = 0; k < K.length; k++) {
        X = x + K[k][0]; Y = y + K[k][1];
        if (X >= 0 && X < W && Y >= 0 && Y < H) {
          q = Y * W + X; o = cov[q];
          d += errF(T[q], er ? o * (1 - K[k][2]) : 1 - (1 - o) * (1 - K[k][2])) - errF(T[q], o);
        }
      }
      if (d >= lim) return false;
      for (k = 0; k < K.length; k++) {
        X = x + K[k][0]; Y = y + K[k][1];
        if (X >= 0 && X < W && Y >= 0 && Y < H) { q = Y * W + X; o = cov[q]; cov[q] = er ? o * (1 - K[k][2]) : 1 - (1 - o) * (1 - K[k][2]); }
      }
      return true;
    }
    for (var ty = 0; ty < n; ty++) for (var tx = 0; tx < n; tx++) {
      var tile = ty * n + tx;
      var ch = 0;
      for (var pp = 0; pp < (ps || 12) * 2; pp++) {
        var er = pp % 2, K = er ? Ke : Kp, lim = er ? -0.15 / (1 + (pp >> 1)) : 0;
        // keep each tool's tip just inside this tile: the brush can still ink the tile's edge rows and
        // columns, so dark areas have no seam, but nothing reaches a neighbouring tile
        var lb = Math.ceil((er ? Math.max(E, 0.5) : B) / 2 - 0.5);
        var x0 = xs[tx] + (tx ? lb : 0), x1 = xs[tx + 1] - (tx < n - 1 ? lb : 0), y0 = ys[ty] + (ty ? lb : 0), y1 = ys[ty + 1] - (ty < n - 1 ? lb : 0);
        for (var y = y0; y < y1; y++) {
          var row = [], s = -1;
          for (var x = x0; x <= x1; x++) {
            var on = x < x1 && tryAt(x, y, K, er, lim);
            if (on) ch++;
            if (on && s < 0) s = x;
            if (!on && s >= 0) {
              var p = [[s, y], [s === x - 1 ? s + 0.01 : x - 1, y]];
              tag(p, er ? 'e' : 's', er); p.band = tile; p.pass = pp >> 1;
              row.push(p); s = -1;
            }
          }
          if (y % 2) { row.reverse(); row.forEach(function (r2) { r2.reverse(); }); }
          for (i = 0; i < row.length; i++) out.push(row[i]);
        }
        if (pp % 2) { if (!ch) break; ch = 0; }
      }
    }
    out.tiles = n;
    out.cov = cov;
    return out;
  }
  /*
   * Put a whole-picture plan into tile order: nt x nt tiles from the top left to the bottom right, each
   * tile drawn completely (brush pass 1, eraser pass 1, brush pass 2, ...) before the next. Runs are cut
   * at tile edges. Planning the picture as a whole keeps the dithering continuous, so there are no seams;
   * only a brush tip's radius can touch the edge of a tile drawn earlier.
   */
  function tileOrder(strokes, W, H, nt) {
    var n = Math.max(1, nt | 0);
    if (n === 1) return strokes;
    var xs = [], ys = [], i;
    for (i = 0; i <= n; i++) { xs.push(i * W / n); ys.push(i * H / n); }
    var buckets = {};
    function put(tile, p) {
      var key = tile * 1000 + (p.pass || 0) * 2 + (p.er ? 1 : 0);
      (buckets[key] = buckets[key] || []).push(p);
    }
    strokes.forEach(function (p) {
      var y = p[0][1], ty = Math.min(n - 1, Math.floor(y / (H / n)));
      var a = Math.min(p[0][0], p[1][0]), b = Math.max(p[0][0], p[1][0]), rev = p[0][0] > p[1][0];
      for (var tx = 0; tx < n; tx++) {
        var lo = Math.max(a, Math.ceil(xs[tx] - 1e-9)), hi = Math.min(b, Math.ceil(xs[tx + 1] - 1e-9) - 1);
        if (b - a < 0.5) { if (a >= xs[tx] - 1e-9 && a < xs[tx + 1]) { lo = a; hi = b; } else continue; }
        if (hi < lo) continue;
        var q = rev ? [[hi, y], [lo === hi ? hi - 0.01 : lo, y]] : [[lo, y], [lo === hi ? lo + 0.01 : hi, y]];
        q.er = p.er; q.ty = p.ty; q.pass = p.pass; q.band = ty * n + tx;
        put(q.band, q);
      }
    });
    var out = [];
    Object.keys(buckets).map(Number).sort(function (u, v) { return u - v; }).forEach(function (k) {
      var list = buckets[k];
      for (i = 0; i < list.length; i++) out.push(list[i]);
    });
    out.tiles = n;
    return out;
  }
  function pixels(g, W, H, dith, thr, B, Tin) {
    var cov = new Float32Array(W * H), K = kern(B), out = [], T = Tin || target(g, dith, thr);
    for (var y = 0; y < H; y++) {
      var row = [], s = -1;
      for (var x = 0; x <= W; x++) {
        var on = false, k, X, Y, q;
        if (x < W) {
          var d = 0;
          for (k = 0; k < K.length; k++) {
            X = x + K[k][0]; Y = y + K[k][1];
            if (X >= 0 && X < W && Y >= 0 && Y < H) { q = Y * W + X; d += errF(T[q], 1 - (1 - cov[q]) * (1 - K[k][2])) - errF(T[q], cov[q]); }
          }
          if (d < 0) {
            on = true;
            for (k = 0; k < K.length; k++) {
              X = x + K[k][0]; Y = y + K[k][1];
              if (X >= 0 && X < W && Y >= 0 && Y < H) { q = Y * W + X; cov[q] = 1 - (1 - cov[q]) * (1 - K[k][2]); }
            }
          }
        }
        if (on && s < 0) s = x;
        if (!on && s >= 0) { row.push(tag([[s, y], [s === x - 1 ? s + 0.01 : x - 1, y]], 's')); s = -1; }
      }
      if (y % 2) { row.reverse(); row.forEach(function (r2) { r2.reverse(); }); }
      for (var i = 0; i < row.length; i++) out.push(row[i]);
    }
    out.cov = cov;
    return out;
  }
  function erase(g, W, H, lo, hi, gap, off, minL, E) {
    var out = [], hh = Math.ceil((E || 0) / 2);
    for (var a = off, r = 0; a < H; a += gap, r++) {
      var row = Math.min(H - 1, Math.round(a)), s = -1;
      for (var k = 0; k <= W; k++) {
        var vn = 999, vx = -1;
        if (k < W) for (var q = Math.max(0, row - hh); q <= Math.min(H - 1, row + hh); q++) { var u = g[q * W + k]; if (u < vn) vn = u; if (u > vx) vx = u; }
        var on = k < W && vx < 250 && (vn >= hi || (r % 2 && vn >= lo));
        if (on && s < 0) s = k;
        if (!on && s >= 0) {
          var e = k - 1, s2 = s > 0 ? s + hh : s, e2 = e < W - 1 ? e - hh : e;
          if (e2 - s2 + 1 >= minL) { var p = tag([[s2, a], [e2, a]], 'e', 1); if (r % 2) p.reverse(); out.push(p); }
          s = -1;
        }
      }
    }
    return out;
  }
  function painter(g, W, H, S, B) {
    var L = Math.max(S * 2.2, B * 3), PI = Math.PI;
    return brush(g, W, H, S, L, 0, 0, function (v) { return v < 235; }, 0)
      .concat(brush(g, W, H, S * 1.4, L, PI / 2, S * 0.4, function (v) { return v < 150; }, 0),
        brush(g, W, H, S * 1.8, L * 0.8, PI / 4, S * 0.2, function (v) { return v < 85; }, 0));
  }
  function layered(g, W, H, S, B, hl) {
    var L = Math.max(S * 2.2, B * 3), PI = Math.PI;
    return brush(g, W, H, S, L, 0, 0, function (v) { return v < 250; }, 0)
      .concat(dots(g, W, H, Math.max(S, B * 1.3), B, 0.45),
        brush(g, W, H, S * 1.2, L * 0.8, PI / 2, S * 0.3, function (v) { return v >= hl && v < 250; }, 1),
        brush(g, W, H, S * 2, L * 0.6, PI / 4, S * 0.5, function (v) { return v >= hl + 25 && v < 250; }, 1));
  }
  function combo(g, W, H, S, B, S2, P) {
    var dk = P.thr;
    var gd = g.map(function (v) { return v < dk ? 255 : v; }), ge = g.map(function (v) { return v < dk ? v : 255; });
    return hatch(g, W, H, dk, S2, P.min, true, S2, 0.85)
      .concat(erase(ge, W, H, dk * 0.6, 999, S2, (S2 - 1) / 2, P.min, px(P, W, P.esz)),
        dots(gd, W, H, Math.max(S, B * 1.3), B, (255 - P.dth) / 255),
        edges(g, W, H, P.sen, P.min));
  }
  // line spacing from the image's average darkness, so mid-tones come out right with this brush
  function autoSpacing(g, W, H, P) {
    if (!P.auto) return [P.gap, P.gap2];
    var B = px(P, W, P.pen), thr = P.thr, sum = 0, n = 0, ds = 0, dn = 0, ed = 0;
    for (var i = 0; i < W * H - W - 1; i++) {
      var v = g[i];
      if (v < 250) { sum += v; n++; if (v < thr * 0.55) { ds += v; dn++; } }
      if (Math.abs(v - g[i + 1]) + Math.abs(v - g[i + W]) > 40) ed++;
    }
    var busy = ed / (W * H), k = busy > 0.15 ? 0.75 : busy < 0.05 ? 1.25 : 1;
    var lo = Math.max(1, Math.round(B));
    if (P.trim) lo = Math.max(lo, Math.ceil((B + px(P, W, P.tw)) / 2 + px(P, W, P.esz)));
    function dens(m) { return Math.max(0.15, (255 - m) / 255); }
    function c(v) { return Math.max(lo, Math.min(30, Math.round(v))); }
    var a = c(B / dens(n ? sum / n : 128) * k), b = Math.max(lo, Math.min(c(B / dens(dn ? ds / dn : 40) * k), a - 1));
    return [a, b];
  }

  // the whole pipeline for one set of settings, on an already-adjusted image g
  function plan(g, W, H, P) {
    var md = P.mode, pen = px(P, W, P.pen), esz = px(P, W, P.esz);
    var er = P.era && md !== 'e', T = er ? 250 : P.thr, sp = autoSpacing(g, W, H, P), gp = sp[0];
    function fill() { return hatch(g, W, H, T, gp, P.min, P.cross, sp[1]); }
    function line() { return edges(g, W, H, P.sen, P.min); }
    function er0() { return er ? erase(g, W, H, P.thr, P.hl, gp, md === 'c' ? gp / 2 : (gp - 1) / 2, P.min, esz) : []; }
    var S;
    if (md === 'z' || md === 'w') S = tileOrder(sweep(g, W, H, md === 'z', P.thr, pen, esz, 1, P.ps), W, H, P.tn);
    else if (md === 'x' || md === 'y') S = pixels(g, W, H, md === 'x', P.thr, pen);
    else if (md === 'd') S = dots(g, W, H, Math.max(gp, pen * 1.3), pen, (255 - P.dth) / 255);
    else if (md === 'p') S = painter(g, W, H, gp, pen);
    else if (md === 'm') S = combo(g, W, H, gp, pen, sp[1], P);
    else if (md === 'l') S = layered(g, W, H, gp, pen, P.hl);
    else if (md === 'h') S = fill().concat(er0());
    else if (md === 'e') S = line();
    else if (md === 'c') S = curves(g, W, H, T, gp, P.min).concat(er0());
    else S = fill().concat(er0(), line());
    if (P.trim && md !== 'z' && md !== 'w') S = S.concat(thin(S, g, W, H, pen, esz, px(P, W, P.tw), 170));
    if (P.tile && md !== 'z' && md !== 'w') S = tileSweep(S, W, H, P.tn, esz, P.guard);
    return { strokes: S, gap: sp };
  }

  /* ---------- how close is a drawing to the image ---------- */

  // draw the strokes as the phone would (black brush, white eraser, round tips) and read back ink coverage 0..1
  function rasterize(strokes, W, H, P, makeCanvas, sc) {
    sc = sc || 2;
    var c = makeCanvas(W * sc, H * sc), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, W * sc, H * sc);
    x.lineCap = x.lineJoin = 'round';
    var pen = px(P, W, P.pen) * sc, esz = px(P, W, P.esz) * sc, cur = -1;
    x.beginPath();
    for (var i = 0; i < strokes.length; i++) {
      var p = strokes[i], er = p.er ? 1 : 0;
      if (er !== cur) {
        if (cur !== -1) x.stroke();
        x.beginPath(); x.strokeStyle = er ? '#fff' : '#000'; x.lineWidth = er ? esz : pen; cur = er;
      }
      x.moveTo((p[0][0] + 0.5) * sc, (p[0][1] + 0.5) * sc);
      for (var j = 1; j < p.length; j++) x.lineTo((p[j][0] + 0.5) * sc, (p[j][1] + 0.5) * sc);
    }
    if (cur !== -1) x.stroke();
    var d = x.getImageData(0, 0, W * sc, H * sc).data, out = new Float32Array(W * H), n = sc * sc;
    for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
      var s = 0;
      for (var b = 0; b < sc; b++) for (var a = 0; a < sc; a++) s += d[(((yy * sc + b) * W * sc) + xx * sc + a) * 4];
      out[yy * W + xx] = 1 - s / (255 * n);
    }
    return out;
  }
  // separable box blur, repeated three times (close to a gaussian)
  // iters: 3 (default) is close to a gaussian; 1 is a plain box
  function boxBlur(src, W, H, r, iters) {
    if (r < 1) return src;
    var a = Float32Array.from(src), b = new Float32Array(W * H), x, y, s, i, n = 2 * r + 1;
    for (var it = 0; it < (iters || 3); it++) {
      for (y = 0; y < H; y++) {
        s = 0;
        for (x = -r; x <= r; x++) s += a[y * W + Math.min(W - 1, Math.max(0, x))];
        for (x = 0; x < W; x++) {
          b[y * W + x] = s / n;
          s += a[y * W + Math.min(W - 1, x + r + 1)] - a[y * W + Math.max(0, x - r)];
        }
      }
      for (x = 0; x < W; x++) {
        s = 0;
        for (y = -r; y <= r; y++) s += b[Math.min(H - 1, Math.max(0, y)) * W + x];
        for (y = 0; y < H; y++) {
          a[y * W + x] = s / n;
          s += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
        }
      }
    }
    void i;
    return a;
  }
  // resample a W x H map onto a CW x CH grid (area average from 3 x 3 samples per cell)
  function resample(src, W, H, CW, CH) {
    if (W === CW && H === CH) return src;
    var out = new Float32Array(CW * CH), sx = W / CW, sy = H / CH;
    for (var y = 0; y < CH; y++) for (var x = 0; x < CW; x++) {
      var s = 0;
      for (var j = 0; j < 3; j++) for (var i = 0; i < 3; i++) {
        var X = Math.min(W - 1, Math.floor((x + (i + 0.5) / 3) * sx)), Y = Math.min(H - 1, Math.floor((y + (j + 0.5) / 3) * sy));
        s += src[Y * W + X];
      }
      out[y * CW + x] = s / 9;
    }
    return out;
  }
  // SSIM's contrast-structure term (no brightness term): do edges and textures line up, and is there
  // texture in the drawing where the image has it? Flat areas only match flat areas.
  function contrastStructure(a, b, W, H, r, iters) {
    var n = W * H, aa = new Float32Array(n), bb = new Float32Array(n), ab = new Float32Array(n), i;
    for (i = 0; i < n; i++) { aa[i] = a[i] * a[i]; bb[i] = b[i] * b[i]; ab[i] = a[i] * b[i]; }
    var ma = boxBlur(a, W, H, r, iters), mb = boxBlur(b, W, H, r, iters), Saa = boxBlur(aa, W, H, r, iters), Sbb = boxBlur(bb, W, H, r, iters), Sab = boxBlur(ab, W, H, r, iters);
    var C2 = 9e-4, s = 0;
    for (i = 0; i < n; i++) {
      var va = Math.max(0, Saa[i] - ma[i] * ma[i]), vb = Math.max(0, Sbb[i] - mb[i] * mb[i]), cv = Sab[i] - ma[i] * mb[i];
      s += (2 * cv + C2) / (va + vb + C2);
    }
    return s / n;
  }
  // How close a drawing looks to the image, judged on a common grid (one cell ~ 4.4 phone px) so every
  // style is compared at the same physical scale. Both are softened by about a brush width (how a 6 px
  // pen drawing reads), then scored on structure (shapes, edges, where texture is) plus overall tone.
  // There is deliberately no per-pixel brightness match: that rewards speckled dithering that averages
  // to the right grey over clean shapes on plain paper.
  function compare(ink, tgt, W, H, P) {
    var CW = Math.max(16, Math.round((P.rw || 880) / 4.4)), CH = Math.max(16, Math.round((P.rh || 880) / 4.4));
    var ra = resample(ink, W, H, CW, CH), rb = resample(tgt, W, H, CW, CH);
    var a = boxBlur(ra, CW, CH, 1), b = boxBlur(rb, CW, CH, 1);
    var st = contrastStructure(a, b, CW, CH, 2);
    // the same seen up close: dot noise that a soft view averages away shows here as structure that
    // isn't in the image, while clean edges still line up. Photos tend to win the soft view with a
    // halftone, illustrations the sharp view with clean shapes; the sum picks well for both.
    var sharp = contrastStructure(boxBlur(ra, CW, CH, 1, 1), boxBlur(rb, CW, CH, 1, 1), CW, CH, 2, 1);
    var a3 = boxBlur(a, CW, CH, 3), b3 = boxBlur(b, CW, CH, 3), m = 0, n = CW * CH;
    for (var i = 0; i < n; i++) { var d = a3[i] - b3[i]; m += d * d; }
    m /= n;
    var cost = (1 - st) + (1 - sharp) + m;
    return { cost: cost, soft: (1 - st) + m, match: Math.max(0, Math.min(100, 100 * (1 - cost / 1.8))), ssim: st, sharp: sharp };
  }
  // what the drawing is trying to look like: the photo's darkness on white paper (and inside the circle)
  function inkTarget(base, W, H, P) {
    var t = new Float32Array(W * H), circ = P.shape === 'circle';
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = y * W + x;
      t[i] = circ && !inCircle(x, y, W, H) ? 0 : 1 - base[i] / 255;
    }
    return t;
  }

  /* ---------- auto-match ---------- */

  // a sensible starting tone from the image: stretch the 5th..95th percentiles across the range
  function autoLevels(base, P) {
    var h = new Uint32Array(256), n = 0;
    for (var i = 0; i < base.length; i++) { var v = base[i] | 0; if (v < 252) { h[v]++; n++; } }
    if (n < 50) return { br: 0, co: 0, gm: 100 };
    function pct(q) { var k = 0, c = 0; while (k < 255 && c + h[k] < q * n) { c += h[k]; k++; } return k; }
    var lo = pct(0.05), hi = pct(0.95), mid = (lo + hi) / 2;
    var f = clamp(230 / Math.max(30, hi - lo), 0.6, 2.2);
    var c = 255 * 259 * (f - 1) / (259 + 255 * f), co = Math.round(clamp(c / 2.55, -60, 60));
    var fr = 259 * (co * 2.55 + 255) / (255 * (259 - co * 2.55)), br = Math.round(clamp(-(mid - 128) * fr / 2.55, -50, 50));
    return { br: br, co: co, gm: 100 };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // what each style is allowed to change during the search, with ranges and first step sizes
  var RANGES = { br: [-70, 70, 16], co: [-80, 80, 20], gm: [40, 250, 30], thr: [30, 235, 30], dth: [150, 254, 20], sen: [0, 100, 20], hl: [120, 250, 25], tn: [2, 12, 3], ps: [1, 12, 3], lc: [0, 100, 25] };
  var SEEDS = [];
  function tunable(mode) {
    var k = ['br', 'co', 'gm'];
    if ('whbcym'.indexOf(mode) >= 0) k.push('thr');
    if (mode === 'd' || mode === 'm') k.push('dth');
    if (mode === 'e' || mode === 'b') k.push('sen');
    if (mode === 'z' || mode === 'w') k.push('ps'); // the tile count is the user's choice, not tuned
    return k;
  }

  /*
   * Search for the settings whose drawing comes closest to the image.
   * img: an image or ImageBitmap; P0: current settings (phone size, brush, shape and fit are kept);
   * env: { makeCanvas, onProgress(pct, best), now }. Styles are screened at a reduced size, the best
   * two are tuned by coordinate descent, and the winner gets a last refinement at full size.
   */
  function autoMatch(img, P0, env) {
    var make = env.makeCanvas, report = env.onProgress || function () {}, now = env.now || function () { return Date.now(); };
    var cache = {};
    function baseFor(W, H) { var k = W + 'x' + H; if (!cache[k]) cache[k] = luminance(img, W, H, P0.fit, make); return cache[k]; }
    // k < 1 draws only the centre k x k of the canvas at full scale: a quarter of the work at k = 0.5,
    // with the brush still the right size relative to the picture
    function evaluate(P, k) {
      var G = grid(P), base = baseFor(G.W, G.H), Q = P, W = G.W, H = G.H;
      if (k < 1) {
        W = Math.max(16, Math.round(G.W * k)); H = Math.max(16, Math.round(G.H * k));
        var x0 = Math.floor((G.W - W) / 2), y0 = Math.floor((G.H - H) / 2), c = new Float32Array(W * H);
        for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) c[y * W + x] = base[(y + y0) * G.W + x + x0];
        base = c;
        Q = copy(P); Q.rw = P.rw * W / G.W; Q.rh = P.rh * H / G.H; Q.shape = 'rect';
      }
      var g = adjust(base, W, H, Q), r = plan(g, W, H, Q);
      var tg = inkTarget(base, W, H, Q), ink = rasterize(r.strokes, W, H, Q, make, 2), sc = compare(ink, tg, W, H, Q);
      var si = 0, st = 0;
      for (var q = 0; q < ink.length; q++) { si += ink[q]; st += tg[q]; }
      sc.inkMean = si / ink.length; sc.tgtMean = st / tg.length;
      // drawing time: a little for every stroke (ties go to the cleaner drawing), much more past ~50k
      // strokes (about 4 h on the phone)
      var full = r.strokes.length * (G.W * G.H) / (W * H);
      sc.strokes = full;
      var extra = full / 1e6 + Math.max(0, full - 50000) / 100000;
      sc.comb = sc.cost + extra;
      sc.cost = sc.cost + extra;
      return sc;
    }
    var G0 = grid(withDefaults({ mode: 'h', rw: P0.rw, rh: P0.rh, res: P0.res }));
    var lv = autoLevels(baseFor(G0.W, G0.H), P0);
    var start = withDefaults(P0);
    // pixel styles start neutral (halftoning handles mid-tones); line styles start from auto-levels
    var px0 = isPixel(P0.mode || 'z');
    start.br = px0 ? 0 : lv.br; start.co = px0 ? 0 : lv.co; start.gm = px0 ? 100 : lv.gm; start.auto = true; start.sm = 0;
    // detail grid for line styles: roughly two cells per brush width
    start.res = clamp(Math.round(2 * (start.rw || 880) / start.pen), 120, 320);

    // always the pixel sweep unless a caller asks for other styles
    var modes = env.modes || ['z'];
    var K = 0.65, done = 0, total = modes.length * 24 + 3 * 18 + 9 + 2 + 12, best = null;
    function tick(extra) { done++; report(Math.min(99, Math.round(100 * done / total)), best, extra); }

    // coordinate descent: nudge each setting up and down, keep what helps, halve the steps when stuck
    function descend(item, k, budget, only) {
      var keys = only || tunable(item.P.mode), step = {}, cur = item, evals = 0;
      keys.forEach(function (q) { step[q] = RANGES[q][2]; });
      while (evals < budget) {
        var improved = false;
        for (var i = 0; i < keys.length && evals < budget; i++) {
          var q = keys[i];
          for (var sgn = -1; sgn <= 1 && evals < budget; sgn += 2) {
            var P = copy(cur.P), v = clamp(P[q] + sgn * step[q], RANGES[q][0], RANGES[q][1]);
            if (v === P[q]) continue;
            P[q] = v;
            var r = evaluate(P, k); evals++;
            if (r.cost < cur.cost - 1e-6) { cur = { P: P, cost: r.cost, match: r.match, comb: r.comb }; improved = true; }
            if (k === K && (!best || cur.cost < best.cost)) best = cur;
            tick();
          }
        }
        if (!improved) {
          var small = true;
          keys.forEach(function (q) { step[q] = Math.max(2, Math.round(step[q] / 2)); if (step[q] > 4) small = false; });
          if (small) break;
        }
      }
      return cur;
    }

    function lineSearch(item, k, key, values) {
      values.forEach(function (v) {
        v = clamp(v, RANGES[key][0], RANGES[key][1]);
        if (v === item.P[key]) { tick(); return; }
        var P = copy(item.P); P[key] = v;
        var r = evaluate(P, k);
        if (r.cost < item.cost) item = { P: P, cost: r.cost, match: r.match, comb: r.comb };
        tick();
      });
      return item;
    }

    var lookBest = [];
    // 1. every style at half size, with a quick brightness and midtones correction (each style darkens differently)
    var ranked = modes.map(function (m) {
      var P = copy(start); P.mode = m;
      if (m === 'e') P.sen = 55;
      var r = evaluate(P, K);
      var item = { P: P, cost: r.cost, match: r.match, comb: r.comb };
      tick(m);
      // outline-only can't reproduce tone, so it gets one try
      if (m === 'e') return item;
      // contrast and midtones work together; a 6 px pen saturates, so the dithered sweep usually wants less
      // contrast and deeper midtones than the photo. Local contrast stays as set (default 50).
      var looks = m === 'z' || m === 'x'
        ? [{ lc: P.lc, a: ['co', [-50, -30, -10, 10]], b: ['gm', [70, 100, 140]] }]
        : [{ lc: P.lc, a: ['co', [-25, 0, 25]], b: ['gm', [75, 100, 130]] }];
      looks.forEach(function (lk) {
        var before = item, lkBest = null, bs = lk.b ? lk.b[1] : [null];
        lk.a[1].forEach(function (av) {
          bs.forEach(function (bv) {
            var Q = copy(P); Q[lk.a[0]] = av; if (lk.b) Q[lk.b[0]] = bv; Q.lc = lk.lc;
            var rq = evaluate(Q, K), c = { P: Q, cost: rq.cost, match: rq.match, comb: rq.comb };
            if (!lkBest || c.cost < lkBest.cost) lkBest = c;
            if (rq.cost < item.cost) item = c;
            tick();
          });
        });
        // the best of each look also goes to the full-size final, so a crop can't decide the look alone
        if (looks.length > 1 && lkBest) lookBest.push(lineSearch(lkBest, K, 'br', [lkBest.P.br - 12, lkBest.P.br + 12]));
        void before;
      });
      item = lineSearch(item, K, 'br', [item.P.br - 24, item.P.br - 12, item.P.br + 12, item.P.br + 24]);
      if (!best || item.cost < best.cost) best = item;
      return item;
    }).sort(function (a, b) { return a.cost - b.cost; });

    // 2. all of each style's settings, for the three closest styles
    var finals = ranked.slice(0, 3);
    lookBest.forEach(function (c) { if (finals.indexOf(c) < 0) finals.push(c); });
    var tuned = finals.map(function (it) { return descend(it, K, 18); }).sort(function (a, b) { return a.cost - b.cost; });

    // 3. judge the finalists on the whole picture, then refine the winner at full size
    var win = null, perMode = {};
    var perLook = {};
    function lookOf(P) { return P.lc > 0 ? 'local' : 'plain'; }
    function keep(c) {
      if (!perMode[c.P.mode] || c.cost < perMode[c.P.mode].cost) perMode[c.P.mode] = c;
      if (!perLook[lookOf(c.P)] || c.cost < perLook[lookOf(c.P)].cost) perLook[lookOf(c.P)] = c;
      if (!win || c.comb < win.comb) win = c;
    }
    tuned.forEach(function (t) {
      var f = evaluate(t.P, 1);
      t.full = f.match;
      keep({ P: t.P, cost: f.cost, match: f.match, comb: f.comb });
      tick();
    });
    // finalists swap tone settings: styles of one family often share the best tone, and the crop can mislead
    tuned.forEach(function (t) {
      tuned.forEach(function (o) {
        if (o === t || (o.P.br === t.P.br && o.P.co === t.P.co && o.P.gm === t.P.gm)) return;
        var Q = copy(t.P); Q.br = o.P.br; Q.co = o.P.co; Q.gm = o.P.gm;
        var f = evaluate(Q, 1);
        keep({ P: Q, cost: f.cost, match: f.match, comb: f.comb });
        tick();
      });
    });
    // starting points that have worked well for the pixel sweep (it is greedy, so its score is bumpy)
    SEEDS.forEach(function (sd) {
      if (modes.indexOf(sd.mode) < 0) return;
      var Q = copy(start); for (var k in sd) Q[k] = sd[k];
      var f = evaluate(Q, 1);
      keep({ P: Q, cost: f.cost, match: f.match, comb: f.comb });
      tick();
    });
    best = win;
    if (env.debug) env.debug(tuned.map(function (t) { return t.P.mode + ' crop ' + t.match.toFixed(1) + ' full ' + t.full.toFixed(1) + ' ' + ['br', 'co', 'gm', 'thr', 'tn', 'ps'].map(function (k) { return k + t.P[k]; }).join(' '); }));
    var two = Object.keys(perMode).map(function (k) { return perMode[k]; }).sort(function (a, b) { return a.cost - b.cost; }).slice(0, 2);
    two.forEach(function (c) { keep(descend(c, 1, 6)); });
    // the other look gets a short refinement too, so both choices offered are tuned at full size
    Object.keys(perLook).forEach(function (k) { if (k !== lookOf(win.P)) keep(descend(perLook[k], 1, 4)); });
    // 4. tone balance: shift brightness (bisection) until the drawing uses as much ink overall as the
    // picture is dark, so a drawing that came out heavy gets lighter and a pale one darker
    function balance(c) {
      var lo = -70, hi = 70, P = copy(c.P), r = evaluate(P, 1);
      // light dithering takes many more strokes than solid ink: don't lighten past ~60k strokes (about 5 h)
      var cap = Math.max(60000, r.strokes * 1.3);
      var out = { P: P, cost: r.cost, match: r.match, comb: r.comb, off: r.inkMean - r.tgtMean, strokes: r.strokes };
      for (var it = 0; it < 7 && Math.abs(r.inkMean - r.tgtMean) > 0.015; it++) {
        var tooMany = r.strokes > cap;
        if (r.inkMean > r.tgtMean && !tooMany) lo = P.br; else hi = P.br;   // too much ink: brighter
        var Q = copy(P); Q.br = Math.round((lo + hi) / 2);
        if (Q.br === P.br) break;
        P = Q; r = evaluate(P, 1); tick();
        var off = r.inkMean - r.tgtMean;
        if (r.strokes <= cap && Math.abs(off) < Math.abs(out.off)) out = { P: P, cost: r.cost, match: r.match, comb: r.comb, off: off, strokes: r.strokes };
      }
      return out;
    }
    // very low contrast can make the sweep fall off a cliff (a hair too dark, then blank), so also balance
    // from a couple of normal-contrast starting points and keep the best balanced drawing
    var startStrokes = evaluate(win.P, 1).strokes, tries = [win];
    [[0, 100], [0, 140]].forEach(function (cg) {
      if (cg[0] === win.P.co && cg[1] === win.P.gm) return;
      var Q = copy(win.P); Q.co = cg[0]; Q.gm = cg[1]; Q.br = 0;
      tries.push({ P: Q });
    });
    var bal = tries.map(balance), capAll = Math.max(60000, startStrokes * 1.3);
    var ok = bal.filter(function (b) { return Math.abs(b.off) <= 0.05 && b.strokes <= capAll; });
    win = ok.length ? ok.sort(function (x, y) { return x.cost - y.cost; })[0]
      : bal.sort(function (x, y) { return Math.abs(x.off) - Math.abs(y.off); })[0];
    if (env.debug) env.debug(['balanced: br ' + win.P.br + ', ink - picture ' + win.off.toFixed(3)]);
    done = total; report(100, win);
    var looks = {};
    Object.keys(perLook).forEach(function (k) { looks[k] = { P: perLook[k].P, match: perLook[k].match }; });
    return { P: win.P, match: win.match, look: lookOf(win.P), looks: looks, ranking: ranked.map(function (r) { return { mode: r.P.mode, match: Math.round(r.match) }; }) };
  }

  /* ---------- script for the phone ---------- */

  function sh(lines) { return lines.join('\n') + '\n'; }
  var HEAD = ['#!/system/bin/sh', '[ -z "$DRAW_LF" ] && { tr -d "\\r" < "$0" > /sdcard/.draw_lf.sh; DRAW_LF=1 sh /sdcard/.draw_lf.sh; exit 0; } #'];
  function fpts(p, W, H, Ph) {
    var Pt = p.map(function (a) { return [Ph.rx + (a[0] + 0.5) / W * Ph.rw, Ph.ry + (a[1] + 0.5) / H * Ph.rh]; }), out = [Pt[0]];
    for (var i = 1; i < Pt.length; i++) {
      var a = Pt[i - 1], b = Pt[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 40));
      for (var k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    return out;
  }
  function fstroke(L, Pt, id, Ph) {
    var dev = Ph.tdev || '/dev/input/event8', sx = Ph.mx / Ph.scw, sy = Ph.my / Ph.sch;
    function X(a) { return Math.round(a[0] * sx); }
    function Y(a) { return Math.round(a[1] * sy); }
    function ev(t) {
      if (Ph.mc) L.push('sendevent ' + dev + ' ' + t.join(' '));
      else for (var i = 0; i < t.length; i += 3) L.push('sendevent ' + dev + ' ' + t.slice(i, i + 3).join(' '));
    }
    ev([3, 57, id, 3, 48, 12, 3, 53, X(Pt[0]), 3, 54, Y(Pt[0]), 1, 330, 1, 1, 325, 1, 0, 0, 0]);
    for (var i = 1; i < Pt.length; i++) ev([3, 53, X(Pt[i]), 3, 54, Y(Pt[i]), 0, 0, 0]);
    ev([3, 57, -1, 1, 330, 0, 1, 325, 0, 0, 0, 0]);
  }
  function taps(text) {
    return (text || '').split(';').map(function (s) { return s.trim().split(/[ ,]+/).map(Number); })
      .filter(function (a) { return a.length === 2 && !a.some(isNaN); });
  }
  function toolSwitch(eraser, L, Ph) {
    var bx = eraser ? Ph.ex : Ph.tx, by = eraser ? Ph.ey : Ph.ty, d = Ph.sd || 2, pr = Ph.pt;
    var list = (bx || by ? [[bx, by]] : []).concat(taps(eraser ? Ph.ex2 : Ph.tx2));
    L.push('echo "Tool: ' + (eraser ? 'eraser' : 'pen') + '"');
    L.push('sleep ' + d / 2);
    if (!list.length) { L.push('echo "Switch to the ' + (eraser ? 'eraser' : 'pen') + ' now"'); L.push('sleep ' + d * 5); }
    else list.forEach(function (m) {
      L.push(pr > 0 ? 'input swipe ' + m[0] + ' ' + m[1] + ' ' + m[0] + ' ' + m[1] + ' ' + pr : 'input tap ' + m[0] + ' ' + m[1]);
      L.push('sleep ' + d);
    });
  }
  // Ph: phone settings { rx, ry, rw, rh, method: 'sw'|'mo'|'fe', dur, ex, ey, tx, ty, ex2, tx2, sd, pt, tdev, mx, my, scw, sch, mc }
  function script(strokes, W, H, Ph) {
    function X(p) { return Math.round(Ph.rx + (p[0] + 0.5) / W * Ph.rw); }
    function Y(p) { return Math.round(Ph.ry + (p[1] + 0.5) / H * Ph.rh); }
    var L = HEAD.concat(['# HeyTea sticker auto-draw: ' + strokes.length + ' strokes']), tool = 0, sid = 0;
    strokes.forEach(function (p) {
      var e = p[p.length - 1], t = p.er ? 1 : 0;
      if (t !== tool) { tool = t; toolSwitch(t, L, Ph); }
      if (Ph.method === 'fe') fstroke(L, fpts(p, W, H, Ph), (sid++) % 60000 + 1, Ph);
      else if (Ph.method === 'mo') {
        L.push('input motionevent DOWN ' + X(p[0]) + ' ' + Y(p[0]));
        for (var i = 1; i < p.length; i++) L.push('input motionevent MOVE ' + X(p[i]) + ' ' + Y(p[i]));
        L.push('input motionevent UP ' + X(e) + ' ' + Y(e));
      } else for (var j = 1; j < p.length; j++) L.push('input swipe ' + X(p[j - 1]) + ' ' + Y(p[j - 1]) + ' ' + X(p[j]) + ' ' + Y(p[j]) + ' ' + Ph.dur);
    });
    return sh(L);
  }
  // a short script that draws a line, erases a gap in it, then draws a second line
  function testScript(W, H, Ph) {
    var L = HEAD.concat(['# Tool switch test: pen line, eraser gap, pen line']);
    function go(y, a, b) {
      if (Ph.method === 'fe') fstroke(L, fpts([[a * W - 0.5, y * H - 0.5], [b * W - 0.5, y * H - 0.5]], W, H, Ph), 1, Ph);
      else L.push('input swipe ' + Math.round(Ph.rx + Ph.rw * a) + ' ' + Math.round(Ph.ry + Ph.rh * y) + ' ' + Math.round(Ph.rx + Ph.rw * b) + ' ' + Math.round(Ph.ry + Ph.rh * y) + ' 400');
    }
    L.push('echo "pen line 1"'); go(0.3, 0.1, 0.9);
    toolSwitch(1, L, Ph); L.push('echo "eraser gap"'); go(0.3, 0.4, 0.6);
    toolSwitch(0, L, Ph); L.push('echo "pen line 2"'); go(0.6, 0.1, 0.9); L.push('echo done');
    return sh(L);
  }
  // rough phone time from the script: each sendevent ~6 ms, each input command ~0.3 s, plus sleeps
  function estimate(text) {
    var sec = 0, calls = 0;
    text.split('\n').forEach(function (l) {
      var m = l.match(/^sleep ([\d.]+)/);
      if (/^sendevent/.test(l)) { sec += 0.006; calls++; }
      else if (/^input/.test(l)) { sec += 0.3; calls++; }
      else if (m) sec += +m[1];
    });
    return { sec: sec, calls: calls };
  }

  root.StickerEngine = {
    DEFAULTS: DEFAULTS, STYLES: STYLES, isPixel: isPixel, withDefaults: withDefaults, copy: copy,
    grid: grid, px: px, luminance: luminance, adjust: adjust, plan: plan,
    rasterize: rasterize, compare: compare, inkTarget: inkTarget, autoMatch: autoMatch,
    script: script, testScript: testScript, estimate: estimate
  };
})(typeof self !== 'undefined' ? self : this);
