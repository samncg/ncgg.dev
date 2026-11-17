/*
 * WireObject: animated perspective wireframes for the Work cards.
 * Every model faces the viewer (its main face points at the camera), sways gently,
 * leans toward the cursor, and lights up purple where the cursor is close.
 * Models are functions of time, rebuilt each frame so their parts can move.
 * Control surface: setVisible / setEnabled / setHover / setTheme / resize.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* ---------- geometry builder ---------- */

  function Geo() { this.v = []; this.e = []; }
  Geo.prototype.add = function (verts, edges) {
    var o = this.v.length;
    for (var i = 0; i < verts.length; i++) this.v.push(verts[i]);
    for (var j = 0; j < edges.length; j++) this.e.push([edges[j][0] + o, edges[j][1] + o]);
    return this;
  };
  Geo.prototype.merge = function (g, xf) { return this.add(xf ? g.v.map(xf) : g.v, g.e); };

  function loop(g, pts) {
    var e = [];
    for (var i = 0; i < pts.length; i++) e.push([i, (i + 1) % pts.length]);
    return g.add(pts, e);
  }
  function poly(g, pts) {
    var e = [];
    for (var i = 0; i < pts.length - 1; i++) e.push([i, i + 1]);
    return g.add(pts, e);
  }
  function seg(g, a, b) { return g.add([a, b], [[0, 1]]); }
  function box(g, cx, cy, cz, w, h, d) {
    var x = w / 2, y = h / 2, z = d / 2, v = [];
    for (var i = 0; i < 8; i++) v.push([cx + (i & 1 ? x : -x), cy + (i & 2 ? y : -y), cz + (i & 4 ? z : -z)]);
    return g.add(v, [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]);
  }
  function ringPts(cx, cy, cz, r, n, axis, phase) {
    var p = [];
    for (var i = 0; i < n; i++) {
      var a = (phase || 0) + i / n * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r;
      p.push(axis === 'x' ? [cx, cy + c, cz + s] : axis === 'z' ? [cx + c, cy + s, cz] : [cx + c, cy, cz + s]);
    }
    return p;
  }
  // cylinder / frustum along an axis
  function cyl(g, cx, cy, cz, r1, r2, h, n, axis, every, phase) {
    axis = axis || 'y'; every = every || 2;
    var off = function (t) { return axis === 'x' ? [t, 0, 0] : axis === 'z' ? [0, 0, t] : [0, t, 0]; };
    var a = off(-h / 2), b = off(h / 2);
    var p1 = ringPts(cx + a[0], cy + a[1], cz + a[2], r1, n, axis, phase);
    var p2 = ringPts(cx + b[0], cy + b[1], cz + b[2], r2, n, axis, phase);
    var e = [];
    for (var i = 0; i < n; i++) {
      e.push([i, (i + 1) % n]);
      e.push([n + i, n + (i + 1) % n]);
      if (i % every === 0) e.push([i, n + i]);
    }
    return g.add(p1.concat(p2), e);
  }
  function circle(g, cx, cy, z, r, n) { return loop(g, ringPts(cx, cy, z, r, n || 16, 'z', 0)); }
  function sphere(g, cx, cy, cz, r, lat, lon, spin) {
    for (var i = 1; i < lat; i++) {
      var phi = -Math.PI / 2 + i / lat * Math.PI;
      loop(g, ringPts(cx, cy + Math.sin(phi) * r, cz, Math.cos(phi) * r, lon, 'y', 0));
    }
    for (var j = 0; j < lon / 2; j++) {
      var th = (spin || 0) + j / (lon / 2) * Math.PI, pts = [];
      for (var k = 0; k < 14; k++) {
        var a = k / 14 * TAU;
        pts.push([cx + Math.cos(a) * r * Math.cos(th), cy + Math.sin(a) * r, cz + Math.cos(a) * r * Math.sin(th)]);
      }
      loop(g, pts);
    }
    return g;
  }
  // rounded rectangle outline in 2D
  function rrect(w, h, r, segs) {
    var pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 1], [-w / 2 + r, -h / 2 + r, 2], [w / 2 - r, -h / 2 + r, 3]];
    cs.forEach(function (c) {
      for (var i = 0; i <= segs; i++) {
        var a = (c[2] + i / segs) * Math.PI / 2;
        pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
      }
    });
    return pts;
  }
  // place a 2D outline in the XY plane (facing the viewer) at depth z
  function at(pts, x, y, z) { return pts.map(function (p) { return [p[0] + x, p[1] + y, z]; }); }
  // a slab: an outline extruded between z0 (front) and z1 (back)
  function slab(g, pts2, x, y, z0, z1, every) {
    var n = pts2.length, v = at(pts2, x, y, z0).concat(at(pts2, x, y, z1)), e = [];
    for (var i = 0; i < n; i++) {
      e.push([i, (i + 1) % n]); e.push([n + i, n + (i + 1) % n]);
      if (i % (every || 3) === 0) e.push([i, n + i]);
    }
    return g.add(v, e);
  }
  // closed Catmull-Rom spline through control points
  function spline(ctrl, per) {
    var out = [], n = ctrl.length;
    for (var i = 0; i < n; i++) {
      var p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (var k = 0; k < per; k++) {
        var t = k / per, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(function (c) {
          return 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
        }));
      }
    }
    return out;
  }
  // offset an open 2D path sideways by d (for bands)
  function offset(path, d) {
    return path.map(function (p, i) {
      var a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      return [p[0] - ty / l * d, p[1] + tx / l * d];
    });
  }
  function rotX(a) { var c = Math.cos(a), s = Math.sin(a); return function (p) { return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }; }
  function rotY(a) { var c = Math.cos(a), s = Math.sin(a); return function (p) { return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }; }
  function rotZ(a) { var c = Math.cos(a), s = Math.sin(a); return function (p) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }; }
  function move(x, y, z) { return function (p) { return [p[0] + x, p[1] + y, p[2] + z]; }; }
  function chain() { var fs = arguments; return function (p) { for (var i = 0; i < fs.length; i++) p = fs[i](p); return p; }; }
  function wave(t, period) { return 0.5 - 0.5 * Math.cos(t / period * TAU); }

  /* ---------- tweening: every model animates on a fixed period, so loops are seamless ---------- */

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeInOut(x) { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function easeOut(x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3); }
  function easeIn(x) { x = clamp01(x); return x * x * x; }
  function easeOutBack(x) { x = clamp01(x); var c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); }
  function bounceOut(x) {
    x = clamp01(x);
    var n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  }
  // 0..1 over [a, b] of the cycle, eased
  function span(p, a, b, ease) { return (ease || easeInOut)((p - a) / (b - a)); }
  function cycle(t, period) { return (t % period) / period; }

  /* ---------- models (front face toward the viewer = -z) ---------- */

  var MODELS = {};

  // Solace handheld, measured from the CAD front view (portrait, 1.25 x 1.57)
  var GLYPHS = [
    ['#####', '#.###', '##.##', '#####', '#####'],
    ['.####', '##..#', '#..##', '#.###', '####.'],
    ['.###.', '##.##', '#...#', '##.##', '.###.']
  ];
  MODELS.console = function (t) {
    var g = new Geo();
    var W = 1.25, H = 1.57, D = 0.19, zf = -D / 2, p = cycle(t, 6);
    slab(g, rrect(W, H, 0.075, 4), 0, 0, zf, -zf, 2);
    // top row: pill slot, speaker grille (with its perforation rows), screw, round button
    loop(g, at(rrect(0.186, 0.067, 0.033, 3), -0.471, 0.691, zf));
    loop(g, at(rrect(0.624, 0.062, 0.031, 3), -0.003, 0.691, zf));
    for (var gr = 0; gr < 2; gr++) poly(g, [[-0.28, 0.682 + gr * 0.018, zf + 0.004], [0.27, 0.682 + gr * 0.018, zf + 0.004]]);
    circle(g, 0.412, 0.691, zf - 0.004, 0.039, 14);
    seg(g, [0.385, 0.664, zf - 0.006], [0.439, 0.718, zf - 0.006]);
    var pb = 1 - 0.5 * Math.sin(Math.PI * clamp01((p - 0.86) / 0.1));
    cyl(g, 0.522, 0.691, zf - 0.02 * pb, 0.039, 0.039, 0.04 * pb, 14, 'z', 7);
    // screen: bezel and recessed glass
    loop(g, at(rrect(0.922, 0.555, 0.027, 3), 0, 0.313, zf));
    loop(g, at(rrect(0.89, 0.523, 0.02, 3), 0, 0.313, zf + 0.02));
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(function (s) {
      seg(g, [s[0] * 0.448, 0.313 + s[1] * 0.265, zf], [s[0] * 0.432, 0.313 + s[1] * 0.249, zf + 0.02]);
    });
    // pixel glyphs pop in one by one, hold, then clear
    var px = 0.0433, top = 0.44, lefts = [-0.354, -0.116, 0.125], cells = [];
    GLYPHS.forEach(function (gl, gi) {
      gl.forEach(function (row, ry) {
        for (var rx = 0; rx < 5; rx++) if (row[rx] === '#') cells.push([lefts[gi] + (rx + 0.5) * px, top - (ry + 0.5) * px]);
      });
    });
    cells.forEach(function (c, i) {
      var tin = 0.04 + i / cells.length * 0.46;
      var s = p < 0.74 ? easeOutBack((p - tin) / 0.07) : 1 - easeIn((p - 0.74) / 0.16);
      if (s <= 0.01) return;
      var h = px * 0.46 * s;
      loop(g, [[c[0] - h, c[1] - h, zf + 0.018], [c[0] + h, c[1] - h, zf + 0.018], [c[0] + h, c[1] + h, zf + 0.018], [c[0] - h, c[1] + h, zf + 0.018]]);
    });
    // knob: raised disc in its ring, indicator hole; turns one way and eases back
    var kx = -0.3, ky = -0.355, kr = 0.257;
    var ka = 0.816 + (p < 0.5 ? easeInOut(p / 0.5) : 1 - easeInOut((p - 0.5) / 0.5)) * 2.4;
    circle(g, kx, ky, zf, kr + 0.012, 34);
    cyl(g, kx, ky, zf - 0.03, kr, kr - 0.012, 0.06, 34, 'z', 5, ka);
    circle(g, kx, ky, zf - 0.061, kr - 0.022, 34);
    circle(g, kx + Math.cos(ka) * 0.159, ky + Math.sin(ka) * 0.159, zf - 0.062, 0.039, 12);
    // d-pad: four arms around a centre, pressing in turn (up, right, down, left)
    var dx = 0.293, dy = -0.349;
    var arms = [[0, 0.154, 0.137, 0.195], [0.157, 0, 0.195, 0.137], [0, -0.162, 0.137, 0.195], [-0.156, 0, 0.195, 0.137]];
    arms.forEach(function (a, i) {
      var c0 = 0.1 + i * 0.18, press = Math.sin(Math.PI * clamp01((p - c0) / 0.13));
      var depth = 0.04 - 0.028 * press;
      slab(g, rrect(a[2], a[3], 0.03, 3), dx + a[0], dy + a[1], zf - depth, zf, 3);
      loop(g, at(rrect(a[2] - 0.03, a[3] - 0.03, 0.022, 3), dx + a[0], dy + a[1], zf - depth - 0.001));
      loop(g, at(rrect(a[2] + 0.014, a[3] + 0.014, 0.034, 3), dx + a[0], dy + a[1], zf));
    });
    // bottom corner screws
    [[-0.536, -0.691], [0.531, -0.691]].forEach(function (s, i) {
      circle(g, s[0], s[1], zf - 0.004, 0.039, 14);
      seg(g, [s[0] - 0.027, s[1] - 0.027, zf - 0.006], [s[0] + 0.027, s[1] + 0.027, zf - 0.006]);
    });
    // ports: mic holes, USB-C and jack on the bottom edge; SD slot on the right edge
    var ye = -H / 2 - 0.001;
    for (var m = 0; m < 3; m++) loop(g, ringPts(-0.16 + m * 0.045, ye, 0, 0.012, 8, 'y', 0));
    loop(g, rrect(0.15, 0.055, 0.027, 2).map(function (q) { return [q[0] + 0.14, ye, q[1]]; }));
    loop(g, ringPts(0.33, ye, 0, 0.03, 12, 'y', 0));
    loop(g, rrect(0.26, 0.04, 0.02, 2).map(function (q) { return [W / 2 + 0.001, q[0] - 0.42, q[1]]; }));
    return g;
  };
  MODELS.solace = MODELS.console;


  // Two-piece bumper case on the phone, traced from the CAD back view (px coordinates of a 744x1132 render).
  // Back of the phone faces the viewer (-z). The pieces explode off, snap on, hold, and pull off again.
  var CASE_S = 0.86 / 470, CASE_CX = 385, CASE_CY = 550;
  function cpx(q) { return [(q[0] - CASE_CX) * CASE_S, (CASE_CY - q[1]) * CASE_S]; }
  var CASE_TOP = [[152, 125], [172, 76], [232, 56], [318, 62], [388, 74], [456, 62], [540, 52], [592, 72], [612, 132], [605, 200],
    [615, 252], [628, 300], [612, 342], [578, 408], [530, 432], [494, 394], [464, 366], [441, 378], [424, 520], [408, 374],
    [396, 358], [300, 358], [228, 358], [200, 378], [190, 406], [176, 352], [162, 300], [156, 246], [150, 182]].map(cpx);
  var CASE_HOLE = (function () { var c = cpx([387.5, 226]); return rrect(0.725, 0.462, 0.07, 4).map(function (q) { return [q[0] + c[0], q[1] + c[1]]; }); })();
  var CASE_BONE = [[170, 760], [205, 730], [255, 728], [298, 752], [318, 800], [345, 845], [400, 868], [470, 880], [535, 884],
    [585, 905], [622, 945], [632, 1000], [612, 1045], [560, 1058], [495, 1052], [470, 1010], [430, 983], [385, 978],
    [335, 988], [300, 1020], [285, 1055], [215, 1058], [162, 1040], [148, 990], [152, 930], [158, 870], [160, 810]].map(cpx);

  function band(g, pts, dx, dy, z0, z1, every) {
    var n = pts.length, v = [], e = [];
    pts.forEach(function (q) { v.push([q[0] + dx, q[1] + dy, z0]); });
    pts.forEach(function (q) { v.push([q[0] + dx, q[1] + dy, z1]); });
    for (var i = 0; i < n; i++) {
      e.push([i, (i + 1) % n]); e.push([n + i, n + (i + 1) % n]);
      if (i % (every || 4) === 0) e.push([i, n + i]);
    }
    return g.add(v, e);
  }

  MODELS.phonecase = function (t) {
    var g = new Geo(), p = cycle(t, 7);
    var W = 0.86, H = 1.83, zb = -0.045;
    // phone: body, camera island, lenses, flash, sensor, side buttons, bottom-edge openings
    slab(g, rrect(W, H, 0.12, 5), 0, 0, zb, -zb, 3);
    var isl = cpx([387, 225]);
    slab(g, rrect(0.7, 0.435, 0.055, 4), isl[0], isl[1], zb - 0.025, zb, 3);
    [[262, 170], [262, 285]].forEach(function (c) {
      var q = cpx(c);
      cyl(g, q[0], q[1], zb - 0.035, 0.09, 0.09, 0.02, 24, 'z', 6);
      circle(g, q[0], q[1], zb - 0.046, 0.06, 20);
    });
    var fl = cpx([258, 408]), sn = cpx([333, 407]);
    loop(g, at(rrect(0.17, 0.073, 0.036, 3), fl[0], fl[1], zb - 0.002));
    circle(g, sn[0], sn[1], zb - 0.002, 0.031, 12);
    [[290, 330], [365, 410], [460, 520]].forEach(function (b) {
      var y0 = cpx([0, b[0]])[1], y1 = cpx([0, b[1]])[1];
      loop(g, [[-W / 2 - 0.012, y0, -0.02], [-W / 2 - 0.012, y1, -0.02], [-W / 2 - 0.012, y1, 0.02], [-W / 2 - 0.012, y0, 0.02]]);
    });
    var ye = -H / 2 - 0.002;
    for (var h = 0; h < 6; h++) loop(g, ringPts(-0.3 + h * 0.035, ye, 0, 0.011, 8, 'y', 0));
    loop(g, rrect(0.13, 0.035, 0.017, 2).map(function (q) { return [q[0] - 0.02, ye, q[1]]; }));
    loop(g, ringPts(0.09, ye, 0, 0.008, 8, 'y', 0));
    loop(g, rrect(0.17, 0.03, 0.015, 2).map(function (q) { return [q[0] + 0.25, ye, q[1]]; }));
    // case pieces: exploded at the start/end of the loop, snapped on in the middle
    var on = p < 0.5 ? span(p, 0.08, 0.36) : 1 - span(p, 0.74, 0.94);
    var off = 1 - on;
    var lift = -0.32 * off;
    // top piece: wavy bumper around the camera island, hook on the left, drip below the centre
    band(g, spline(CASE_TOP, 3), 0, 0.42 * off, zb - 0.03 + lift, 0.05 + lift, 4);
    band(g, CASE_HOLE, 0, 0.42 * off, zb - 0.03 + lift, zb - 0.01 + lift, 5);
    // bottom piece: bone-shaped cap wrapping the bottom edge
    var bone = spline(CASE_BONE, 3);
    band(g, bone, 0, -0.42 * off, zb - 0.03 + lift, 0.05 + lift, 4);
    loop(g, at(offset(bone.concat([bone[0]]), -0.035).slice(0, bone.length), 0, -0.42 * off, zb - 0.032 + lift));
    return g;
  };

  // bottle sleeve: rims and a lattice that eases round by one cell per loop
  MODELS.sleeve = function (t) {
    var g = new Geo();
    var r = 0.46, h = 1.5, n = 11, rows = 6, p = cycle(t, 5);
    var ph = easeInOut(p) * TAU / n;
    cyl(g, 0, h / 2 - 0.05, 0, r, r, 0.1, 30, 'y', 99);
    cyl(g, 0, -h / 2 + 0.05, 0, r, r, 0.1, 30, 'y', 99);
    var P = function (a, y) { return [Math.cos(a) * r, y, Math.sin(a) * r]; };
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < rows; j++) {
        var a0 = ph + (i + (j % 2) * 0.5) / n * TAU, a1 = a0 + 0.5 / n * TAU, a2 = a0 - 0.5 / n * TAU;
        var y0 = -h / 2 + 0.1 + j / rows * (h - 0.2), y1 = y0 + (h - 0.2) / rows;
        g.add([P(a0, y0), P(a1, y1), P(a2, y1)], [[0, 1], [0, 2]]);
      }
    }
    return g;
  };

  // Yume: the stylus draws a stroke, lifts, the stroke wipes away, the pen glides back
  MODELS.yume = function (t) {
    var g = new Geo(), p = cycle(t, 6);
    var zf = -0.04;
    slab(g, rrect(1.7, 1.15, 0.08, 3), 0, 0, zf, 0.04, 2);
    loop(g, at(rrect(1.5, 0.95, 0.04, 2), 0, 0, zf - 0.002));
    var curve = function (u) { return [-0.6 + u * 1.15, Math.sin(u * 5.4) * 0.24 * (1 - u * 0.35) - 0.02 + u * 0.08]; };
    var draw = span(p, 0.05, 0.55), wipe = span(p, 0.62, 0.82), back = span(p, 0.8, 0.98);
    var N = 48, a = Math.floor(wipe * N), b = Math.floor(draw * N), stroke = [];
    for (var i = a; i <= b; i++) { var c = curve(i / N); stroke.push([c[0], c[1], zf - 0.004]); }
    if (stroke.length > 1) poly(g, stroke);
    var tipU = p < 0.8 ? draw : 1 - back, tip = curve(tipU);
    var lift = span(p, 0.55, 0.62) * 0.25 * (1 - span(p, 0.92, 1));
    var pen = new Geo();
    cyl(pen, 0.5, 0, 0, 0.045, 0.045, 0.8, 8, 'x', 2);
    cyl(pen, 0.05, 0, 0, 0.004, 0.045, 0.1, 8, 'x', 1);
    g.merge(pen, chain(rotZ(0.75), rotY(0.55), move(tip[0], tip[1], zf - 0.01 - lift)));
    return g;
  };

  // Ledger: a big coin flips once per loop; a coin drops, bounces on the stack, then fades away
  MODELS.ledger = function (t) {
    var g = new Geo(), p = cycle(t, 4);
    var coin = new Geo();
    cyl(coin, 0, 0, 0, 0.5, 0.5, 0.08, 30, 'z', 3);
    circle(coin, 0, 0, -0.042, 0.38, 26);
    for (var k = 0; k < 4; k++) seg(coin, [-0.14 + k * 0.09, -0.16, -0.043], [-0.14 + k * 0.09, 0.16, -0.043]);
    g.merge(coin, chain(rotY(easeInOut(p) * TAU), move(-0.32, 0.12, 0)));
    var base = -0.62, ch = 0.075, stack = 4, top = base + stack * ch;
    for (var i = 0; i < stack; i++) cyl(g, 0.52, base + i * ch, 0, 0.24, 0.24, ch * 0.9, 18, 'y', 3);
    var y = 0.8 - (0.8 - top) * bounceOut(span(p, 0.1, 0.55, function (x) { return x; }));
    var s = p < 0.75 ? 1 - (p < 0.1 ? 1 - easeOut(p / 0.1) : 0) : 1 - easeInOut((p - 0.75) / 0.2);
    if (s > 0.02) cyl(g, 0.52, y, 0, 0.24 * s, 0.24 * s, ch * 0.9 * s, 18, 'y', 3);
    return g;
  };

  // FTC robot 27308, from the CAD: side plates, bow-tie bumpers, mecanum wheels, deck, turret shooter,
  // flap intake, V scoop and a three-pocket spindexer. Front (intake) faces the viewer (-z).
  // a (z, y) profile extruded across x
  function side(g, prof, x0, x1, every) {
    var n = prof.length, v = [], e = [];
    prof.forEach(function (q) { v.push([x0, q[1], q[0]]); });
    prof.forEach(function (q) { v.push([x1, q[1], q[0]]); });
    for (var i = 0; i < n; i++) {
      e.push([i, (i + 1) % n]); e.push([n + i, n + (i + 1) % n]);
      if (i % (every || 2) === 0) e.push([i, n + i]);
    }
    return g.add(v, e);
  }
  // seven-segment digits in the (z, y) plane at a given x
  var SEG7 = { 2: 'abged', 7: 'abc', 3: 'abgcd', 0: 'abcdef', 8: 'abcdefg' };
  function digits(g, text, x, z0, y0, w, h, gap, mirror) {
    var MIR = { a: 'a', b: 'f', c: 'e', d: 'd', e: 'c', f: 'b', g: 'g' };
    text.split('').forEach(function (ch, i) {
      var z = z0 + i * (w + gap), on = SEG7[ch] || '';
      if (mirror) on = on.split('').map(function (q) { return MIR[q]; }).join('');
      var pts = { a: [[z, y0 + h], [z + w, y0 + h]], b: [[z + w, y0 + h], [z + w, y0 + h / 2]], c: [[z + w, y0 + h / 2], [z + w, y0]],
        d: [[z, y0], [z + w, y0]], e: [[z, y0], [z, y0 + h / 2]], f: [[z, y0 + h / 2], [z, y0 + h]], g: [[z, y0 + h / 2], [z + w, y0 + h / 2]] };
      on.split('').forEach(function (s) { seg(g, [x, pts[s][0][1], pts[s][0][0]], [x, pts[s][1][1], pts[s][1][0]]); });
    });
  }
  // o (optional, used by the drive mode): spin (wheel phase), flap (intake phase), index (spindexer angle),
  // turret (turret yaw), game (skip the scripted ball)
  MODELS.ftc = function (t, o) {
    o = o || {};
    var g = new Geo(), p = cycle(t, 5);
    var spin = o.spin !== undefined ? o.spin : p * TAU * 2;
    // side plates with the raised rear tab
    var plate = [[-0.5, -0.24], [0.5, -0.24], [0.5, 0.24], [0.34, 0.24], [0.32, 0.12], [-0.5, 0.12]];
    side(g, plate, -0.44, -0.42, 2);
    side(g, plate, 0.42, 0.44, 2);
    // back plate closing the chassis
    loop(g, [[-0.42, -0.24, 0.5], [0.42, -0.24, 0.5], [0.42, 0.12, 0.5], [-0.42, 0.12, 0.5]]);
    loop(g, [[-0.42, -0.24, 0.48], [0.42, -0.24, 0.48], [0.42, 0.12, 0.48], [-0.42, 0.12, 0.48]]);
    // bow-tie bumpers on both sides, with the 27308 plate on each
    var bump = [[-0.54, -0.02], [-0.16, -0.1], [0.16, -0.1], [0.54, -0.02], [0.54, -0.3], [0.16, -0.26], [-0.16, -0.26], [-0.54, -0.3]];
    [-1, 1].forEach(function (sx) {
      var x = sx * 0.49;
      side(g, bump, x - 0.01, x + 0.01, 4);
      loop(g, [[x + sx * 0.012, -0.12, -0.15], [x + sx * 0.012, -0.12, 0.15], [x + sx * 0.012, -0.245, 0.15], [x + sx * 0.012, -0.245, -0.15]]);
      if (sx < 0) digits(g, '27308', x - 0.014, -0.125, -0.225, 0.042, 0.085, 0.012);
      else digits(g, '80372', x + 0.014, -0.125, -0.225, 0.042, 0.085, 0.012, true);
    });
    // mecanum wheels at the corners, rollers drawn as diagonals
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s) {
      var wx = s[0] * 0.56, wz = s[1] * 0.36, wy = -0.29, r = 0.1;
      cyl(g, wx, wy, wz, r, r, 0.09, 16, 'x', 99, spin);
      for (var k = 0; k < 8; k++) {
        var a = spin + k * TAU / 8, a2 = a + 0.5 * s[0] * s[1];
        seg(g, [wx - 0.045, wy + Math.cos(a) * r, wz + Math.sin(a) * r], [wx + 0.045, wy + Math.cos(a2) * r, wz + Math.sin(a2) * r]);
      }
    });
    // deck plate
    slabY(g, -0.42, 0.42, -0.34, 0.46, 0.12, 0.135);
    // spindexer under the deck: three empty pockets that index one pocket (120 deg) per loop
    cyl(g, 0, -0.08, 0.1, 0.28, 0.28, 0.16, 32, 'y', 4);
    var idx = o.index !== undefined ? o.index : span(p, 0.32, 0.56) * TAU / 3, BASE = -Math.PI / 2;
    for (var pk = 0; pk < 3; pk++) {
      var a0 = BASE + idx + pk * TAU / 3, cx = Math.cos(a0) * 0.15, cz = 0.1 + Math.sin(a0) * 0.15;
      loop(g, ringPts(cx, -0.02, cz, 0.105, 16, 'y', 0));
      seg(g, [0, -0.02, 0.1], [Math.cos(a0 + TAU / 6) * 0.26, -0.02, 0.1 + Math.sin(a0 + TAU / 6) * 0.26]);
    }
    // front intake: shaft with five flaps spinning, and the V scoop below
    var fz = -0.55, fy = 0.02;
    seg(g, [-0.48, fy, fz], [0.48, fy, fz]);
    for (var f = 0; f < 5; f++) {
      var fx = -0.28 + f * 0.14;
      for (var arm = 0; arm < 2; arm++) {
        var fa = -(o.flap !== undefined ? o.flap : spin) * 1.5 + arm * Math.PI + f * 0.25; // bottoms sweep in toward the robot
        seg(g, [fx, fy, fz], [fx, fy + Math.cos(fa) * 0.17, fz + Math.sin(fa) * 0.17]);
      }
    }
    poly(g, [[-0.3, -0.12, -0.5], [-0.2, -0.27, -0.72], [0.2, -0.27, -0.72], [0.3, -0.12, -0.5]]);
    poly(g, [[-0.3, -0.27, -0.5], [-0.2, -0.27, -0.72]]); poly(g, [[0.3, -0.27, -0.5], [0.2, -0.27, -0.72]]);
    seg(g, [-0.2, -0.27, -0.72], [-0.2, -0.12, -0.72]); seg(g, [0.2, -0.27, -0.72], [0.2, -0.12, -0.72]);
    seg(g, [-0.2, -0.12, -0.72], [0.2, -0.12, -0.72]);
    // battery / motor tower at the front corner
    box(g, 0.36, 0.08, -0.43, 0.09, 0.3, 0.1);
    // turret: ring gear turntable and the shooter, swinging side to side
    var yaw = o.turret !== undefined ? o.turret : Math.sin(p * TAU) * 0.35;
    var tur = new Geo();
    cyl(tur, 0, 0.165, 0, 0.3, 0.3, 0.05, 36, 'y', 3);
    for (var tooth = 0; tooth < 36; tooth++) {
      var ta = tooth / 36 * TAU;
      seg(tur, [Math.cos(ta) * 0.3, 0.19, Math.sin(ta) * 0.3], [Math.cos(ta) * 0.32, 0.19, Math.sin(ta) * 0.32]);
    }
    var hump = spline([[0.36, 0.2], [0.4, 0.42], [0.3, 0.56], [0.12, 0.54], [-0.12, 0.44], [-0.3, 0.32], [-0.26, 0.2]], 4);
    side(tur, hump, -0.2, -0.18, 3);
    side(tur, hump, 0.18, 0.2, 3);
    // belt and pulleys on the outer plate
    loop(tur, ringPts(-0.21, 0.42, 0.28, 0.06, 14, 'x', spin));
    loop(tur, ringPts(-0.21, 0.36, -0.14, 0.06, 14, 'x', spin));
    seg(tur, [-0.21, 0.48, 0.28], [-0.21, 0.42, -0.14]); seg(tur, [-0.21, 0.36, 0.28], [-0.21, 0.3, -0.14]);
    // flywheel stack at the front, blue roller at the back, three rods
    var fw = new Geo();
    cyl(fw, 0, 0, 0, 0.12, 0.12, 0.34, 18, 'x', 3, -spin * 3); // flywheel spins up and out toward the shot
    for (var d = 0; d < 6; d++) loop(fw, ringPts(-0.15 + d * 0.06, 0, 0, 0.12, 18, 'x', -spin * 3));
    tur.merge(fw, move(0, 0.4, -0.14));
    cyl(tur, 0, 0.46, 0.3, 0.055, 0.055, 0.36, 12, 'x', 4, spin);
    [0.27, 0.31, 0.35].forEach(function (ry) { seg(tur, [-0.2, ry, -0.27], [0.2, ry, -0.27]); });
    var toWorld = chain(rotY(yaw), move(0, 0, 0.06));
    g.merge(tur, toWorld);
    if (o.game) return g;
    // one ball's journey: roll in, get swept up by the flaps, drop into a pocket, ride the spindexer,
    // lift into the flywheel and launch out of the shooter
    var lerp = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; };
    var pocketAt = function (ang) { return [Math.cos(ang) * 0.15, -0.06, 0.1 + Math.sin(ang) * 0.15]; };
    var start = [0.05, -0.27, -1.05], mouth = [0, -0.2, -0.62], under = [0, -0.06, -0.42];
    var feed = toWorld([0, 0.3, -0.02]), wheel = toWorld([0, 0.42, -0.14]);
    var launch = toWorld([0, 0.78, -0.62]);
    var pos = null, size = 1;
    if (p < 0.12) { pos = lerp(start, mouth, easeOut(p / 0.12)); size = easeOut(p / 0.05); }
    else if (p < 0.2) pos = lerp(mouth, under, span(p, 0.12, 0.2));
    else if (p < 0.3) pos = lerp(under, pocketAt(BASE), span(p, 0.2, 0.3));
    else if (p < 0.58) pos = pocketAt(BASE + idx);
    else if (p < 0.7) { var e = span(p, 0.58, 0.7); pos = lerp(lerp(pocketAt(BASE + TAU / 3), feed, e), feed, 0); pos[1] += Math.sin(Math.PI * e) * 0.05; }
    else if (p < 0.76) pos = lerp(feed, wheel, span(p, 0.7, 0.76));
    else if (p < 0.96) { var f2 = span(p, 0.76, 0.96, easeOut); pos = lerp(wheel, launch, f2); pos[1] += Math.sin(Math.PI * f2) * 0.15; size = 1 - easeIn(f2); }
    if (pos && size > 0.03) sphere(g, pos[0], pos[1], pos[2], 0.085 * size, 4, 8, p * TAU * 2);
    return g;
  };
  // a thin horizontal plate between x0..x1, z0..z1 at heights y0..y1
  function slabY(g, x0, x1, z0, z1, y0, y1) {
    var v = [], e = [];
    [y0, y1].forEach(function (y) { v.push([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]); });
    for (var i = 0; i < 4; i++) { e.push([i, (i + 1) % 4]); e.push([4 + i, 4 + (i + 1) % 4]); e.push([i, 4 + i]); }
    return g.add(v, e);
  }

  // cup: boba pearls rise and fade, the drink level ripples, the straw sways
  MODELS.cup = function (t) {
    var g = new Geo(), p = cycle(t, 6);
    var r0 = 0.3, r1 = 0.42, y0 = -0.72, y1 = 0.48;
    cyl(g, 0, (y0 + y1) / 2, 0, r0, r1, y1 - y0, 22, 'y', 3);
    var level = 0.18, pts = [];
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * TAU, rr = r0 + (r1 - r0) * (level - y0) / (y1 - y0);
      pts.push([Math.cos(a) * rr * 0.98, level + Math.sin(a * 3 + p * TAU * 2) * 0.025, Math.sin(a) * rr * 0.98]);
    }
    loop(g, pts);
    cyl(g, 0, y1 + 0.04, 0, 0.45, 0.45, 0.06, 22, 'y', 4);
    var dome = [];
    for (var k = 0; k <= 6; k++) { var b = k / 6 * Math.PI / 2; dome.push([Math.cos(b) * 0.42, y1 + 0.07 + Math.sin(b) * 0.15, 0]); }
    for (var q = 0; q < 4; q++) g.merge(new Geo().add(dome, dome.slice(1).map(function (_, j) { return [j, j + 1]; })), rotY(q * Math.PI / 2 + 0.4));
    for (var n = 0; n < 7; n++) {
      var life = (p + n / 7) % 1, ang = n * 2.3 + life * 0.8;
      var py = y0 + 0.08 + easeInOut(life) * 0.75, pr = (r0 - 0.08) * (0.4 + 0.5 * ((n * 37) % 10) / 10);
      var s = Math.sin(Math.PI * life);
      if (s > 0.05) circle(g, Math.cos(ang) * pr, py, Math.sin(ang) * pr, 0.045 * Math.min(1, s * 2), 10);
    }
    // sticker: a star drawn by a pen onto the cup's front surface, then wiped
    var surf = function (u, v) { // u: angle around the cup, v: height
      var rr = r0 + (r1 - r0) * (v - y0) / (y1 - y0) + 0.004;
      return [Math.sin(u) * rr, v, -Math.cos(u) * rr];
    };
    var star = [];
    for (var sp = 0; sp <= 10; sp++) {
      var sa = -Math.PI / 2 + sp / 10 * TAU, srad = sp % 2 ? 0.07 : 0.17;
      star.push([Math.cos(sa) * srad * 1.6, -0.16 - Math.sin(sa) * srad]);
    }
    var pathPt = function (k) {
      var f = k * 10, i = Math.min(9, Math.floor(f)), w = f - i;
      return [star[i][0] + (star[i + 1][0] - star[i][0]) * w, star[i][1] + (star[i + 1][1] - star[i][1]) * w];
    };
    var dr = span(p, 0.05, 0.58), wp = span(p, 0.66, 0.84), bk = span(p, 0.82, 0.98);
    var STEPS = 60, inked = [];
    for (var si = Math.floor(wp * STEPS); si <= Math.floor(dr * STEPS); si++) { var sq = pathPt(si / STEPS); inked.push(surf(sq[0], sq[1])); }
    if (inked.length > 1) poly(g, inked);
    var tipK = p < 0.82 ? dr : 1 - bk, tq = pathPt(tipK), tip = surf(tq[0], tq[1]);
    var away = span(p, 0.58, 0.66) * 0.18 * (1 - span(p, 0.92, 1));
    var pen = new Geo();
    cyl(pen, 0.42, 0, 0, 0.035, 0.035, 0.64, 8, 'x', 2);
    cyl(pen, 0.05, 0, 0, 0.004, 0.035, 0.1, 8, 'x', 1);
    var nx2 = Math.sin(tq[0]), nz2 = -Math.cos(tq[0]);
    g.merge(pen, chain(rotZ(0.55), rotY(Math.PI / 2 - tq[0]), move(tip[0] + nx2 * away, tip[1] + away * 0.4, tip[2] + nz2 * away)));
    var straw = new Geo();
    cyl(straw, 0, 0, 0, 0.045, 0.045, 1.35, 8, 'y', 2);
    g.merge(straw, chain(rotZ(-0.2 + Math.sin(p * TAU) * 0.05), move(0.1, 0.62, 0.05)));
    return g;
  };

  // Nora: speech bubble with dots that hop in sequence
  MODELS.nora = function (t) {
    var g = new Geo(), p = cycle(t, 1.6);
    var out = rrect(1.7, 1.0, 0.3, 5);
    var idx = out.findIndex(function (q) { return q[1] < -0.49 && q[0] < -0.2; });
    out.splice(idx >= 0 ? idx : out.length, 0, [-0.08, -0.5], [-0.62, -0.86], [-0.35, -0.5]);
    slab(g, out, 0, 0, -0.14, 0.14, 2);
    [-0.4, 0, 0.4].forEach(function (x, i) {
      var hop = Math.sin(Math.PI * clamp01((p - i * 0.16) / 0.4));
      sphere(g, x, 0.02 + easeOut(hop) * 0.13, -0.18, 0.09, 4, 8, 0);
    });
    return g;
  };

  var CYCLE = { models: ['console', 'phonecase', 'sleeve'] };
  var YAW = { ftc: -0.62 };
  var TILT = { ftc: 0.5, ledger: 0.22, cup: 0.2, sleeve: 0.22, console: 0.16, solace: 0.16 };
  var NAMES = { yume: 'tablet.obj', solace: 'solace.obj', console: 'console.obj', ledger: 'coins.obj', ftc: 'robot-27308.obj',
    cup: 'cup.obj', nora: 'bubble.obj', phonecase: 'case.obj', sleeve: 'sleeve.obj' };

  // scale each model once (at t=0) so animation never changes its size
  var scales = {};
  function build(name, t) {
    var g = MODELS[name](t);
    if (!scales[name]) {
      var g0 = MODELS[name](0), max = 0;
      g0.v.forEach(function (p) { max = Math.max(max, Math.hypot(p[0], p[1], p[2])); });
      scales[name] = 1 / (max || 1);
    }
    var s = scales[name];
    for (var i = 0; i < g.v.length; i++) g.v[i] = [g.v[i][0] * s, g.v[i][1] * s, g.v[i][2] * s];
    return g;
  }

  /* ---------- shared pointer ---------- */

  var instances = [];
  var pointer = { x: -1e4, y: -1e4, t: 0 };
  function track(x, y) { pointer.x = x; pointer.y = y; pointer.t = performance.now(); instances.forEach(function (w) { w.poke(); }); }
  window.addEventListener('pointermove', function (e) { track(e.clientX, e.clientY); }, { passive: true });
  window.addEventListener('touchmove', function (e) { if (e.touches[0]) track(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
  window.addEventListener('scroll', function () { instances.forEach(function (w) { w.poke(); }); }, { passive: true });

  /* ---------- renderer ---------- */

  function WireObject(canvas, kind, opts) {
    opts = opts || {};
    var self = this;
    var ctx = canvas.getContext('2d');
    var family = opts.fontFamily || 'monospace';
    var theme = opts.theme || { bg: [0, 0, 0], ink: [1, 1, 1] };
    var names = (CYCLE[kind] || [kind]).slice();
    var W = 0, H = 0, dpr = 1;
    var visible = false, enabled = true, hover = 0, hoverT = 0, raf = 0, last = 0;
    var t = 0, yaw = 0, pitch = -0.12, tYaw = 0, tPitch = 0, zoom = 1, swap = 0;

    function mix(k, a) {
      var c = [0, 1, 2].map(function (i) { return Math.round((theme.bg[i] + (theme.ink[i] - theme.bg[i]) * k) * 255); });
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')';
    }
    function accent(a) {
      var c = theme.bg[0] > 0.5 ? [107, 79, 216] : [170, 140, 255];
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    }

    function resize() {
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cw; H = ch;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      draw();
    }

    function update(dt) {
      var r = canvas.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var nx = (pointer.x - cx) / Math.max(200, r.width * 0.75);
      var ny = (pointer.y - cy) / Math.max(200, r.height * 0.75);
      var inside = pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
      var reach = inside ? 1 : 0.4;
      nx = Math.max(-1.4, Math.min(1.4, nx)); ny = Math.max(-1.4, Math.min(1.4, ny));
      if (pointer.t === 0) { nx = 0; ny = 0; }
      if (enabled) t += dt * (1 + hover * 0.6);
      var sway = enabled ? Math.sin(t * 0.45) * 0.32 : 0;
      var vw = window.innerWidth || 1, vh = window.innerHeight || 1;
      var cxn = Math.max(-1, Math.min(1, (cx - vw / 2) / (vw / 2))), cyn = Math.max(-1, Math.min(1, (cy - vh / 2) / (vh / 2)));
      tYaw = (YAW[names[0]] || 0) + sway + (inside ? nx * 0.75 : cxn * 0.45);
      tPitch = -(TILT[names[0]] || 0.12) + (enabled ? Math.sin(t * 0.31) * 0.05 : 0) + (inside ? ny * 0.4 : cyn * 0.12);
      var k = Math.min(1, dt * 6);
      yaw += (tYaw - yaw) * k;
      pitch += (tPitch - pitch) * k;
      hover += (hoverT - hover) * Math.min(1, dt * 8);
      zoom = 1 + hover * 0.08;
      if (names.length > 1 && enabled) {
        swap += dt;
        if (swap > 8) { swap = 0; names.push(names.shift()); }
      }
    }

    function draw() {
      if (!W) return;
      var g = build(names[0], t);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      var scale = Math.min(W, H) * 0.44 * zoom, camZ = 3.4;
      var light = theme.bg[0] > 0.5;
      var r = canvas.getBoundingClientRect();
      var kx = r.width ? W / r.width : 1, ky = r.height ? H / r.height : 1;
      var px = (pointer.x - r.left) * kx, py = (pointer.y - r.top) * ky;
      var fade = names.length > 1 ? 0.15 + 0.85 * easeInOut(Math.min(1, swap / 0.45, (8 - swap) / 0.45)) : 1;
      var P = new Array(g.v.length);
      for (var i = 0; i < g.v.length; i++) {
        var v = g.v[i];
        var x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy;
        var y = v[1] * cp - z * sp; z = v[1] * sp + z * cp;
        var f = camZ / (camZ + z);
        var sx = W / 2 + x * scale * f, syy = H / 2 - y * scale * f;
        var dx = sx - px, dy = syy - py, d = Math.hypot(dx, dy), glow = 0;
        if (d < 110) {
          glow = 1 - d / 110;
          var push = glow * glow * 14;
          sx += dx / (d || 1) * push; syy += dy / (d || 1) * push;
        }
        P[i] = [sx, syy, z, glow];
      }
      ctx.lineCap = 'round';
      for (var e = 0; e < g.e.length; e++) {
        var a = P[g.e[e][0]], b = P[g.e[e][1]];
        var depth = Math.max(0, Math.min(1, 1 - ((a[2] + b[2]) / 2 + 1) / 2));
        var glowE = Math.max(a[3], b[3]);
        ctx.lineWidth = (light ? 1.15 : 1) + depth * 0.6 + glowE * 0.8;
        ctx.strokeStyle = glowE > 0.05 ? accent((0.35 + 0.65 * glowE) * fade)
          : mix((light ? 0.4 : 0.28) + (light ? 0.58 : 0.68) * depth * (0.85 + 0.15 * hover), fade);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (var j = 0; j < P.length; j++) {
        var q = P[j];
        if (q[3] > 0.05) { ctx.fillStyle = accent(0.9 * fade); ctx.fillRect(q[0] - 1.5, q[1] - 1.5, 3, 3); }
      }
      ctx.font = '11px ' + family;
      ctx.textBaseline = 'top';
      ctx.fillStyle = mix(0.55);
      ctx.fillText(NAMES[names[0]] || names[0], 4, 4);
      ctx.textAlign = 'right';
      ctx.fillText('v ' + g.v.length + '  e ' + g.e.length, W - 4, 4);
      ctx.textAlign = 'left';
    }

    function frame(now) {
      raf = 0;
      if (!visible) return;
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      update(dt);
      draw();
      var settling = Math.abs(tYaw - yaw) > 0.002 || Math.abs(tPitch - pitch) > 0.002 || Math.abs(hoverT - hover) > 0.01;
      if (enabled || settling) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && visible) { last = 0; raf = requestAnimationFrame(frame); } }

    this.poke = kick;
    this.setVisible = function (v) { visible = v; kick(); };
    this.setEnabled = function (v) { enabled = v; kick(); };
    this.setHover = function (v) { hoverT = v ? 1 : 0; kick(); };
    this.setTheme = function (tt) { theme = tt; draw(); };
    this.resize = resize;
    instances.push(self);
    resize();
  }

  window.WireObject = WireObject;
  window.WireKit = { Geo: Geo, models: MODELS, sphere: sphere, cyl: cyl, loop: loop, seg: seg, ringPts: ringPts };
})();
