/*
 * FtcMatch: a small isometric vector scene of an FTC DECODE-style match:
 * a square robot collects three balls on its own side, lines up at the centre
 * of the field, turns its turret and shoots them into the goal in the far corner.
 * Same control surface as AsciiMedia: setVisible / setEnabled / setHover / setTheme / resize.
 */
(function () {
  'use strict';

  var S0 = [0.86, 0.86], MID = [0.56, 0.56], GOAL = [0.1, 0.1];
  var BALLS = [[0.9, 0.6], [0.75, 0.75], [0.6, 0.9]];
  var PLAN = [{ go: BALLS[0], pick: 0 }, { go: BALLS[1], pick: 1 }, { go: BALLS[2], pick: 2 },
    { go: MID }, { aim: true }, { shoot: true }, { wait: 0.9 }, { go: S0, respawn: true }, { wait: 0.4 }];
  var SPEED = 0.34, ROBOT = 0.125, ROBOT_H = 0.085, GOAL_W = 0.17, GOAL_H = 0.22, BALL_R = 0.018;

  function FtcMatch(canvas, mode, opts) {
    opts = opts || {};
    var ctx = canvas.getContext('2d');
    var family = opts.fontFamily || 'monospace';
    var theme = opts.theme || { bg: [0, 0, 0], ink: [1, 1, 1] };
    var W = 0, H = 0, dpr = 1, S = 100, cx = 0, top = 0;
    var visible = false, enabled = true, hover = 0, hoverT = 0, raf = 0, last = 0;
    var st = fresh();

    function fresh() {
      return { u: S0[0], v: S0[1], heading: Math.PI * 1.25, turret: 0, idx: 0, timer: 0, shotT: 0.3,
        carried: 0, ground: [1, 1, 1], flying: [], score: 0, trail: [] };
    }
    function col(k, a) {
      var c = [0, 1, 2].map(function (i) { return Math.round((theme.bg[i] + (theme.ink[i] - theme.bg[i]) * k) * 255); });
      return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')';
    }
    function P(u, v, h) { return [cx + (u - v) * S, top + (u + v) * S * 0.5 - (h || 0) * S * 1.15]; }

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      var hud = 34;
      // field diamond is 2S wide and S tall; the goal rises GOAL_H above the far corner
      S = Math.min((W - 24) / 2, (H - hud - 16) / (1 + GOAL_H * 1.15 + 0.06));
      cx = W / 2;
      top = hud + GOAL_H * 1.15 * S + ((H - hud - 16) - S * (1 + GOAL_H * 1.15 + 0.06)) / 2;
      draw();
    }

    /* ---------- simulation ---------- */

    function step(dt) {
      var p = PLAN[st.idx];
      for (var n = st.flying.length - 1; n >= 0; n--) {
        var f = st.flying[n];
        f.s += dt / 0.9;
        if (f.s >= 1) { st.flying.splice(n, 1); st.score++; }
      }
      for (var g = 0; g < 3; g++) if (st.ground[g] > 0 && st.ground[g] < 1) st.ground[g] = Math.min(1, st.ground[g] + dt * 2.5);
      if (p.go) {
        if (p.respawn && !st.ground[0] && !st.ground[1] && !st.ground[2]) st.ground = [0.01, 0.01, 0.01];
        var du = p.go[0] - st.u, dv = p.go[1] - st.v, dist = Math.hypot(du, dv);
        if (dist > 0.002) {
          var want = Math.atan2(dv, du);
          st.heading += angDiff(want, st.heading) * Math.min(1, dt * 8);
        }
        st.turret += angDiff(0, st.turret) * Math.min(1, dt * 4);
        var len = SPEED * dt * (0.35 + 0.65 * Math.min(1, dist / 0.08));
        if (dist <= len || dist < 0.003) {
          st.u = p.go[0]; st.v = p.go[1];
          if (p.pick !== undefined && st.ground[p.pick] > 0) { st.ground[p.pick] = 0; st.carried++; }
          next();
        } else { st.u += du / dist * len; st.v += dv / dist * len; }
      } else if (p.aim) {
        var target = Math.atan2(GOAL[1] - st.v, GOAL[0] - st.u) - st.heading;
        var d = angDiff(target, st.turret);
        st.turret += d * Math.min(1, dt * 6);
        if (Math.abs(d) < 0.02) next();
      } else if (p.shoot) {
        st.shotT += dt;
        if (st.carried > 0 && st.shotT > 0.5) {
          st.shotT = 0; st.carried--;
          st.flying.push({ s: 0, u0: st.u, v0: st.v, h0: ROBOT_H + 0.05 });
        }
        if (st.carried === 0 && !st.flying.length) next();
      } else if (p.wait) {
        st.timer += dt;
        if (st.timer >= p.wait) next();
      }
    }
    function next() {
      st.timer = 0; st.shotT = 0.3; st.idx = (st.idx + 1) % PLAN.length;
      if (st.idx === 0) st.score = 0;
    }
    function angDiff(a, b) { var d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }

    /* ---------- drawing ---------- */

    function poly(pts, fill, stroke, lw) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
    }
    // an axis-aligned box in field units
    function box(u0, v0, u1, v1, h, k) {
      var top4 = [P(u0, v0, h), P(u1, v0, h), P(u1, v1, h), P(u0, v1, h)];
      poly([P(u0, v1, 0), P(u1, v1, 0), P(u1, v1, h), P(u0, v1, h)], col(k * 0.62), col(k * 0.95, 0.5), 1); // left (front) face
      poly([P(u1, v0, 0), P(u1, v1, 0), P(u1, v1, h), P(u1, v0, h)], col(k * 0.45), col(k * 0.95, 0.5), 1); // right face
      poly(top4, col(k * 0.85), col(k, 0.8), 1);
      return top4;
    }
    function shadow(u, v, r) {
      var p = P(u, v, 0);
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.scale(1, 0.5);
      var g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * S * 1.5);
      var k = theme.bg[0] > 0.5 ? 0.45 : 0;
      g.addColorStop(0, col(k, 0.55));
      g.addColorStop(1, col(k, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * S * 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    function ball(u, v, h, alpha, kind) {
      var p = P(u, v, h), r = Math.max(2.5, BALL_R * S * 1.25);
      var g = ctx.createRadialGradient(p[0] - r * 0.35, p[1] - r * 0.45, r * 0.1, p[0], p[1], r);
      var k = kind ? 0.95 : 0.7;
      g.addColorStop(0, col(1, alpha)); g.addColorStop(1, col(k * 0.55, alpha));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1] - r * 0.6, r, 0, Math.PI * 2); ctx.fill();
    }

    function drawField() {
      var c = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
      poly(c, col(0.06), null);
      ctx.lineWidth = 1;
      ctx.strokeStyle = col(0.22);
      for (var i = 1; i < 6; i++) {
        var a = P(i / 6, 0), b = P(i / 6, 1), d = P(0, i / 6), e = P(1, i / 6);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      }
      // own launch zone near the viewer
      poly([P(1, 0.5), P(1, 1), P(0.5, 1)], col(0.14, 0.6), null);
      // centre line
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = col(0.5);
      var m0 = P(1, 0), m1 = P(0, 1);
      ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke();
      ctx.setLineDash([]);
      poly(c, null, col(0.6), 1.5);
      // walls
      var wall = 0.035;
      poly([P(0, 0, 0), P(1, 0, 0), P(1, 0, wall), P(0, 0, wall)], col(0.2, 0.7), col(0.45), 1);
      poly([P(0, 0, 0), P(0, 1, 0), P(0, 1, wall), P(0, 0, wall)], col(0.16, 0.7), col(0.45), 1);
    }

    function drawGoal() {
      var u0 = 0.015, v0 = 0.015, u1 = u0 + GOAL_W, v1 = v0 + GOAL_W;
      var t4 = box(u0, v0, u1, v1, GOAL_H, 0.75);
      // open basket mouth
      var inset = 0.025;
      poly([P(u0 + inset, v0 + inset, GOAL_H), P(u1 - inset, v0 + inset, GOAL_H), P(u1 - inset, v1 - inset, GOAL_H), P(u0 + inset, v1 - inset, GOAL_H)], col(0.08), col(0.5), 1);
      // tag square on the front face
      var fc = P((u0 + u1) / 2, v1, GOAL_H * 0.55), s = S * 0.035;
      ctx.fillStyle = col(0.95);
      ctx.fillRect(fc[0] - s, fc[1] - s, s * 2, s * 2);
      ctx.fillStyle = col(0.1);
      ctx.fillRect(fc[0] - s * 0.5, fc[1] - s * 0.5, s, s);
    }

    function drawRobot() {
      var h = ROBOT / 2;
      shadow(st.u, st.v, ROBOT * 0.75);
      ctx.save();
      // body: rotate the square footprint by heading, drawn as a prism
      var cs = Math.cos(st.heading), sn = Math.sin(st.heading);
      function corner(a, b) { return [st.u + a * cs - b * sn, st.v + a * sn + b * cs]; }
      var fp = [corner(h, h), corner(h, -h), corner(-h, -h), corner(-h, h)];
      // wheels (mecanum) at the four corners, slightly outside
      for (var w = 0; w < 4; w++) {
        var wc = [corner(h * 0.7 * (w < 2 ? 1 : -1), h * 1.08 * (w % 2 ? -1 : 1))];
        var wp = P(wc[0][0], wc[0][1], 0.012);
        ctx.fillStyle = col(0.3);
        ctx.beginPath(); ctx.ellipse(wp[0], wp[1], S * 0.022, S * 0.014, 0, 0, Math.PI * 2); ctx.fill();
      }
      // sides: draw the two faces that face the viewer (largest u+v midpoints)
      var faces = [];
      for (var i = 0; i < 4; i++) {
        var a = fp[i], b = fp[(i + 1) % 4];
        faces.push({ a: a, b: b, d: a[0] + a[1] + b[0] + b[1] });
      }
      faces.sort(function (x, y) { return x.d - y.d; });
      faces.forEach(function (f, i) {
        var shade = i < 2 ? 0.35 : (f.a[0] - f.b[0]) * (f.a[1] - f.b[1]) > 0 ? 0.5 : 0.62;
        poly([P(f.a[0], f.a[1], 0.012), P(f.b[0], f.b[1], 0.012), P(f.b[0], f.b[1], ROBOT_H), P(f.a[0], f.a[1], ROBOT_H)],
          col(shade), col(0.9, 0.45), 1);
      });
      var topPts = fp.map(function (q) { return P(q[0], q[1], ROBOT_H); });
      poly(topPts, col(0.82), col(1, 0.9), 1.2);
      // intake lip on the front edge
      var f0 = corner(h, h * 0.8), f1 = corner(h, -h * 0.8);
      var a0 = P(f0[0], f0[1], ROBOT_H), a1 = P(f1[0], f1[1], ROBOT_H);
      ctx.strokeStyle = col(0.15); ctx.lineWidth = Math.max(2, S * 0.012);
      ctx.beginPath(); ctx.moveTo(a0[0], a0[1]); ctx.lineTo(a1[0], a1[1]); ctx.stroke();
      // team plate
      var tp = P(st.u, st.v, ROBOT_H);
      // turret: disc + barrel pointing along heading + turret angle
      var ta = st.heading + st.turret;
      ctx.fillStyle = col(0.55);
      ctx.beginPath(); ctx.ellipse(tp[0], tp[1], S * 0.04, S * 0.02, 0, 0, Math.PI * 2); ctx.fill();
      var bEnd = P(st.u + Math.cos(ta) * 0.06, st.v + Math.sin(ta) * 0.06, ROBOT_H + 0.03);
      ctx.strokeStyle = col(0.95); ctx.lineWidth = Math.max(3, S * 0.022); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tp[0], tp[1] - S * 0.01); ctx.lineTo(bEnd[0], bEnd[1]); ctx.stroke();
      ctx.lineCap = 'butt';
      // carried balls sit in the hopper
      for (var c = 0; c < st.carried; c++) {
        var off = (c - 1) * 0.03;
        ball(st.u - Math.cos(st.heading) * 0.03 + Math.sin(st.heading) * off, st.v - Math.sin(st.heading) * 0.03 - Math.cos(st.heading) * off, ROBOT_H, 1, c % 2);
      }
      ctx.restore();
    }

    function draw() {
      if (!W) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var boost = 0.85 + 0.15 * hover;
      ctx.globalAlpha = boost;
      drawField();
      // depth sort: far (small u+v) first
      var items = [{ d: 0.2, f: drawGoal }];
      BALLS.forEach(function (b, i) {
        if (st.ground[i] > 0) items.push({ d: b[0] + b[1], f: function () { shadow(b[0], b[1], BALL_R * 1.4); ball(b[0], b[1], 0, Math.min(1, st.ground[i]), i % 2); } });
      });
      items.push({ d: st.u + st.v, f: drawRobot });
      items.sort(function (a, b) { return a.d - b.d; });
      items.forEach(function (it) { it.f(); });
      // balls in flight with a short fading trail
      st.flying.forEach(function (f) {
        var tg = [GOAL[0] + 0.0, GOAL[1] + 0.0];
        for (var k = 5; k >= 0; k--) {
          var s = Math.max(0, f.s - k * 0.035);
          var u = f.u0 + (tg[0] - f.u0) * s, v = f.v0 + (tg[1] - f.v0) * s;
          var hh = f.h0 + (GOAL_H + 0.02 - f.h0) * s + Math.sin(Math.PI * s) * 0.32;
          if (k) {
            var p = P(u, v, hh);
            ctx.fillStyle = col(0.9, 0.35 - k * 0.05);
            ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(1.5, BALL_R * S * (1 - k * 0.12)), 0, Math.PI * 2); ctx.fill();
          } else ball(u, v, hh, 1, 1);
        }
      });
      ctx.globalAlpha = 1;
      // HUD
      ctx.font = '11px ' + family;
      ctx.textBaseline = 'top';
      ctx.fillStyle = col(0.75);
      ctx.fillText('27308', 12, 12);
      var hud = st.idx <= 2 ? 'intake ' + st.carried + '/3' : 'score ' + ('0' + st.score).slice(-2);
      ctx.textAlign = 'right';
      ctx.fillText(hud, W - 12, 12);
      ctx.textAlign = 'left';
    }

    function loop(now) {
      raf = 0;
      if (!visible || !enabled) return;
      raf = requestAnimationFrame(loop);
      var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      hover += (hoverT - hover) * 0.12;
      step(dt);
      draw();
    }
    function kick() { if (!raf && visible && enabled) { last = 0; raf = requestAnimationFrame(loop); } }

    this.setVisible = function (v) { visible = v; kick(); };
    this.setEnabled = function (v) { enabled = v; if (!v) draw(); kick(); };
    this.setHover = function (v) { hoverT = v ? 1 : 0; if (!enabled) { hover = hoverT; draw(); } };
    this.setTheme = function (t) { theme = t; draw(); };
    this.resize = resize;
    resize();
  }

  window.FtcMatch = FtcMatch;
})();
