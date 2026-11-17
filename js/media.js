/*
 * AsciiMedia: small generative ASCII pieces that stand in for project media.
 * Each mode returns an intensity per cell (0..1), with optional text overlays.
 */
(function () {
  'use strict';

  var RAMP = ' .·:-~=+*x%#@';
  var LEVELS = 7;
  var TAU = Math.PI * 2;

  function rand(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  /* ----- modes: each returns { init(cols, rows), frame(buf, txt, t, cols, rows, aspect) } ----- */

  var MODES = {};

  MODES.brush = function () {
    // Pressure-tapered strokes painted over a faint tile grid (a nod to a tiled canvas engine).
    var ink = null, c0 = 0, r0 = 0, R = rand(31);
    var stroke = null, strokes = 0, fade = 0, lastT = 0;
    function newStroke(cols, rows) {
      var x0 = 0.12 + R() * 0.3, y0 = 0.2 + R() * 0.6;
      return {
        s: 0,
        speed: 0.28 + R() * 0.18,
        ax: x0, ay: y0,
        bx: 0.55 + R() * 0.33, by: 0.15 + R() * 0.7,
        w1: 0.6 + R() * 1.4, w2: 0.8 + R() * 1.8,
        p1: R() * TAU, p2: R() * TAU,
        amp: 0.06 + R() * 0.12,
        size: 1.2 + R() * 1.6
      };
    }
    function at(st, s) {
      var x = st.ax + (st.bx - st.ax) * s;
      var y = st.ay + (st.by - st.ay) * s +
        st.amp * Math.sin(s * TAU * st.w1 * 0.5 + st.p1) + st.amp * 0.5 * Math.sin(s * TAU * st.w2 + st.p2);
      return [x, y];
    }
    return {
      frame: function (buf, txt, t, cols, rows) {
        if (cols !== c0 || rows !== r0) {
          c0 = cols; r0 = rows; ink = new Float32Array(cols * rows);
          stroke = newStroke(cols, rows); strokes = 0; fade = 0; lastT = t;
        }
        var dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        if (fade > 0) {
          fade -= dt;
          for (var q = 0; q < ink.length; q++) ink[q] *= 0.9;
          if (fade <= 0) { stroke = newStroke(cols, rows); strokes = 0; }
        } else if (stroke) {
          var prev = stroke.s;
          stroke.s = Math.min(1, stroke.s + dt * stroke.speed);
          var steps = Math.max(1, Math.ceil((stroke.s - prev) * cols * 2));
          for (var k = 1; k <= steps; k++) {
            var s = prev + (stroke.s - prev) * (k / steps);
            var pt = at(stroke, s);
            var pressure = Math.sin(Math.PI * Math.min(1, s * 1.15));
            var rad = stroke.size * (0.35 + pressure);
            var cx = pt[0] * cols, cy = pt[1] * rows;
            var ry = rad * 0.5;
            for (var j = Math.floor(cy - ry - 1); j <= Math.ceil(cy + ry + 1); j++) {
              if (j < 0 || j >= rows) continue;
              for (var i = Math.floor(cx - rad - 1); i <= Math.ceil(cx + rad + 1); i++) {
                if (i < 0 || i >= cols) continue;
                var dx = (i + 0.5 - cx) / rad, dy = (j + 0.5 - cy) / Math.max(0.6, ry);
                var dd = dx * dx + dy * dy;
                if (dd > 1) continue;
                var idx = i + j * cols;
                ink[idx] = Math.min(1, Math.max(ink[idx], (1 - dd * 0.6) * (0.55 + pressure * 0.45)));
              }
            }
          }
          if (stroke.s >= 1) {
            strokes++;
            if (strokes >= 6) { fade = 1.2; stroke = null; } else stroke = newStroke(cols, rows);
          }
        }
        var tx = Math.max(6, Math.round(cols / 6)), ty = Math.max(3, Math.round(rows / 4));
        var head = stroke ? at(stroke, stroke.s) : null;
        var hi = head ? Math.round(head[0] * cols - 0.5) : -1, hj = head ? Math.round(head[1] * rows - 0.5) : -1;
        for (var jj = 0; jj < rows; jj++) {
          for (var ii = 0; ii < cols; ii++) {
            var o = ii + jj * cols;
            var grid = (ii % tx === 0 && jj % ty === 0) ? 0.22 : (ii % tx === 0 || jj % ty === 0) ? 0.08 : 0;
            buf[o] = Math.max(grid, ink[o] * 0.92);
            txt[o] = ink[o] > 0.05 ? '' : (ii % tx === 0 && jj % ty === 0) ? '+' : '';
          }
        }
        if (hi >= 0 && hi < cols && hj >= 0 && hj < rows) { var h = hi + hj * cols; buf[h] = 1; txt[h] = 'o'; }
      }
    };
  };

  /* text helper shared by the text-based modes */
  function puts(buf, txt, cols, rows, i, j, str, v) {
    if (j < 0 || j >= rows) return;
    for (var c = 0; c < str.length; c++) {
      var x = i + c;
      if (x < 0 || x >= cols) continue;
      var k = x + j * cols;
      if (str[c] === ' ') { continue; }
      txt[k] = str[c]; buf[k] = v;
    }
  }
  function clear(buf, txt) { buf.fill(0); for (var q = 0; q < txt.length; q++) txt[q] = ''; }

  MODES.player = function () {
    // Handheld player face: screen with a live spectrum, d-pad, A/B, and the encoder knob.
    return {
      frame: function (buf, txt, t, cols, rows, asp) {
        clear(buf, txt);
        var R = cols - 1, B = rows - 1;
        for (var i = 0; i <= R; i++) { puts(buf, txt, cols, rows, i, 0, '-', 0.42); puts(buf, txt, cols, rows, i, B, '-', 0.42); }
        for (var j = 0; j <= B; j++) { puts(buf, txt, cols, rows, 0, j, '|', 0.42); puts(buf, txt, cols, rows, R, j, '|', 0.42); }
        puts(buf, txt, cols, rows, 0, 0, '+', 0.5); puts(buf, txt, cols, rows, R, 0, '+', 0.5);
        puts(buf, txt, cols, rows, 0, B, '+', 0.5); puts(buf, txt, cols, rows, R, B, '+', 0.5);
        // screen
        var sx0 = 2, sx1 = R - 2, sy0 = 1, sy1 = Math.max(4, Math.round(rows * 0.5));
        for (i = sx0; i <= sx1; i++) { puts(buf, txt, cols, rows, i, sy0, '=', 0.6); puts(buf, txt, cols, rows, i, sy1, '=', 0.6); }
        for (j = sy0; j <= sy1; j++) { puts(buf, txt, cols, rows, sx0, j, '[', 0.6); puts(buf, txt, cols, rows, sx1, j, ']', 0.6); }
        var innerTop = sy0 + 2, innerBot = sy1 - 1, ih = Math.max(1, innerBot - innerTop + 1);
        puts(buf, txt, cols, rows, sx0 + 2, sy0 + 1, 'solace', 0.9);
        var tm = Math.floor(t) % 600;
        var clock = ('0' + Math.floor(tm / 60)).slice(-2) + ':' + ('0' + (tm % 60)).slice(-2);
        puts(buf, txt, cols, rows, sx1 - 1 - clock.length, sy0 + 1, clock, 0.7);
        for (i = sx0 + 2; i <= sx1 - 2; i += 2) {
          var lv = (Math.sin(i * 0.5 + t * 3.1) + Math.sin(i * 0.23 - t * 1.7) + Math.sin(i * 0.11 + t * 0.9) + 3) / 6;
          var h = Math.max(1, Math.round(lv * (ih - 1)));
          for (j = innerBot; j > innerBot - h; j--) puts(buf, txt, cols, rows, i, j, j === innerBot - h + 1 ? '=' : '|', j === innerBot - h + 1 ? 0.95 : 0.55);
        }
        // controls row
        var cy = Math.round((sy1 + B) / 2);
        var dx = Math.max(3, Math.round(cols * 0.18));
        puts(buf, txt, cols, rows, dx, cy - 1, '^', 0.75);
        puts(buf, txt, cols, rows, dx - 2, cy, '<', 0.75);
        puts(buf, txt, cols, rows, dx, cy, 'o', 0.5);
        puts(buf, txt, cols, rows, dx + 2, cy, '>', 0.75);
        puts(buf, txt, cols, rows, dx, cy + 1, 'v', 0.75);
        var ax = R - Math.max(3, Math.round(cols * 0.16));
        puts(buf, txt, cols, rows, ax, cy - 1, '(A)', 0.8);
        puts(buf, txt, cols, rows, ax - 4, cy + 1, '(B)', 0.8);
        // encoder knob
        var kx = cols / 2, kr = Math.max(1.6, Math.min((B - sy1) / 2 - 0.6, cols * 0.09));
        var ang = t * 1.4;
        for (j = Math.floor(cy - kr - 1); j <= Math.ceil(cy + kr + 1); j++) {
          for (i = Math.floor(kx - kr * 2 - 1); i <= Math.ceil(kx + kr * 2 + 1); i++) {
            var ddx = (i + 0.5 - kx) / 2, ddy = j + 0.5 - cy - 0.5;
            var r = Math.sqrt(ddx * ddx + ddy * ddy);
            if (Math.abs(r - kr) < 0.5) puts(buf, txt, cols, rows, i, j, '.', 0.6);
          }
        }
        var px = Math.round(kx + Math.cos(ang) * (kr - 0.6) * 2 - 0.5), py = Math.round(cy + Math.sin(ang) * (kr - 0.6));
        puts(buf, txt, cols, rows, px, py, '@', 1);
      }
    };
  };

  MODES.halftone = function () {
    // Draws a tonal image top-left to bottom-right: scanlines for darks, halftone dots for mids.
    var shape = 0, prog = -1, hold = 0, lastT = 0;
    function tone(x, y, s) {
      var dx = x - 0.5, dy = y - 0.5, r = Math.sqrt(dx * dx + dy * dy);
      if (s === 0) { // lit sphere
        if (r > 0.36) return 0;
        var z = Math.sqrt(Math.max(0, 0.13 - r * r));
        return Math.max(0, Math.min(1, 1 - (z * 1.2 + (-dx - dy) * 0.9 + 0.1)));
      }
      if (s === 1) { // cup with lid
        if (y > 0.28 && y < 0.82 && Math.abs(dx) < 0.18 + (0.82 - y) * 0.12) return 0.35 + y * 0.5;
        if (y > 0.22 && y <= 0.28 && Math.abs(dx) < 0.3) return 0.9;
        if (Math.abs(dx - 0.06) < 0.02 && y > 0.06 && y <= 0.22) return 0.85;
        return 0;
      }
      // star
      var a = Math.atan2(dy, dx), k = 0.22 + 0.12 * Math.cos(5 * a);
      return r < k ? 0.3 + (1 - r / k) * 0.65 : 0;
    }
    return {
      frame: function (buf, txt, t, cols, rows) {
        var dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        var total = cols * rows;
        if (prog < 0) prog = total * 0.62;
        if (hold > 0) { hold -= dt; if (hold <= 0) { prog = 0; shape = (shape + 1) % 3; } }
        else { prog = Math.min(total, prog + dt * total / 6); if (prog >= total) hold = 2.2; }
        clear(buf, txt);
        var head = Math.floor(prog);
        for (var k = 0; k < Math.min(head, total); k++) {
          var i = k % cols, j = (k / cols) | 0;
          var v = tone((i + 0.5) / cols, (j + 0.5) / rows, shape);
          if (v <= 0.08) continue;
          if (v > 0.66) { if (i % 2 === 0) { txt[k] = '|'; buf[k] = 0.9; } }
          else if (v > 0.38) { txt[k] = (i + j) % 2 === 0 ? 'o' : '.'; buf[k] = 0.62; }
          else { if ((i + j * 2) % 4 === 0) { txt[k] = '.'; buf[k] = 0.45; } }
        }
        if (hold <= 0 && head < total) {
          var hi = head % cols, hj = (head / cols) | 0;
          puts(buf, txt, cols, rows, hi, hj, '#', 1);
        }
      }
    };
  };

  MODES.chat = function () {
    var SCRIPT = [
      [0, 'u up?'], [1, 'ya'], [1, 'cant sleep lol'], [0, 'same'], [0, 'what u doing'],
      [1, 'watching the rain'], [1, 'and u?'], [0, 'debugging'], [1, 'at 2am??'], [1, 'go to bed'],
      [0, 'one more fix'], [1, 'thats what u said an hour ago']
    ];
    var shown = SCRIPT.slice(0, 3), idx = 3, acc = 0, typing = 0, lastT = 0;
    return {
      frame: function (buf, txt, t, cols, rows) {
        var dt = Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        acc += dt;
        var nextMsg = SCRIPT[idx % SCRIPT.length];
        if (nextMsg[0] === 1 && typing <= 0 && acc > 0.5) typing = 1.1;
        if (typing > 0) { typing -= dt; if (typing <= 0) { shown.push(nextMsg); idx++; acc = 0; } }
        else if (acc > (nextMsg[0] === 0 ? 1.4 : 0.9)) { shown.push(nextMsg); idx++; acc = 0; }
        var maxLines = Math.max(2, Math.floor((rows - 1) / 2));
        while (shown.length > maxLines - (typing > 0 ? 1 : 0)) shown.shift();
        clear(buf, txt);
        var count = shown.length + (typing > 0 ? 1 : 0);
        var y = Math.max(1, rows - 1 - (count - 1) * 2 - 1);
        function bubble(who, text, v) {
          var s = '( ' + text.slice(0, Math.max(4, cols - 8)) + ' )';
          var x = who === 0 ? 1 : cols - 1 - s.length;
          puts(buf, txt, cols, rows, x, y, s, v);
          y += 2;
        }
        for (var m = 0; m < shown.length; m++) bubble(shown[m][0], shown[m][1], shown[m][0] === 1 ? 0.95 : 0.6);
        if (typing > 0) {
          var n = 1 + Math.floor(t * 3) % 3;
          bubble(1, '. . .'.slice(0, n * 2 - 1), 0.5);
        }
      }
    };
  };

  MODES.ledger = function () {
    // Left: today's allowance and the log. Right: this month, a donut of spending by
    // category with the money left in the middle, and a legend.
    var CATS = [['food', '#', 0.95], ['transport', '%', 0.72], ['study', '*', 0.85], ['fun', '+', 0.6], ['other', '=', 0.5]];
    var ITEMS = [['coffee', 4.5, 0], ['bus', 1.2, 1], ['lunch', 8, 0], ['books', 12.9, 2], ['snacks', 3.1, 0],
      ['movie', 7, 3], ['grab', 6.8, 1], ['groceries', 9.4, 0], ['stationery', 4.2, 2], ['laundry', 5, 4]];
    var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    var ALLOW = 20, BUDGET = 600;
    var lines = [], n = 0, acc = 0, lastT = -1, spentToday = 0, day = 2;
    var month = [128, 46, 41, 33, 17], shown = month.slice();
    function log() {
      var it = ITEMS[n % ITEMS.length];
      if (spentToday + it[1] > ALLOW) { spentToday = 0; day++; }
      spentToday += it[1];
      month[it[2]] += it[1];
      if (total(month) > BUDGET * 0.92) month = [24, 9, 6, 5, 2];
      lines.push({ name: DAYS[day % 7] + ' ' + it[0], amt: '-' + it[1].toFixed(2) });
      n++;
    }
    function total(a) { return a[0] + a[1] + a[2] + a[3] + a[4]; }
    for (var q = 0; q < 5; q++) log();
    shown = month.slice();

    return {
      frame: function (buf, txt, t, cols, rows, asp) {
        var dt = lastT < 0 ? 0 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
        acc += dt;
        if (acc > 1.3) { acc = 0; log(); }
        for (var c = 0; c < 5; c++) shown[c] += (month[c] - shown[c]) * Math.min(1, dt * 4);
        clear(buf, txt);
        var wide = cols >= 44;
        var split = wide ? Math.max(20, Math.round(cols * 0.46)) : cols - 1;

        // ---- left: today
        var maxLines = Math.max(2, rows - 5);
        while (lines.length > maxLines) lines.shift();
        puts(buf, txt, cols, rows, 1, 0, 'today', 0.85);
        var left = Math.max(0, ALLOW - spentToday).toFixed(2);
        puts(buf, txt, cols, rows, split - 1 - (left.length + 5), 0, 'left ' + left, 0.95);
        var barW = Math.max(6, split - 4), fill = Math.round(barW * Math.min(1, spentToday / ALLOW));
        puts(buf, txt, cols, rows, 1, 1, '[' + new Array(fill + 1).join('#') + new Array(barW - fill + 1).join('-') + ']', 0.6);
        for (var l = 0; l < lines.length; l++) {
          var ln = lines[l], y = 3 + l, last = l === lines.length - 1;
          puts(buf, txt, cols, rows, 1, y, ln.name.slice(0, Math.max(4, split - 10)), last ? 0.95 : 0.5);
          puts(buf, txt, cols, rows, split - 1 - ln.amt.length, y, ln.amt, last ? 0.95 : 0.5);
        }
        if (!wide) return;
        for (var jj = 0; jj < rows; jj++) puts(buf, txt, cols, rows, split + 1, jj, ':', 0.22);

        // ---- right: this month
        var x0 = split + 3, w = cols - x0 - 1;
        var spent = total(shown), leftM = Math.max(0, BUDGET - spent);
        puts(buf, txt, cols, rows, x0, 0, 'this month', 0.85);
        var bud = '/ ' + BUDGET;
        puts(buf, txt, cols, rows, x0 + w - bud.length, 0, bud, 0.5);
        var legendRows = rows >= 22 ? 6 : 0;
        var cwch = asp * rows / cols;
        var availR = rows - 2 - legendRows;
        var rOut = Math.max(3, Math.min(availR / 2 - 0.3, (w * cwch) / 2 - 0.5));
        var rIn = rOut * 0.6;
        var dcx = x0 + w / 2, dcy = 1.5 + availR / 2;
        var bounds = [], acc2 = 0;
        for (var b = 0; b < 5; b++) { acc2 += shown[b] / BUDGET; bounds.push(acc2); }
        for (var j = 1; j < 1 + availR + 1; j++) {
          for (var i = x0; i < x0 + w; i++) {
            var dx = (i + 0.5 - dcx) * cwch, dy = j + 0.5 - dcy;
            var r = Math.sqrt(dx * dx + dy * dy);
            if (r < rIn || r > rOut) continue;
            var a = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
            var cat = -1;
            for (var cc = 0; cc < 5; cc++) if (a < bounds[cc]) { cat = cc; break; }
            if (cat < 0) puts(buf, txt, cols, rows, i, j, '.', 0.24);
            else puts(buf, txt, cols, rows, i, j, CATS[cat][1], CATS[cat][2]);
          }
        }
        var amt = 'RM ' + leftM.toFixed(0);
        puts(buf, txt, cols, rows, Math.round(dcx - amt.length / 2), Math.round(dcy) - 1, amt, 1);
        puts(buf, txt, cols, rows, Math.round(dcx - 2), Math.round(dcy), 'left', 0.6);
        if (legendRows) {
          var ly = rows - legendRows + 1;
          for (var k = 0; k < 5; k++) {
            var name = CATS[k][1] + ' ' + CATS[k][0];
            var val = shown[k].toFixed(0);
            puts(buf, txt, cols, rows, x0, ly + k, name, CATS[k][2]);
            puts(buf, txt, cols, rows, x0 + w - val.length, ly + k, val, 0.7);
          }
        }
      }
    };
  };

  MODES.models = function () {
    // Three printed parts, ray-marched and spun on a turntable: console shell, phone case, bottle sleeve.
    var NAMES = ['handheld console', 'phone case', 'bottle sleeve'];
    var DUR = 7, lastDraw = -1, abs = Math.abs, sqrt = Math.sqrt, max = Math.max, min = Math.min;
    var MAT = 0;

    function rbox(x, y, z, bx, by, bz, r) {
      var qx = abs(x) - bx + r, qy = abs(y) - by + r, qz = abs(z) - bz + r;
      var ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
      return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, max(qy, qz)), 0) - r;
    }
    function cylY(x, y, z, r, h) {
      var dx = sqrt(x * x + z * z) - r, dy = abs(y) - h;
      var ox = max(dx, 0), oy = max(dy, 0);
      return min(max(dx, dy), 0) + sqrt(ox * ox + oy * oy);
    }
    function cylZ(x, y, z, r, h) { return cylY(x, z, y, r, h); }

    function consoleSdf(x, y, z) {
      var body = rbox(x, y, z, 0.78, 0.1, 0.6, 0.07);
      MAT = 0;
      var screen = rbox(x - 0.2, y - 0.1, z + 0.12, 0.44, 0.025, 0.3, 0.02);
      var d = max(body, -screen);
      if (-screen > body - 0.002 && screen < 0.01) MAT = 1;
      var slot = rbox(x - 0.25, y - 0.1, z + 0.5, 0.38, 0.03, 0.025, 0.02);
      d = max(d, -slot);
      var knob = cylY(x + 0.42, y - 0.12, z - 0.14, 0.23, 0.025);
      if (knob < d) { d = knob; MAT = 2; }
      for (var k = 0; k < 4; k++) {
        var bx = 0.02 + (k % 2 ? 0.1 : -0.1), bz = 0.38 + (k < 2 ? -0.08 : 0.08);
        var b = rbox(x - bx, y - 0.115, z - bz, 0.04, 0.02, 0.035, 0.012);
        if (b < d) { d = b; MAT = 2; }
      }
      return d;
    }
    function caseSdf(x, y, z) {
      // upright case: long axis y, open face toward +z
      var outer = rbox(x, y, z, 0.42, 0.86, 0.075, 0.07);
      var inner = rbox(x, y, z - 0.03, 0.37, 0.81, 0.07, 0.05);
      var d = max(outer, -inner);
      var cam = rbox(x + 0.18, y - 0.6, z + 0.05, 0.13, 0.16, 0.2, 0.06);
      d = max(d, -cam);
      var port = rbox(x, y + 0.86, z, 0.12, 0.06, 0.03, 0.02);
      MAT = 0;
      return max(d, -port);
    }
    var VN = 8, VP = [];
    (function () { var R = rand(77); for (var i = 0; i < VN * 6; i++) VP.push([R(), R()]); })();
    function sleeveSdf(x, y, z) {
      var rr = sqrt(x * x + z * z);
      var shell = max(abs(rr - 0.44) - 0.035, abs(y) - 0.78);
      if (shell > 0.05) { MAT = 0; return shell; }
      var th = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
      var u = th * VN, v = (y + 0.78) / 1.56 * 5.5;
      var cu = Math.floor(u), cv = Math.floor(v), f1 = 9, f2 = 9;
      for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
          var gu = cu + i, gv = cv + j;
          var wu = ((gu % VN) + VN) % VN, wv = min(5, max(0, gv));
          var pt = VP[wu + wv * VN];
          var dx = gu + 0.15 + pt[0] * 0.7 - u, dy = gv + 0.15 + pt[1] * 0.7 - v;
          var dd = dx * dx + dy * dy;
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
        }
      }
      var edge = (sqrt(f2) - sqrt(f1)) * 0.5;
      var kept = min((edge - 0.11) * 0.28, 0.69 - abs(y));
      MAT = 0;
      return max(shell, kept);
    }
    var SDF = [consoleSdf, caseSdf, sleeveSdf];
    var TILT = [0.62, 0.32, 0.42];

    return {
      frame: function (buf, txt, t, cols, rows, asp) {
        if (lastDraw >= 0 && t - lastDraw < 0.05 && t >= lastDraw) return;
        lastDraw = t;
        clear(buf, txt);
        var which = Math.floor(t / DUR) % 3, local = t % DUR;
        var sdf = SDF[which];
        var fade = min(1, local / 0.5, (DUR - local) / 0.4);
        var cwch = asp * rows / cols;
        var k = max(1.95 / (rows - 2), 1.95 / (cols * cwch));
        var a = t * 0.75, ca = Math.cos(a), sa = Math.sin(a);
        var tl = TILT[which], ct = Math.cos(tl), stt = Math.sin(tl);
        var lx = -0.45, ly = 0.75, lz = -0.5, ll = sqrt(lx * lx + ly * ly + lz * lz); lx /= ll; ly /= ll; lz /= ll;
        function map(px, py, pz) {
          // camera space -> object space: undo tilt (about x) then spin (about y)
          var y1 = py * ct - pz * stt, z1 = py * stt + pz * ct;
          var x2 = px * ca + z1 * sa, z2 = -px * sa + z1 * ca;
          return sdf(x2, y1, z2);
        }
        var RB = 1.18;
        for (var j = 1; j < rows; j++) {
          var sy = ((rows + 1) / 2 - j - 0.5) * k;
          for (var i = 0; i < cols; i++) {
            var sx = (i + 0.5 - cols / 2) * k * cwch;
            var r2 = sx * sx + sy * sy;
            if (r2 > RB * RB) continue;
            var zz = -sqrt(RB * RB - r2), zEnd = -zz, hit = false;
            for (var s = 0; s < 44 && zz < zEnd; s++) {
              var dist = map(sx, sy, zz);
              if (dist < 0.004) { hit = true; break; }
              zz += max(dist * 0.9, 0.006);
            }
            if (!hit) continue;
            var mat = MAT, e = 0.006;
            var nx = map(sx + e, sy, zz) - map(sx - e, sy, zz);
            var ny = map(sx, sy + e, zz) - map(sx, sy - e, zz);
            var nz = map(sx, sy, zz + e) - map(sx, sy, zz - e);
            var nl = sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= nl; ny /= nl; nz /= nl;
            var diff = max(0, nx * lx + ny * ly + nz * lz);
            var rim = Math.pow(1 - abs(nz), 3) * 0.35;
            var I = 0.16 + diff * 0.72 + rim;
            if (mat === 1) I *= 0.42;
            if (mat === 2) I = min(1, I * 1.15 + 0.08);
            buf[i + j * cols] = min(1, I) * fade;
          }
        }
        puts(buf, txt, cols, rows, 1, 0, '0' + (which + 1) + '/03 ' + NAMES[which], 0.85);
      }
    };
  };

  /* ----- renderer ----- */

  function AsciiMedia(canvas, mode, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var impl = (MODES[mode] || MODES.models)();
    var family = opts.fontFamily || 'monospace';
    var cols = 0, rows = 0, cw = 0, ch = 0, fs = 11, dpr = 1, asp = 1;
    var buf = null, txt = null;
    var t = Math.random() * 20, last = 0, raf = 0;
    var visible = false, enabled = true, hover = 0, hoverTarget = 0, acc = 0;
    var theme = opts.theme || { bg: [0, 0, 0], ink: [1, 1, 1] };

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      fs = r.width < 360 ? 9 : r.width < 560 ? 10 : 11;
      ctx.font = fs + 'px ' + family;
      cw = ctx.measureText('M').width;
      ch = fs * 1.3;
      cols = Math.max(8, Math.floor(r.width / cw));
      rows = Math.max(6, Math.floor(r.height / ch));
      asp = (cols * cw) / (rows * ch);
      buf = new Float32Array(cols * rows);
      txt = new Array(cols * rows).fill('');
      render();
    }

    function render() {
      if (!buf) return;
      impl.frame(buf, txt, t, cols, rows, asp);
      var W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = fs + 'px ' + family;
      ctx.textBaseline = 'top';
      var ox = (W / dpr - cols * cw) / 2, oy = (H / dpr - rows * ch) / 2;
      var boost = 0.88 + 0.12 * hover;
      for (var l = 1; l <= LEVELS; l++) {
        var lum = Math.min(1, (0.22 + 0.7 * (l / LEVELS)) * boost);
        ctx.fillStyle = 'rgb(' + [0, 1, 2].map(function (c) {
          return Math.round((theme.bg[c] + (theme.ink[c] - theme.bg[c]) * lum) * 255);
        }).join(',') + ')';
        for (var j = 0; j < rows; j++) {
          for (var i = 0; i < cols; i++) {
            var k = i + j * cols;
            var v = buf[k];
            if (v < 0.06) continue;
            var lv = Math.min(LEVELS, Math.max(1, Math.ceil(v * LEVELS)));
            if (lv !== l) continue;
            var c = txt[k] || RAMP[Math.min(RAMP.length - 1, Math.max(1, Math.round(v * (RAMP.length - 1))))];
            ctx.fillText(c, ox + i * cw, oy + j * ch);
          }
        }
      }
    }

    function loop(now) {
      raf = 0;
      if (!visible || !enabled) return;
      raf = requestAnimationFrame(loop);
      var dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
      last = now;
      hover += (hoverTarget - hover) * 0.12;
      t += dt * (1 + hover * 0.8);
      acc += dt;
      if (acc < 1 / 30) return;
      acc = 0;
      render();
    }

    function kick() {
      if (!raf && visible && enabled) { last = 0; raf = requestAnimationFrame(loop); }
    }

    this.setVisible = function (v) { visible = v; kick(); };
    this.setEnabled = function (v) { enabled = v; if (!v) { hover = hoverTarget; render(); } kick(); };
    this.setHover = function (v) { hoverTarget = v ? 1 : 0; if (!enabled) { hover = hoverTarget; render(); } };
    this.resize = resize;
    this.setTheme = function (next) { theme = next; render(); };

    resize();
  }

  window.AsciiMedia = AsciiMedia;
})();
