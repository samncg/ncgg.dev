/*
 * Drive mode. Press W, A, S or D (or "drive it" on the FTC card): the page scrolls to the FTC robot,
 * a pulse of ASCII waves rolls out from it, and the page becomes an isometric field. Drive with
 * WASD / arrows (a joystick on touch), drive into artifacts to collect up to three, and shoot at the
 * cursor with space or click (drag and release the shoot button on touch). Balls that drop into a
 * goal score. Esc or "exit" folds the field back into the page.
 * The robot is the same CAD-derived wireframe as the Work card (window.WireKit from wire.js).
 */
(function () {
  'use strict';

  var K = window.WireKit;
  if (!K || !window.requestAnimationFrame) return;

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarseMQ = window.matchMedia('(pointer: coarse)');
  var MONO = '"Azeret Mono", ui-monospace, Menlo, Consolas, monospace';
  var TAU = Math.PI * 2, C = Math.cos(Math.PI / 6), S = 0.5, R2 = Math.SQRT2;

  // world units are field tiles (24 in); the field is 6 x 6
  var N = 6, WALL = 0.42;
  var GL = 1.15, GH = 1.45;            // goal footprint leg and rim height
  var BR = 0.12;                       // artifact radius
  var RK = 0.62, RR = 0.42;            // robot model scale and collision radius
  var G = 13, VMAX = 2.9, CAP = 3, MAXB = 9, RANGE = 5.6;
  var BEST_KEY = 'ncgg:ftc-best';
  var MATCH = 60;                     // seconds on the clock
  var canVT = typeof document.startViewTransition === 'function';
  var GOALS = [{ cx: N, cy: 0, sx: -1, sy: 1 }, { cx: 0, cy: N, sx: 1, sy: -1 }];
  GOALS.forEach(function (g) {
    g.mx = g.cx + g.sx * GL / 3; g.my = g.cy + g.sy * GL / 3; g.flash = 0;
    g.v = [[g.cx, g.cy], [g.cx + g.sx * GL, g.cy], [g.cx, g.cy + g.sy * GL]];
  });

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOut(x) { x = clamp(x, 0, 1); return 1 - Math.pow(1 - x, 3); }
  function easeInOut(x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  function angDiff(a, b) { var d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
  function fluid() { return window.NCGG && window.NCGG.field ? window.NCGG.field() : null; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function palette() {
    var L = root.getAttribute('data-theme') === 'light';
    return {
      light: L,
      ink: L ? [14, 14, 14] : [236, 236, 236],
      bg: L ? [242, 242, 242] : [0, 0, 0],
      purple: L ? [107, 79, 216] : [170, 140, 255],
      green: L ? [22, 128, 82] : [110, 214, 150]
    };
  }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }

  /* ---------- goals ---------- */

  function goalUV(g, x, y) { return [(x - g.cx) * g.sx / GL, (y - g.cy) * g.sy / GL]; }
  function inGoal(g, x, y, m) {
    var q = goalUV(g, x, y), mm = (m || 0) / GL;
    return q[0] >= mm && q[1] >= mm && q[0] + q[1] <= 1 - mm * R2;
  }
  // distance from the goal's open face; positive on the field side
  function goalOut(g, x, y) { var q = goalUV(g, x, y); return (q[0] + q[1] - 1) * GL / R2; }

  /* ---------- state ---------- */

  var state = 'off';
  var layer, cv, ctx, hud = {}, stickEl, knob, fireEl, driveBtn;
  var W = 0, H = 0, dpr = 1, s = 100, follow = false;
  var camX = N / 2, camY = N / 2, ox = 0, oy = 0, offX = 0, offY = 0, off0 = [0, 0];
  var raf = 0, last = 0, clock = 0, pulse = 0, pulseDur = 1, pulseX = 0, pulseY = 0, pulseR = 0, maxR = 0;
  var keys = {}, aim = { sx: 0, sy: 0, have: false }, touchAim = null, stick = { x: 0, y: 0 };
  var bot = null, balls = [], popups = [], score = 0, best = 0, spawnT = 0, cool = 0, hintT = 0;
  var clipped = [], rects = [], prevFocus = null, viaTouch = false, lastPointer = 'mouse', gustT = 0;
  var sBase = 100, fade = 1, timeLeft = MATCH, lastSec = -1, overT = 0, outroT = 0, outroTo = [0, 0], bestBefore = 0;
  var vtMode = false, vtReady = false, matchEnd = 0, hiddenAt = 0, outroAt = 0, toldShoot = false;

  /* ---------- projection (true isometric; (0,0) is the near corner, (N,N) the far one) ---------- */

  function P(x, y, z) { return [ox + (x - y) * C * s, oy - (x + y) * S * s - (z || 0) * s]; }
  function unP(sx, sy) {
    var a = (sx - ox) / (C * s), b = -(sy - oy) / (S * s);
    return [(a + b) / 2, (b - a) / 2];
  }
  // a direction on screen (right, down) as a direction on the floor
  function screenDir(dx, dy) {
    var a = dx / C, b = -dy / S, x = (a + b) / 2, y = (b - a) / 2, l = Math.hypot(x, y) || 1;
    return [x / l, y / l];
  }

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var top = 96, bottom = viaTouch ? 40 : 64;
    var fit = Math.min((W - 40) / (2 * N * C), (H - top - bottom) / (N + WALL + 0.2));
    s = Math.max(fit, 62);
    sBase = s;
    follow = s > fit + 0.5;
  }
  function camera(dt) {
    var tx = follow ? bot.x : N / 2, ty = follow ? bot.y : N / 2;
    var k = dt === 0 ? 1 : 1 - Math.exp(-dt * 4);
    camX += (tx - camX) * k; camY += (ty - camY) * k;
    var cy = follow ? H * 0.54 : (96 + H - (viaTouch ? 40 : 64)) / 2 + 0.2 * s;
    ox = W / 2 - (camX - camY) * C * s + offX;
    oy = cy + (camX + camY) * S * s + offY;
  }

  /* ---------- robot ---------- */

  function newBot() {
    return { x: N / 2 - 0.7, y: N / 2 - 0.7, vx: 0, vy: 0, th: Math.PI / 4, spin: 0, flap: 0, idx: 0, idxT: 0, tur: 0, held: [] };
  }
  function botXf(b) {
    var c = Math.cos(b.th), sn = Math.sin(b.th);
    // model: x right, y up, front = -z  ->  world: forward (c, sn), right (sn, -c), z up
    return function (v) {
      var f = -v[2] * RK, r = v[0] * RK;
      return [b.x + f * c + r * sn, b.y + f * sn - r * c, (v[1] + 0.39) * RK];
    };
  }
  function muzzle() {
    var a = bot.tur;
    return botXf(bot)([-0.5 * Math.sin(a), 0.62, -0.5 * Math.cos(a) + 0.06]);
  }
  function pocket(k) {
    var a = -Math.PI / 2 + bot.idx + k * TAU / 3;
    return botXf(bot)([Math.cos(a) * 0.15, -0.02, 0.1 + Math.sin(a) * 0.15]);
  }

  /* ---------- aiming and shooting ---------- */

  function goalOnScreen(sx, sy) {
    for (var i = 0; i < GOALS.length; i++) {
      var g = GOALS[i], x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      g.v.forEach(function (v) {
        [0, GH].forEach(function (z) {
          var q = P(v[0], v[1], z);
          x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
        });
      });
      var pad = 14;
      if (sx > x0 - pad && sx < x1 + pad && sy > y0 - pad && sy < y1 + pad) return g;
    }
    return null;
  }
  function aimPoint() {
    if (state !== 'on' && state !== 'entering') return null;
    if (touchAim && touchAim.active) {
      var l = Math.hypot(touchAim.dx, touchAim.dy), d = screenDir(touchAim.dx, touchAim.dy);
      var dist = clamp((l - 14) / 120, 0.08, 1) * RANGE;
      var x = clamp(bot.x + d[0] * dist, BR, N - BR), y = clamp(bot.y + d[1] * dist, BR, N - BR);
      for (var i = 0; i < GOALS.length; i++) if (goalOut(GOALS[i], x, y) < 0.35) return { x: x, y: y, goal: GOALS[i] };
      return { x: x, y: y, goal: null };
    }
    if (aim.have && !viaTouch) {
      var gg = goalOnScreen(aim.sx, aim.sy), w = unP(aim.sx, aim.sy);
      return { x: w[0], y: w[1], goal: gg };
    }
    return null;
  }
  function plan(A) {
    var m = muzzle(), tx, ty, tz;
    if (!A) A = { x: bot.x + Math.cos(bot.th) * 2.5, y: bot.y + Math.sin(bot.th) * 2.5, goal: null };
    if (A.goal) { tx = A.goal.mx; ty = A.goal.my; tz = GH - 0.02; }
    else {
      tx = clamp(A.x, BR, N - BR); ty = clamp(A.y, BR, N - BR); tz = 0;
      var dx = tx - m[0], dy = ty - m[1], dd = Math.hypot(dx, dy);
      if (dd > RANGE) { tx = m[0] + dx / dd * RANGE; ty = m[1] + dy / dd * RANGE; }
    }
    var d = Math.hypot(tx - m[0], ty - m[1]), T = 0.45 + d * 0.13;
    return { x: m[0], y: m[1], z: m[2], vx: (tx - m[0]) / T, vy: (ty - m[1]) / T, vz: (tz - m[2] + 0.5 * G * T * T) / T, T: T, goal: A.goal, tx: tx, ty: ty, tz: tz };
  }
  function shoot() {
    if (state !== 'on' && state !== 'entering') return;
    if (cool > 0) return;
    if (!bot.held.length) { flashHint('empty: drive into an artifact to pick it up'); return; }
    var q = plan(aimPoint()), j = 1 + (Math.random() - 0.5) * 0.03;
    balls.push({ x: q.x, y: q.y, z: q.z, pz: q.z, vx: q.vx * j, vy: q.vy * j, vz: q.vz, c: bot.held.shift(), st: 'air', shot: true, spin: 0, t: 0 });
    cool = 0.28;
    bot.idxT += TAU / 3;
    var a = Math.atan2(q.vy, q.vx);
    bot.vx -= Math.cos(a) * 0.5; bot.vy -= Math.sin(a) * 0.5;
    var f = fluid();
    if (f) {
      var p0 = P(q.x, q.y, q.z), p1 = P(q.x + q.vx * 0.05, q.y + q.vy * 0.05, q.z + q.vz * 0.05);
      f.gust(p0[0], p0[1], (p1[0] - p0[0]) * 0.9, (p1[1] - p0[1]) * 0.9, 60);
    }
    updateHeld();
  }

  /* ---------- balls ---------- */

  function spawn(z, delay) {
    for (var tries = 0; tries < 30; tries++) {
      var x = 0.5 + Math.random() * (N - 1), y = 0.5 + Math.random() * (N - 1), ok = true;
      for (var i = 0; i < GOALS.length; i++) if (goalOut(GOALS[i], x, y) < 0.6) ok = false;
      if (bot && Math.hypot(x - bot.x, y - bot.y) < 1.3) ok = false;
      balls.forEach(function (b) { if (Math.hypot(b.x - x, b.y - y) < 0.45) ok = false; });
      if (!ok) continue;
      balls.push({ x: x, y: y, z: z === undefined ? 1.7 : z, pz: 0, vx: 0, vy: 0, vz: 0, c: Math.random() < 0.34 ? 1 : 0,
        st: 'air', shot: false, spin: Math.random() * 6, t: 0, delay: delay || 0 });
      return;
    }
  }
  function scoreGoal(b, g) {
    b.st = 'in'; b.t = 0; b.x = clamp(b.x, 0, N); b.y = clamp(b.y, 0, N);
    score++;
    if (score > best) { best = score; store(BEST_KEY, String(best)); }
    g.flash = 1;
    popups.push({ x: g.mx, y: g.my, z: GH + 0.2, t: 0, text: '+1' });
    var f = fluid(), q = P(g.mx, g.my, GH);
    if (f) f.burst(q[0], q[1], 16);
    hud.n.textContent = pad2(score);
    hud.best.textContent = 'best ' + pad2(best);
    hud.n.classList.remove('is-bump'); void hud.n.offsetWidth; hud.n.classList.add('is-bump');
    hud.live.textContent = 'Scored. ' + score + (score === 1 ? ' artifact' : ' artifacts') + ' in the goal.';
  }
  function wallBounce(b) {
    if (b.z > WALL) return;
    if (b.x < BR) { b.x = BR; b.vx = Math.abs(b.vx) * 0.55; }
    if (b.x > N - BR) { b.x = N - BR; b.vx = -Math.abs(b.vx) * 0.55; }
    if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy) * 0.55; }
    if (b.y > N - BR) { b.y = N - BR; b.vy = -Math.abs(b.vy) * 0.55; }
  }
  function goalBounce(b) {
    for (var i = 0; i < GOALS.length; i++) {
      var g = GOALS[i], d = goalOut(g, b.x, b.y);
      if (d < BR && b.z < GH) {
        var nx = g.sx / R2, ny = g.sy / R2, push = BR - d, vn = b.vx * nx + b.vy * ny;
        b.x += nx * push; b.y += ny * push;
        if (vn < 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; }
      }
    }
  }

  /* ---------- simulation ---------- */

  function fmt(sec) { return Math.floor(sec / 60) + ':' + pad2(sec % 60); }
  function update(dt) {
    clock += dt;
    cool = Math.max(0, cool - dt);
    if (state === 'on') {
      // wall clock: the match lasts MATCH seconds however the frames arrive
      timeLeft = Math.max(0, (matchEnd - performance.now()) / 1000);
      var sec = Math.ceil(timeLeft);
      if (sec !== lastSec) {
        lastSec = sec;
        hud.time.textContent = fmt(sec);
        hud.time.classList.toggle('is-low', sec <= 10 && sec > 0);
      }
      if (timeLeft <= 0) endMatch();
    } else if (state === 'over') {
      if (performance.now() - overT > 900 && hud.over.hidden) showResults();
    }
    var driving = state === 'on' || state === 'entering';

    // drive input in screen space -> floor direction
    var mx = 0, my = 0;
    if (driving) {
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyS || keys.ArrowDown) my += 1;
      if (keys.KeyW || keys.ArrowUp) my -= 1;
      mx += stick.x; my += stick.y;
    }
    var ml = Math.min(1, Math.hypot(mx, my)), wd = ml > 0.05 ? screenDir(mx, my) : [0, 0];
    var k = 1 - Math.exp(-dt * 7);
    bot.vx += (wd[0] * ml * VMAX - bot.vx) * k;
    bot.vy += (wd[1] * ml * VMAX - bot.vy) * k;
    bot.x += bot.vx * dt; bot.y += bot.vy * dt;
    GOALS.forEach(function (g) {
      var d = goalOut(g, bot.x, bot.y);
      if (d < RR) { bot.x += g.sx / R2 * (RR - d); bot.y += g.sy / R2 * (RR - d); }
    });
    if (bot.x < RR) { bot.x = RR; bot.vx = Math.max(0, bot.vx); }
    if (bot.x > N - RR) { bot.x = N - RR; bot.vx = Math.min(0, bot.vx); }
    if (bot.y < RR) { bot.y = RR; bot.vy = Math.max(0, bot.vy); }
    if (bot.y > N - RR) { bot.y = N - RR; bot.vy = Math.min(0, bot.vy); }
    var sp = Math.hypot(bot.vx, bot.vy);
    if (sp > 0.3 && ml > 0.05) bot.th += clamp(angDiff(bot.th, Math.atan2(bot.vy, bot.vx)), -dt * 7, dt * 7);
    bot.spin += sp * dt * 5;
    bot.flap += dt * (bot.held.length < CAP ? 8 : 1.5);
    bot.idx += (bot.idxT - bot.idx) * (1 - Math.exp(-dt * 10));
    var A = aimPoint();
    if (A) {
      var q0 = A.goal ? [A.goal.mx, A.goal.my] : [A.x, A.y];
      var want = angDiff(0, Math.atan2(q0[1] - bot.y, q0[0] - bot.x) - bot.th);
      bot.tur += angDiff(bot.tur, want) * (1 - Math.exp(-dt * 12));
    } else {
      bot.tur += angDiff(bot.tur, 0) * (1 - Math.exp(-dt * 4));
    }

    // wake in the ASCII field behind the robot
    var f = fluid();
    gustT -= dt;
    if (f && sp > 0.25 && gustT <= 0) {
      gustT = 0.03;
      var pr = P(bot.x, bot.y, 0.15);
      f.gust(pr[0], pr[1], (bot.vx - bot.vy) * C * s / 60 * 0.9, -(bot.vx + bot.vy) * S * s / 60 * 0.9, Math.max(36, s * 0.45));
    }

    // artifacts
    var intaking = 0;
    balls.forEach(function (b) { if (b.st === 'intake') intaking++; });
    var c = Math.cos(bot.th), sn = Math.sin(bot.th);
    for (var i = 0; i < balls.length; i++) {
      var b = balls[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      if (b.st === 'air') {
        b.pz = b.z;
        b.vz -= G * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        b.spin += dt * 9;
        for (var gi = 0; gi < GOALS.length; gi++) {
          if (b.pz >= GH && b.z < GH && b.vz < 0 && inGoal(GOALS[gi], b.x, b.y, BR * 0.4)) { scoreGoal(b, GOALS[gi]); break; }
        }
        if (b.st !== 'air') continue;
        wallBounce(b); goalBounce(b);
        if (b.shot && f && Math.random() < 0.5) {
          var pb = P(b.x, b.y, b.z);
          f.gust(pb[0], pb[1], (b.vx - b.vy) * C * s / 60 * 0.25, (-(b.vx + b.vy) * S - b.vz) * s / 60 * 0.25, 30);
        }
        if (b.z <= 0) {
          b.z = 0;
          if (b.vz < -1.5) {
            if (f && b.vz < -4) { var pl = P(b.x, b.y, 0); f.burst(pl[0], pl[1], b.shot ? 6 : 4); }
            b.vz = -b.vz * 0.42; b.vx *= 0.75; b.vy *= 0.75;
          } else { b.vz = 0; b.st = 'ground'; b.shot = false; }
        }
        if (b.x < -2 || b.x > N + 2 || b.y < -2 || b.y > N + 2) b.dead = true;
      } else if (b.st === 'ground') {
        var fr = Math.exp(-dt * 1.8);
        b.vx *= fr; b.vy *= fr;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.spin += Math.hypot(b.vx, b.vy) * dt * 8;
        wallBounce(b); goalBounce(b);
      } else if (b.st === 'intake') {
        b.t += dt / 0.22;
        if (b.t >= 1) {
          b.dead = true; bot.held.push(b.c); updateHeld();
          if (!toldShoot) { toldShoot = true; flashHint(viaTouch ? 'got one: drag shoot toward a glowing goal, let go to fire' : 'got one: aim at a glowing goal, space or click to fire'); }
          if (f) { var pi = P(bot.x, bot.y, 0.3); f.gust(pi[0], pi[1], 0, -3, 40); }
        }
        continue;
      } else if (b.st === 'in') {
        b.t += dt;
        if (b.t > 1.1) b.dead = true;
        continue;
      }
      // the robot: the intake picks up, the rest of the chassis pushes
      if (b.z < 0.3) {
        var dx = b.x - bot.x, dy = b.y - bot.y, d = Math.hypot(dx, dy);
        if (d < RR + BR + 0.1) {
          var fw = dx * c + dy * sn, lat = dx * sn - dy * c;
          if (bot.held.length + intaking < CAP && fw > 0.12 && Math.abs(lat) < 0.3) {
            b.st = 'intake'; b.t = 0; b.fx = b.x; b.fy = b.y; b.fz = b.z; intaking++;
            continue;
          }
          if (d < RR + BR) {
            var nx = dx / (d || 1), ny = dy / (d || 1);
            b.x = bot.x + nx * (RR + BR); b.y = bot.y + ny * (RR + BR);
            var rel = bot.vx * nx + bot.vy * ny, bv = b.vx * nx + b.vy * ny;
            if (bv < rel) { b.vx += (rel - bv) * 1.25 * nx; b.vy += (rel - bv) * 1.25 * ny; }
            if (b.st === 'ground') b.vz = 0;
          }
        }
      }
    }
    // artifacts on the floor bump into each other
    for (var a1 = 0; a1 < balls.length; a1++) {
      var p = balls[a1];
      if (p.st !== 'ground' || p.delay > 0) continue;
      for (var a2 = a1 + 1; a2 < balls.length; a2++) {
        var q = balls[a2];
        if (q.st !== 'ground' || q.delay > 0) continue;
        var ex = q.x - p.x, ey = q.y - p.y, ed = Math.hypot(ex, ey);
        if (ed > 0 && ed < BR * 2) {
          var ux = ex / ed, uy = ey / ed, o = (BR * 2 - ed) / 2;
          p.x -= ux * o; p.y -= uy * o; q.x += ux * o; q.y += uy * o;
          var rv = (q.vx - p.vx) * ux + (q.vy - p.vy) * uy;
          if (rv < 0) { p.vx += rv * ux * 0.9; p.vy += rv * uy * 0.9; q.vx -= rv * ux * 0.9; q.vy -= rv * uy * 0.9; }
        }
      }
    }
    balls = balls.filter(function (b) { return !b.dead; });

    // keep the field stocked
    spawnT -= dt;
    var live = bot.held.length;
    balls.forEach(function (b) { if (b.st === 'air' || b.st === 'ground' || b.st === 'intake') live++; });
    if (driving && live < MAXB && spawnT <= 0) { spawn(); spawnT = 1.1 + Math.random() * 0.9; }

    GOALS.forEach(function (g) { g.flash = Math.max(0, g.flash - dt * 1.6); });
    popups.forEach(function (pp) { pp.t += dt; });
    popups = popups.filter(function (pp) { return pp.t < 1.1; });

    if (hintT > 0) { hintT -= dt; if (hintT <= 0) hud.hint.classList.add('is-gone'); }

    if (state === 'outro') {
      outroT = (performance.now() - outroAt) / 1000;
      var ko = easeInOut(outroT / 1.25);
      s = sBase * (1 - 0.42 * ko);
      fade = 1 - 0.65 * ko;
      bot.th += angDiff(bot.th, Math.PI / 4) * (1 - Math.exp(-dt * 5));
      offX = offY = 0;
      camera(dt);
      var rp = P(bot.x, bot.y, 0.25);
      offX = (outroTo[0] - rp[0]) * ko; offY = (outroTo[1] - rp[1]) * ko;
      ox += offX; oy += offY;
      if (outroT >= 1.35) pulseOut();
    } else {
      var e = easeInOut((clock - 0.15) / 1.1);
      offX = off0[0] * (1 - e); offY = off0[1] * (1 - e);
      camera(dt);
    }
  }

  /* ---------- drawing ---------- */

  function path(pts, close) {
    var q = P(pts[0][0], pts[0][1], pts[0][2]);
    ctx.moveTo(q[0], q[1]);
    for (var i = 1; i < pts.length; i++) { q = P(pts[i][0], pts[i][1], pts[i][2]); ctx.lineTo(q[0], q[1]); }
    if (close) ctx.closePath();
  }
  function seg(a, b) { path([a, b]); }

  function drawFloor(p, lw) {
    ctx.beginPath(); path([[0, 0, 0], [N, 0, 0], [N, N, 0], [0, N, 0]], true);
    ctx.fillStyle = rgba(p.bg, p.light ? 0.62 : 0.66); ctx.fill();
    // tile seams
    ctx.beginPath();
    for (var i = 1; i < N; i++) { seg([i, 0, 0], [i, N, 0]); seg([0, i, 0], [N, i, 0]); }
    ctx.strokeStyle = rgba(p.ink, p.light ? 0.16 : 0.13); ctx.lineWidth = lw; ctx.stroke();
    // tape: a launch line in front of each goal, a centre cross and the start box
    ctx.beginPath();
    GOALS.forEach(function (g) {
      // parallel to the goal's open face, 0.55 tiles out, running wall to wall
      var o = 0.55, nx = g.sx / R2 * o, ny = g.sy / R2 * o;
      var dx = (g.v[2][0] - g.v[1][0]) / (GL * R2), dy = (g.v[2][1] - g.v[1][1]) / (GL * R2);
      seg([g.v[1][0] + nx - dx * o, g.v[1][1] + ny - dy * o, 0], [g.v[2][0] + nx + dx * o, g.v[2][1] + ny + dy * o, 0]);
    });
    path([[N / 2 - 0.3, N / 2 - 0.3, 0], [N / 2 + 0.3, N / 2 - 0.3, 0], [N / 2 + 0.3, N / 2 + 0.3, 0], [N / 2 - 0.3, N / 2 + 0.3, 0]], true);
    path([[0, 1.5, 0], [1.5, 1.5, 0], [1.5, 0, 0]]);
    ctx.strokeStyle = rgba(p.ink, p.light ? 0.42 : 0.36); ctx.lineWidth = lw * 1.6; ctx.stroke();
    ctx.font = Math.round(clamp(s * 0.1, 9, 11)) + 'px ' + MONO;
    ctx.fillStyle = rgba(p.ink, 0.4); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var st = P(0.75, 0.75, 0); ctx.fillText('start', st[0], st[1]);
  }
  function drawWalls(p, lw, near) {
    ctx.beginPath();
    var edges = near ? [[[0, 0], [N, 0]], [[0, 0], [0, N]]] : [[[0, N], [N, N]], [[N, 0], [N, N]]];
    edges.forEach(function (e) {
      seg([e[0][0], e[0][1], 0], [e[1][0], e[1][1], 0]);
      seg([e[0][0], e[0][1], WALL], [e[1][0], e[1][1], WALL]);
      for (var i = 0; i <= N; i++) {
        var x = e[0][0] + (e[1][0] - e[0][0]) * i / N, y = e[0][1] + (e[1][1] - e[0][1]) * i / N;
        seg([x, y, 0], [x, y, WALL]);
      }
    });
    ctx.strokeStyle = rgba(p.ink, near ? 0.4 : 0.55); ctx.lineWidth = lw; ctx.stroke();
  }
  function drawGoal(g, p, lw) {
    var v = g.v;
    ctx.beginPath();
    path([[v[0][0], v[0][1], 0], [v[1][0], v[1][1], 0], [v[2][0], v[2][1], 0]], true);
    v.forEach(function (q) { seg([q[0], q[1], 0], [q[0], q[1], GH]); });
    // mesh on the two wall faces
    [1, 2].forEach(function (k) {
      for (var i = 1; i < 5; i++) {
        var x = v[0][0] + (v[k][0] - v[0][0]) * i / 5, y = v[0][1] + (v[k][1] - v[0][1]) * i / 5;
        seg([x, y, 0], [x, y, GH]);
      }
      [GH / 3, GH * 2 / 3].forEach(function (z) { seg([v[0][0], v[0][1], z], [v[k][0], v[k][1], z]); });
    });
    ctx.strokeStyle = rgba(p.ink, 0.5); ctx.lineWidth = lw; ctx.stroke();
    // the opening: glows and pulses while the robot has something to shoot
    var armed = bot.held.length > 0 && (state === 'on' || state === 'entering');
    var beat = 0.5 + 0.5 * Math.sin(clock * 4.2);
    ctx.beginPath();
    path([[v[0][0], v[0][1], GH], [v[1][0], v[1][1], GH], [v[2][0], v[2][1], GH]], true);
    ctx.fillStyle = rgba(p.purple, (armed ? 0.12 + 0.14 * beat : 0.06) + g.flash * 0.3); ctx.fill();
    ctx.strokeStyle = g.flash > 0 ? rgba(p.purple, 0.5 + 0.5 * g.flash) : armed ? rgba(p.purple, 0.6 + 0.35 * beat) : rgba(p.ink, 0.85);
    ctx.lineWidth = lw * (1.6 + g.flash * 1.6 + (armed ? 0.6 : 0)); ctx.stroke();
    // chevrons dropping into the opening: where the ball goes
    var w = clamp(0.13 * s, 7, 16);
    ctx.lineWidth = lw * 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var k = 0; k < 3; k++) {
      var ph = (clock * 0.8 + k / 3) % 1, q = P(g.mx, g.my, GH + 1.0 - ph * 0.8);
      var a = Math.sin(Math.PI * ph) * (armed ? 0.95 : 0.4);
      ctx.beginPath();
      ctx.moveTo(q[0] - w, q[1] - w * 0.6); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0] + w, q[1] - w * 0.6);
      ctx.strokeStyle = armed ? rgba(p.purple, a) : rgba(p.ink, a); ctx.stroke();
    }
    var t = P(g.mx, g.my, GH + 1.25);
    ctx.font = (armed ? '600 ' : '') + Math.round(clamp(s * 0.1, 10, 12)) + 'px ' + MONO;
    ctx.fillStyle = armed ? rgba(p.purple, 0.95) : rgba(p.ink, 0.6); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(armed ? 'shoot here' : 'goal', t[0], t[1]);
  }
  // when the field is bigger than the screen (phones), point at goals that are out of view
  function drawGoalArrows(p) {
    if (state !== 'on' && state !== 'entering') return;
    var armed = bot.held.length > 0, m = 30, top = 120, bottom = viaTouch ? 200 : 60;
    GOALS.forEach(function (g) {
      var q = P(g.mx, g.my, GH);
      if (q[0] > m && q[0] < W - m && q[1] > top && q[1] < H - bottom) return;
      var x = clamp(q[0], m, W - m), y = clamp(q[1], top, H - bottom);
      var a = Math.atan2(q[1] - y, q[0] - x);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.closePath();
      ctx.fillStyle = armed ? rgba(p.purple, 0.95) : rgba(p.ink, 0.7); ctx.fill();
      ctx.restore();
      ctx.font = '11px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = armed ? rgba(p.purple, 0.95) : rgba(p.ink, 0.7);
      ctx.fillText('goal', x - Math.cos(a) * 24, y - Math.sin(a) * 18);
    });
  }
  function drawShadow(x, y, z, r, p, a) {
    var q = P(x, y, 0), k = 1 / (1 + z * 0.7);
    ctx.beginPath();
    ctx.ellipse(q[0], q[1], r * s * 1.22 * k, r * s * 0.7 * k, 0, 0, TAU);
    ctx.fillStyle = rgba(p.ink, a * k); ctx.fill();
  }
  function drawBall(x, y, z, col, spin, p, alpha, scale) {
    var c = col ? p.green : p.purple, q = P(x, y, z + BR), r = BR * s * (scale || 1);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU);
    ctx.fillStyle = rgba(c, 0.3 * alpha); ctx.fill();
    ctx.strokeStyle = rgba(c, 0.95 * alpha); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q[0], q[1], r * Math.abs(Math.cos(spin)), r, 0, 0, TAU);
    ctx.strokeStyle = rgba(c, 0.55 * alpha); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(q[0], q[1], r, r * 0.34, 0, 0, TAU); ctx.stroke();
  }
  function drawBot(p, lw) {
    var xf = botXf(bot);
    // footprint shadow
    ctx.beginPath();
    path([[-0.62, 0, -0.74], [0.62, 0, -0.74], [0.62, 0, 0.52], [-0.62, 0, 0.52]].map(function (v) { var w = xf(v); w[2] = 0; return w; }), true);
    ctx.fillStyle = rgba(p.ink, p.light ? 0.1 : 0.08); ctx.fill();
    var g = K.models.ftc(clock, { game: true, spin: bot.spin, flap: bot.flap, index: bot.idx, turret: bot.tur });
    var Q = g.v.map(function (v) { var w = xf(v); return P(w[0], w[1], w[2]); });
    ctx.beginPath();
    for (var e = 0; e < g.e.length; e++) {
      var a = Q[g.e[e][0]], b = Q[g.e[e][1]];
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.strokeStyle = rgba(p.ink, 0.9); ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.stroke();
    for (var k = 0; k < bot.held.length; k++) {
      var w = pocket(k);
      drawBall(w[0], w[1], w[2] - BR * 0.8, bot.held[k], clock * 2, p, 1, 0.8);
    }
  }
  function drawAim(p, lw) {
    var A = aimPoint();
    if (!A || state === 'leaving') return;
    var have = bot.held.length > 0, q = plan(A);
    // predicted arc
    if (have) {
      ctx.fillStyle = rgba(p.ink, 0.55);
      for (var i = 1; i < 22; i++) {
        var t = q.T * i / 22;
        var pt = P(q.x + q.vx * t, q.y + q.vy * t, q.z + q.vz * t - 0.5 * G * t * t);
        ctx.fillRect(pt[0] - 1, pt[1] - 1, 2, 2);
      }
    }
    var c = q.goal ? p.purple : p.ink, a = have ? 0.9 : 0.35;
    var r = P(q.tx, q.ty, q.tz);
    ctx.beginPath();
    ctx.ellipse(r[0], r[1], 0.2 * s * 1.22, 0.2 * s * 0.7, 0, 0, TAU);
    ctx.moveTo(r[0] - 0.34 * s, r[1]); ctx.lineTo(r[0] - 0.12 * s, r[1]);
    ctx.moveTo(r[0] + 0.12 * s, r[1]); ctx.lineTo(r[0] + 0.34 * s, r[1]);
    ctx.strokeStyle = rgba(c, a); ctx.lineWidth = lw * 1.3; ctx.stroke();
    if (q.goal && have) {
      ctx.font = '11px ' + MONO; ctx.fillStyle = rgba(p.purple, 0.95); ctx.textAlign = 'center';
      ctx.fillText('in', r[0], r[1] - 0.3 * s);
    }
  }
  var sprites = { key: '', map: {} };
  function sprite(ch, a, p) {
    var key = (p.light ? 'l' : 'd') + dpr;
    if (sprites.key !== key) sprites = { key: key, map: {} };
    var id = ch + a, g = sprites.map[id];
    if (!g) {
      g = document.createElement('canvas');
      g.width = Math.ceil(10 * dpr); g.height = Math.ceil(16 * dpr);
      var x = g.getContext('2d');
      x.font = Math.round(12 * dpr) + 'px ' + MONO; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = rgba(p.ink, a); x.fillText(ch, g.width / 2, g.height / 2);
      sprites.map[id] = g;
    }
    return g;
  }
  // the pulse front: rows of glyphs just inside the circle (the outer row only shows without view transitions)
  var ROWS = [[10, '.·:', 0.35], [-2, '#%@', 0.95], [-15, '*+=', 0.7], [-29, ':-~', 0.45], [-44, '.·:', 0.25]];
  function drawRing(p) {
    var R = pulseR;
    if (R <= 1) return;
    var tick = Math.floor(clock * 30);
    for (var r = vtMode ? 1 : 0; r < ROWS.length; r++) {
      var rr = R + ROWS[r][0];
      if (rr <= 2) continue;
      var n = Math.max(6, Math.floor(TAU * rr / 13)), chars = ROWS[r][1];
      var sp = [sprite(chars[0], ROWS[r][2], p), sprite(chars[1], ROWS[r][2], p), sprite(chars[2], ROWS[r][2], p)];
      for (var i = 0; i < n; i++) {
        var a = (i + r * 0.5) / n * TAU;
        var x = pulseX + Math.cos(a) * rr, y = pulseY + Math.sin(a) * rr;
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
        ctx.drawImage(sp[(i * 7 + tick + r) % 3], x - 5, y - 8, 10, 16);
      }
    }
  }
  function draw() {
    var p = palette(), lw = clamp(s / 105, 0.8, 1.4);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var masked = !vtMode && (state === 'entering' || state === 'leaving');
    if (masked) { ctx.save(); ctx.beginPath(); ctx.arc(pulseX, pulseY, Math.max(0, pulseR), 0, TAU); ctx.clip(); }
    ctx.globalAlpha = fade;
    drawFloor(p, lw);
    drawWalls(p, lw, false);
    balls.forEach(function (b) {
      if (b.delay > 0 || b.st === 'in' || b.st === 'intake') return;
      drawShadow(b.x, b.y, b.z, BR, p, p.light ? 0.22 : 0.3);
    });
    // far to near
    var items = [];
    GOALS.forEach(function (g) { items.push({ d: g.mx + g.my + 0.6, f: function () { drawGoal(g, p, lw); } }); });
    items.push({ d: bot.x + bot.y, f: function () { ctx.globalAlpha = 1; drawBot(p, lw); ctx.globalAlpha = fade; } });
    balls.forEach(function (b) {
      if (b.delay > 0) return;
      var d = b.x + b.y, fn;
      if (b.st === 'intake') {
        var w = pocket(Math.min(CAP - 1, bot.held.length)), k = easeInOut(b.t);
        fn = function () {
          drawBall(b.fx + (w[0] - b.fx) * k, b.fy + (w[1] - b.fy) * k, b.fz + (w[2] - BR - b.fz) * k, b.c, b.spin, p, 1, 1 - 0.2 * k);
        };
        d = bot.x + bot.y + 0.01;
      } else if (b.st === 'in') {
        fn = function () { drawBall(b.x, b.y, Math.max(0.05, GH - b.t * b.t * 3), b.c, b.spin, p, 1 - easeInOut((b.t - 0.6) / 0.5), 1); };
      } else {
        fn = function () { drawBall(b.x, b.y, b.z, b.c, b.spin, p, 1, 1); };
      }
      items.push({ d: d, f: fn });
    });
    items.sort(function (a, b) { return b.d - a.d; });
    items.forEach(function (it) { it.f(); });
    drawWalls(p, lw, true);
    drawAim(p, lw);
    drawGoalArrows(p);
    popups.forEach(function (pp) {
      var q = P(pp.x, pp.y, pp.z + pp.t * 0.7);
      ctx.font = '600 ' + Math.round(clamp(s * 0.2, 14, 22)) + 'px ' + MONO;
      ctx.fillStyle = rgba(p.purple, 1 - easeInOut((pp.t - 0.5) / 0.6));
      ctx.textAlign = 'center'; ctx.fillText(pp.text, q[0], q[1]);
    });
    ctx.globalAlpha = 1;
    if (masked) ctx.restore();
    if (state === 'entering' || (state === 'leaving' && !vtMode)) drawRing(p);
  }

  /* ---------- page takeover ---------- */

  var CLIP = 'body > .bar, body > main, body > .foot, body > .edge, body > .skip';
  function cacheRects() {
    rects = clipped.map(function (el) { var b = el.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; });
  }
  function clipContent(cx, cy, r) {
    clipped.forEach(function (el, i) {
      var b = rects[i], x = cx - b.left, y = cy - b.top;
      var d = 'M-2 -2H' + (b.width + 2) + 'V' + (b.height + 2) + 'H-2Z';
      if (r > 0.5) {
        d += 'M' + (x - r).toFixed(1) + ' ' + y.toFixed(1) +
          'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (2 * r).toFixed(1) + ' 0' +
          'a' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 1 0 ' + (-2 * r).toFixed(1) + ' 0Z';
      }
      el.style.clipPath = 'path(evenodd, "' + d + '")';
    });
  }
  function unclip() { clipped.forEach(function (el) { el.style.clipPath = ''; }); }

  function ringGusts() {
    var f = fluid();
    if (!f || pulseR < 20) return;
    ringPush(f, pulseR, 7, 14);
  }
  function ringPush(f, R, k, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, x = pulseX + Math.cos(a) * R, y = pulseY + Math.sin(a) * R;
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      f.gust(x, y, Math.cos(a) * k, Math.sin(a) * k, 60);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.033, (now - last) / 1000) : 0.016;
    last = now;
    if (state === 'entering') {
      if (!vtMode || vtReady) pulse += dt / pulseDur;
      pulseR = maxR * easeOut(pulse);
      if (!vtMode) clipContent(pulseX, pulseY, pulseR);
      if (!reduce.matches) ringGusts();
      if (pulse >= 1) toOn();
    } else if (state === 'leaving') {
      pulse += dt / pulseDur;
      pulseR = maxR * (1 - easeInOut(pulse));
      clipContent(pulseX, pulseY, pulseR);
      if (pulse >= 1) { finish(); return; }
    }
    update(dt);
    draw();
  }

  function build() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'game';
    layer.hidden = true;
    layer.tabIndex = -1;
    layer.setAttribute('role', 'application');
    layer.setAttribute('aria-roledescription', 'game');
    layer.setAttribute('aria-label', 'FTC drive mode. W A S D or arrow keys drive the robot, drive into artifacts to collect them, aim with the pointer, space or click shoots, escape exits.');
    layer.innerHTML =
      '<canvas class="game__cv" aria-hidden="true"></canvas>' +
      '<div class="game__hud">' +
        '<p class="game__id"><span>FTC 27308</span><span>drive mode</span></p>' +
        '<p class="game__score"><span class="game__n">00</span><span class="game__meta"><span class="game__time">1:00</span><span class="game__best">best 00</span></span></p>' +
        '<button class="action game__exit" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg><span>exit</span><span class="tag game__key">esc</span></button>' +
        '<p class="game__held"><span>artifacts</span><i></i><i></i><i></i></p>' +
        '<p class="game__hint"></p>' +
        '<p class="sr-only" aria-live="polite"></p>' +
      '</div>' +
      '<div class="game__over" role="dialog" aria-labelledby="game-over-title" hidden>' +
        '<p class="game__over-k" id="game-over-title">match over</p>' +
        '<p class="game__over-n">00</p>' +
        '<p class="game__over-l">artifacts scored</p>' +
        '<p class="game__over-b">best 00</p>' +
        '<button class="action game__close" type="button"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg><span>close</span></button>' +
      '</div>' +
      '<div class="game__pad">' +
        '<div class="game__stick" aria-hidden="true"><i></i></div>' +
        '<button class="game__fire" type="button" aria-label="Shoot: drag to aim, release to fire"><span>shoot</span><small>drag · release</small></button>' +
      '</div>';
    document.body.appendChild(layer);
    cv = layer.querySelector('.game__cv');
    ctx = cv.getContext('2d');
    hud.n = layer.querySelector('.game__n');
    hud.best = layer.querySelector('.game__best');
    hud.held = Array.prototype.slice.call(layer.querySelectorAll('.game__held i'));
    hud.hint = layer.querySelector('.game__hint');
    hud.live = layer.querySelector('[aria-live]');
    hud.time = layer.querySelector('.game__time');
    hud.over = layer.querySelector('.game__over');
    hud.overN = layer.querySelector('.game__over-n');
    hud.overB = layer.querySelector('.game__over-b');
    hud.close = layer.querySelector('.game__close');
    hud.close.addEventListener('click', startOutro);
    stickEl = layer.querySelector('.game__stick');
    knob = stickEl.querySelector('i');
    fireEl = layer.querySelector('.game__fire');

    layer.querySelector('.game__exit').addEventListener('click', startOutro);
    cv.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      aim.sx = e.clientX; aim.sy = e.clientY; aim.have = true;
    });
    cv.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      aim.sx = e.clientX; aim.sy = e.clientY; aim.have = true;
      shoot();
    });
    layer.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });
    layer.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });

    // joystick
    var sid = null, sc = [0, 0];
    function moveStick(e) {
      var dx = e.clientX - sc[0], dy = e.clientY - sc[1], R = 48, l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      var m = Math.hypot(dx, dy) / R;
      stick.x = m > 0.14 ? dx / R : 0; stick.y = m > 0.14 ? dy / R : 0;
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function endStick() { sid = null; stick.x = stick.y = 0; knob.style.transform = ''; stickEl.classList.remove('is-active'); }
    stickEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      sid = e.pointerId; try { stickEl.setPointerCapture(sid); } catch (err) {}
      var r = stickEl.getBoundingClientRect(); sc = [r.left + r.width / 2, r.top + r.height / 2];
      stickEl.classList.add('is-active');
      moveStick(e);
    });
    stickEl.addEventListener('pointermove', function (e) { if (e.pointerId === sid) moveStick(e); });
    stickEl.addEventListener('pointerup', endStick);
    stickEl.addEventListener('pointercancel', endStick);

    // drag-to-aim shoot button
    var fid = null, fc = [0, 0];
    fireEl.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      fid = e.pointerId; try { fireEl.setPointerCapture(fid); } catch (err) {}
      var r = fireEl.getBoundingClientRect(); fc = [r.left + r.width / 2, r.top + r.height / 2];
      touchAim = { dx: 0, dy: 0, active: false };
      fireEl.classList.add('is-aiming');
    });
    fireEl.addEventListener('pointermove', function (e) {
      if (e.pointerId !== fid || !touchAim) return;
      touchAim.dx = e.clientX - fc[0]; touchAim.dy = e.clientY - fc[1];
      touchAim.active = Math.hypot(touchAim.dx, touchAim.dy) > 16;
    });
    fireEl.addEventListener('pointerup', function (e) {
      if (e.pointerId !== fid) return;
      fid = null; fireEl.classList.remove('is-aiming');
      if (touchAim && touchAim.active) shoot();
      else flashHint('drag from shoot toward where it should land, then let go');
      touchAim = null;
    });
    fireEl.addEventListener('pointercancel', function () { fid = null; touchAim = null; fireEl.classList.remove('is-aiming'); });
    fireEl.addEventListener('click', function (e) {
      // keyboard activation of the button: shoot where the robot is facing
      if (e.detail === 0) shoot();
    });

    window.addEventListener('resize', function () { if (state !== 'off') { layout(); camera(0); } });
  }

  function flashHint(text) {
    hud.hint.textContent = text;
    hud.hint.classList.remove('is-gone');
    hintT = 3.2;
  }
  function updateHeld() {
    hud.held.forEach(function (el, i) {
      var c = bot.held[i];
      el.className = c === undefined ? '' : c ? 'is-green' : 'is-purple';
    });
  }

  function reset() {
    bot = newBot();
    balls = []; popups = []; score = 0; cool = 0; spawnT = 2.2; touchAim = null;
    best = parseInt(store(BEST_KEY) || '0', 10) || 0;
    for (var i = 0; i < 6; i++) spawn(1.6 + i * 0.15, 0.35 + i * 0.12);
    hud.n.textContent = '00';
    hud.best.textContent = 'best ' + pad2(best);
    GOALS.forEach(function (g) { g.flash = 0; });
    bestBefore = best; toldShoot = false;
    timeLeft = MATCH; lastSec = -1; overT = 0; outroT = 0; fade = 1;
    hud.time.textContent = fmt(MATCH);
    hud.time.classList.remove('is-low');
    hud.over.hidden = true;
    layer.classList.remove('is-done');
    updateHeld();
  }

  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function enter(touch) {
    if (state !== 'off') return;
    if (document.querySelector('dialog[open]')) return;
    build();
    viaTouch = !!touch;
    prevFocus = document.activeElement;
    state = 'scrolling';
    var target = document.querySelector('.piece--d .piece__media') || document.querySelector('.piece--d');
    var y = window.scrollY;
    if (target) {
      var r = target.getBoundingClientRect();
      y = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
      y = clamp(y, 0, Math.max(0, root.scrollHeight - window.innerHeight));
    }
    window.scrollTo({ top: y, behavior: reduce.matches ? 'auto' : 'smooth' });
    var t0 = performance.now(), still = 0, lastY = -1;
    (function wait(now) {
      var sy = window.scrollY;
      still = Math.abs(sy - lastY) < 0.5 ? still + 1 : 0;
      lastY = sy;
      if (Math.abs(sy - y) < 2 || still > 6 || now - t0 > 1600) { begin(target ? target.getBoundingClientRect() : null); return; }
      requestAnimationFrame(wait);
    })(t0);
  }

  function begin(rect) {
    state = 'entering';
    clock = 0; pulse = 0; pulseR = 0;
    pulseDur = reduce.matches ? 0.001 : 1.15;
    layer.classList.toggle('is-touch', viaTouch);
    layer.classList.remove('is-on');
    layout();
    reset();
    camX = follow ? bot.x : N / 2; camY = follow ? bot.y : N / 2;
    offX = offY = 0; camera(0);
    pulseX = rect ? rect.left + rect.width / 2 : W / 2;
    pulseY = rect ? rect.top + rect.height / 2 : H / 2;
    var b = P(bot.x, bot.y, 0.25);
    off0 = [pulseX - b[0], pulseY - b[1]];
    offX = off0[0]; offY = off0[1]; camera(0);
    maxR = Math.hypot(Math.max(pulseX, W - pulseX), Math.max(pulseY, H - pulseY)) + 60;
    clipped = Array.prototype.slice.call(document.querySelectorAll(CLIP));
    root.classList.add('game-run');
    flashHint(viaTouch ? 'stick to drive · pick up artifacts · drag shoot toward a goal, let go' : 'wasd to drive · pick up artifacts · aim at a goal · space or click to shoot');
    hintT = 6;
    var f = fluid();
    if (f) { f.setDim(0.9); f.burst(pulseX, pulseY, reduce.matches ? 6 : 24); }
    if (window.NCGG && window.NCGG.pauseMedia) window.NCGG.pauseMedia(true);
    last = 0;
    cancelAnimationFrame(raf);
    vtMode = canVT && !reduce.matches;
    vtReady = false;
    if (vtMode) {
      // the page is snapshotted once and the live field is revealed through a growing circle,
      // so nothing on the page repaints while the pulse runs
      var at = pulseX.toFixed(1) + 'px ' + pulseY.toFixed(1) + 'px';
      var vt = document.startViewTransition(function () {
        layer.hidden = false;
        root.classList.add('game-on');
        draw();
        focusLayer();
      });
      vt.ready.then(function () {
        vtReady = true;
        root.animate({ clipPath: ['circle(0px at ' + at + ')', 'circle(' + maxR.toFixed(0) + 'px at ' + at + ')'] },
          { duration: pulseDur * 1000, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', pseudoElement: '::view-transition-new(root)' });
      }, function () { vtReady = true; });
    } else {
      cacheRects();
      clipContent(pulseX, pulseY, 0);
      layer.hidden = false;
      focusLayer();
    }
    raf = requestAnimationFrame(frame);
  }
  function focusLayer() { try { layer.focus({ preventScroll: true }); } catch (e) { layer.focus(); } }

  function toOn() {
    state = 'on';
    root.classList.add('game-on');
    unclip();
    clipped.forEach(function (el) { el.inert = true; });
    layer.classList.add('is-on');
    timeLeft = MATCH; lastSec = -1;
    matchEnd = performance.now() + MATCH * 1000;
  }

  function endMatch() {
    state = 'over'; overT = performance.now();
    keys = {}; stick.x = stick.y = 0; touchAim = null;
    hud.time.textContent = fmt(0);
    hud.time.classList.remove('is-low');
    layer.classList.add('is-done');
    hud.live.textContent = 'Time. ' + score + (score === 1 ? ' artifact' : ' artifacts') + ' scored.';
  }
  function showResults() {
    hud.overN.textContent = pad2(score);
    hud.overB.textContent = score > bestBefore ? 'new best' : 'best ' + pad2(best);
    hud.overB.classList.toggle('is-best', score > bestBefore);
    hud.over.hidden = false;
    try { hud.close.focus({ preventScroll: true }); } catch (e) { hud.close.focus(); }
  }

  // close / esc / exit: zoom out and carry the robot back to its card, then fold the page back in
  function panelCenter() {
    var el = document.querySelector('.piece--d .piece__media');
    if (!el) return [W / 2, H / 2];
    var r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  function startOutro() {
    if (state !== 'on' && state !== 'entering' && state !== 'over') return;
    if (state === 'entering') toOn();
    state = 'outro'; outroT = 0; outroAt = performance.now();
    hud.over.hidden = true;
    layer.classList.remove('is-on');
    layer.classList.add('is-done');
    keys = {}; stick.x = stick.y = 0; touchAim = null;
    outroTo = panelCenter();
    if (reduce.matches) { pulseOut(); return; }
    focusLayer();
  }

  function pulseOut() {
    state = 'leaving'; pulse = 0;
    pulseX = clamp(outroTo[0], 0, W); pulseY = clamp(outroTo[1], 0, H);
    maxR = Math.hypot(Math.max(pulseX, W - pulseX), Math.max(pulseY, H - pulseY)) + 60;
    pulseR = maxR;
    pulseDur = 0.75;
    if (reduce.matches) { finish(); return; }
    if (vtMode) {
      // the field is snapshotted and shrinks into the card while the live page comes back underneath
      cancelAnimationFrame(raf); raf = 0;
      var at = pulseX.toFixed(1) + 'px ' + pulseY.toFixed(1) + 'px', R0 = maxR;
      root.classList.add('vt-out');
      var vt = document.startViewTransition(function () { teardown(); });
      vt.ready.then(function () {
        root.animate({ clipPath: ['circle(' + R0.toFixed(0) + 'px at ' + at + ')', 'circle(0px at ' + at + ')'] },
          { duration: 750, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-old(root)' });
        var f = fluid(), t0 = performance.now();
        (function push(now) {
          var k = (now - t0) / 750;
          if (!f || k >= 1) return;
          ringPush(f, R0 * (1 - easeInOut(k)), -6, 12);
          requestAnimationFrame(push);
        })(t0);
      }, function () {});
      vt.finished.then(function () { root.classList.remove('vt-out'); }, function () { root.classList.remove('vt-out'); });
      return;
    }
    cacheRects();
    clipContent(pulseX, pulseY, maxR);
    root.classList.remove('game-on');
  }

  function teardown() {
    cancelAnimationFrame(raf); raf = 0;
    state = 'off';
    layer.hidden = true;
    layer.classList.remove('is-on', 'is-done');
    unclip();
    clipped.forEach(function (el) { el.inert = false; });
    root.classList.remove('game-run', 'game-on');
    if (window.NCGG && window.NCGG.pauseMedia) window.NCGG.pauseMedia(false);
    window.dispatchEvent(new Event('scroll'));
    var back = driveBtn && document.body.contains(driveBtn) ? driveBtn : prevFocus;
    if (back && back.focus) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } }
  }
  function finish() { teardown(); }

  /* ---------- input ---------- */

  var DRIVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  window.addEventListener('keydown', function (e) {
    if (state === 'off') {
      if (!/^Key[WASD]$/.test(e.code) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      keys = {}; keys[e.code] = true;
      enter(false);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); startOutro(); return; }
    if (DRIVE[e.code]) { e.preventDefault(); keys[e.code] = true; return; }
    if (e.code === 'Space') {
      if (e.target && e.target.closest && e.target.closest('button')) return;
      e.preventDefault(); shoot(); return;
    }
    if (/^(PageUp|PageDown|Home|End)$/.test(e.key)) e.preventDefault();
  });
  window.addEventListener('keyup', function (e) { delete keys[e.code]; });
  // the clock stops while the tab is in the background
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt && state === 'on') { matchEnd += performance.now() - hiddenAt; hiddenAt = 0; }
  });
  window.addEventListener('blur', function () { keys = {}; });
  window.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || 'mouse'; }, true);

  driveBtn = document.querySelector('[data-drive]');
  if (driveBtn) {
    driveBtn.addEventListener('click', function () {
      enter(lastPointer === 'touch' || (lastPointer !== 'mouse' && coarseMQ.matches));
    });
  }
})();
