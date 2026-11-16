/*
 * AsciiField — a stable-fluids solver rendered as gray ASCII glyphs.
 * Velocity is stored in CSS pixels per frame on a grid of character cells.
 * The hero wordmark is a mask that the flow displaces and that springs back.
 */
(function () {
  'use strict';

  var RAMP = ['.', '·', ':', '-', '~', '=', '+', '*', 'x', '%', '#', '@'];
  var DIRS = ['-', '\\', '|', '/'];
  var GLYPHS = RAMP.concat(DIRS);
  var LEVELS = 14;
  var LUM_MIN = 0.16;
  var LUM_MAX = 0.86;

  function AsciiField(canvas, opts) {
    opts = opts || {};
    var self = this;
    var gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    } catch (e) { gl = null; }
    var ctx = gl ? null : canvas.getContext('2d', { alpha: false });
    var mctx = document.createElement('canvas').getContext('2d');
    var glr = null;
    var cells = null;

    var fontFamily = opts.fontFamily || 'monospace';
    var maskFont = opts.maskFont || 'sans-serif';
    var maskText = opts.maskText || '';
    var onStats = opts.onStats || function () {};
    var theme = opts.theme || { bg: [0, 0, 0], ink: [1, 1, 1] };
    function mixc(t) {
      return 'rgb(' + [0, 1, 2].map(function (c) {
        return Math.round((theme.bg[c] + (theme.ink[c] - theme.bg[c]) * t) * 255);
      }).join(',') + ')';
    }

    var W = 0, H = 0, dpr = 1;
    var fontSize = 13, cw = 8, ch = 16;
    var cols = 0, rows = 0, stride = 0, size = 0;
    var u, v, u0, v0, d, d0, p, dv, ox, oy;
    var mask = null, maskCols = 0, maskRows = 0, maskTop = 0;
    var atlas = null, acw = 0, ach = 0;

    var running = false, raf = 0, t = 0, last = 0;
    var scrollY = window.scrollY || 0;
    var dim = 1;
    var pointer = { x: -1, y: -1, px: -1, py: -1, active: false, lastMove: 0 };
    var ghost = { x: 0, y: 0, phase: Math.random() * 10 };
    var queue = [];
    var frameCost = 0, frameCount = 0, tuned = 0;
    var statsTimer = 0;

    function IX(i, j) { return i + stride * j; }

    /* ---------- setup ---------- */

    function measure() {
      W = window.innerWidth;
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      H = window.innerHeight + (coarse ? 96 : 0);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!tuned) fontSize = W < 640 ? 11 : W < 1100 ? 12 : 13;
      mctx.font = fontSize + 'px ' + fontFamily;
      cw = Math.max(5, Math.round(mctx.measureText('M').width));
      ch = Math.round(fontSize * 1.32);
      cols = Math.ceil(W / cw);
      rows = Math.ceil(H / ch);
      stride = cols + 2;
      size = stride * (rows + 2);
    }

    function alloc() {
      u = new Float32Array(size); v = new Float32Array(size);
      u0 = new Float32Array(size); v0 = new Float32Array(size);
      d = new Float32Array(size); d0 = new Float32Array(size);
      p = new Float32Array(size); dv = new Float32Array(size);
      ox = new Float32Array(size); oy = new Float32Array(size);
    }

    function buildAtlas() {
      acw = Math.ceil(cw * dpr);
      ach = Math.ceil(ch * dpr);
      atlas = document.createElement('canvas');
      if (gl) {
        atlas.width = acw * GLYPHS.length;
        atlas.height = ach;
        var ga = atlas.getContext('2d');
        ga.font = (theme.weight || 400) + ' ' + (fontSize * dpr) + 'px ' + fontFamily;
        ga.textAlign = 'center';
        ga.textBaseline = 'middle';
        ga.fillStyle = '#fff';
        for (var q = 0; q < GLYPHS.length; q++) ga.fillText(GLYPHS[q], q * acw + acw / 2, ach / 2 + dpr * 0.5);
        glAtlas();
        return;
      }
      atlas.width = acw * GLYPHS.length;
      atlas.height = ach * LEVELS;
      var a = atlas.getContext('2d');
      a.font = (theme.weight || 400) + ' ' + (fontSize * dpr) + 'px ' + fontFamily;
      a.textAlign = 'center';
      a.textBaseline = 'middle';
      for (var l = 0; l < LEVELS; l++) {
        a.fillStyle = mixc(LUM_MIN + (LUM_MAX - LUM_MIN) * (l / (LEVELS - 1)));
        for (var k = 0; k < GLYPHS.length; k++) {
          a.fillText(GLYPHS[k], k * acw + acw / 2, l * ach + ach / 2 + dpr * 0.5);
        }
      }
    }

    function buildMask() {
      mask = null;
      if (!maskText || !opts.maskBox) return;
      var box = opts.maskBox(W, H);
      if (!box || !cols || !rows || !(box.areaHeight > 0) || !box.lines || !box.lines.length) return;
      maskCols = cols;
      maskRows = Math.ceil(box.areaHeight / ch);
      maskTop = 0;
      var SS = 3;
      var mc = document.createElement('canvas');
      mc.width = maskCols * SS;
      mc.height = maskRows * SS;
      var m = mc.getContext('2d');
      m.setTransform(SS / cw, 0, 0, SS / ch, 0, 0);
      m.font = box.weight + ' ' + box.fontSize + 'px ' + maskFont;
      m.textBaseline = 'alphabetic';
      m.fillStyle = '#fff';
      for (var ln = 0; ln < box.lines.length; ln++) {
        m.fillText(box.lines[ln].text, box.lines[ln].x, box.lines[ln].baseline);
      }
      var img = m.getImageData(0, 0, mc.width, mc.height).data;
      mask = new Float32Array(maskCols * maskRows);
      for (var j = 0; j < maskRows; j++) {
        for (var i = 0; i < maskCols; i++) {
          var sum = 0;
          for (var sy = 0; sy < SS; sy++) {
            var row = ((j * SS + sy) * mc.width + i * SS) * 4 + 3;
            for (var sx = 0; sx < SS; sx++) sum += img[row + sx * 4];
          }
          mask[i + j * maskCols] = sum / (SS * SS * 255);
        }
      }
    }

    function rebuild() {
      measure();
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      alloc();
      cells = new Uint8Array(cols * rows * 4);
      buildAtlas();
      buildMask();
      ghost.x = W * 0.5; ghost.y = H * 0.5;
      draw();
    }

    /* ---------- solver ---------- */

    function bndVel() {
      var i, j;
      for (j = 1; j <= rows; j++) {
        u[IX(0, j)] = -u[IX(1, j)]; u[IX(cols + 1, j)] = -u[IX(cols, j)];
        v[IX(0, j)] = v[IX(1, j)]; v[IX(cols + 1, j)] = v[IX(cols, j)];
      }
      for (i = 1; i <= cols; i++) {
        v[IX(i, 0)] = -v[IX(i, 1)]; v[IX(i, rows + 1)] = -v[IX(i, rows)];
        u[IX(i, 0)] = u[IX(i, 1)]; u[IX(i, rows + 1)] = u[IX(i, rows)];
      }
    }

    function advect(dst, src, vu, vv) {
      var maxX = cols + 0.5, maxY = rows + 0.5;
      for (var j = 1; j <= rows; j++) {
        for (var i = 1; i <= cols; i++) {
          var k = i + stride * j;
          var x = i - vu[k] / cw;
          var y = j - vv[k] / ch;
          if (x < 0.5) x = 0.5; else if (x > maxX) x = maxX;
          if (y < 0.5) y = 0.5; else if (y > maxY) y = maxY;
          var i0 = x | 0, j0 = y | 0;
          var s1 = x - i0, t1 = y - j0, s0 = 1 - s1, t0 = 1 - t1;
          var a = i0 + stride * j0;
          dst[k] = s0 * (t0 * src[a] + t1 * src[a + stride]) +
                   s1 * (t0 * src[a + 1] + t1 * src[a + 1 + stride]);
        }
      }
    }

    function project() {
      var ax = 1 / (cw * cw), ay = 1 / (ch * ch), den = 1 / (2 * ax + 2 * ay);
      var hx = 0.5 / cw, hy = 0.5 / ch;
      var i, j, k;
      for (j = 1; j <= rows; j++) {
        for (i = 1; i <= cols; i++) {
          k = i + stride * j;
          dv[k] = (u[k + 1] - u[k - 1]) * hx + (v[k + stride] - v[k - stride]) * hy;
          p[k] = 0;
        }
      }
      for (var it = 0; it < 12; it++) {
        for (j = 1; j <= rows; j++) {
          for (i = 1; i <= cols; i++) {
            k = i + stride * j;
            p[k] = (ax * (p[k + 1] + p[k - 1]) + ay * (p[k + stride] + p[k - stride]) - dv[k]) * den;
          }
        }
      }
      for (j = 1; j <= rows; j++) {
        for (i = 1; i <= cols; i++) {
          k = i + stride * j;
          u[k] -= (p[k + 1] - p[k - 1]) * hx;
          v[k] -= (p[k + stride] - p[k - stride]) * hy;
        }
      }
      bndVel();
    }

    function step() {
      for (var q = 0; q < queue.length; q++) applySplat(queue[q]);
      queue.length = 0;

      u0.set(u); v0.set(v);
      advect(u, u0, u0, v0);
      advect(v, v0, u0, v0);
      bndVel();
      project();
      d0.set(d);
      advect(d, d0, u, v);

      for (var k = 0; k < size; k++) {
        d[k] *= 0.972;
        u[k] *= 0.986;
        v[k] *= 0.986;
        var nx = (ox[k] + u[k] * 0.5) * 0.88;
        var ny = (oy[k] + v[k] * 0.5) * 0.88;
        ox[k] = nx > 90 ? 90 : nx < -90 ? -90 : nx;
        oy[k] = ny > 90 ? 90 : ny < -90 ? -90 : ny;
      }
    }

    function applySplat(s) {
      var r = s.r, r2 = r * r;
      var i0 = Math.max(1, Math.floor((s.x - r * 1.6) / cw) + 1);
      var i1 = Math.min(cols, Math.ceil((s.x + r * 1.6) / cw) + 1);
      var j0 = Math.max(1, Math.floor((s.y - r * 1.6) / ch) + 1);
      var j1 = Math.min(rows, Math.ceil((s.y + r * 1.6) / ch) + 1);
      for (var j = j0; j <= j1; j++) {
        var py = (j - 0.5) * ch - s.y;
        for (var i = i0; i <= i1; i++) {
          var px = (i - 0.5) * cw - s.x;
          var dd = px * px + py * py;
          var g = Math.exp(-dd / r2);
          if (g < 0.01) continue;
          var k = i + stride * j;
          if (s.burst) {
            var len = Math.sqrt(dd) || 1;
            u[k] += (px / len) * s.burst * g;
            v[k] += (py / len) * s.burst * g;
          } else {
            u[k] += s.dx * g;
            v[k] += s.dy * g;
          }
          d[k] += s.amount * g;
        }
      }
    }

    /* ---------- render ---------- */

    function draw() {
      if (!atlas || !cells) return;
      var cwD = cw * dpr, chD = ch * dpr;
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = mixc(0);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      var py0 = scrollY * 0.35;
      var maskShift = Math.round(scrollY / ch);
      var nR = RAMP.length;
      var energy = 0;
      var tt = t;
      var o = 0;
      var span = LUM_MAX - LUM_MIN;
      var fieldK = theme.field || 1, strongMark = !!theme.mark;

      for (var j = 1; j <= rows; j++) {
        var py = (j - 0.5) * ch + py0;
        var sy1 = Math.sin(py * 0.011 - tt * 0.25) * 1.6;
        var syb = py * 0.017 - tt * 0.6;
        var dy = Math.round((j - 1) * chD);
        var mrow = (j - 1) + maskShift;
        for (var i = 1; i <= cols; i++, o += 4) {
          var k = i + stride * j;
          var px = (i - 0.5) * cw;
          var a = Math.sin(px * 0.006 + tt * 0.45 + sy1);
          var b = Math.sin(syb + Math.sin(px * 0.004 + tt * 0.2) * 2.0);
          var w = a * 0.6 + b * 0.4;
          var contour = Math.exp(-(w * w) * 40);
          var I = (0.035 + 0.045 * (w * 0.5 + 0.5) + 0.2 * contour) * dim * fieldK;

          var dk = d[k];
          if (dk > 1.4) dk = 1.4;
          I += dk * 0.62;

          var mk = 0;
          if (mask) {
            var mi = Math.round(i - 1 - ox[k] / cw);
            var mj = Math.round(mrow - oy[k] / ch);
            if (mi >= 0 && mi < maskCols && mj >= 0 && mj < maskRows) {
              var mv = mask[mi + mj * maskCols];
              if (mv > 0) { mk = mv; I = I * (1 - mv * 0.5) + mv * (0.9 + 0.1 * w); }
            }
          }

          var uk = u[k], vk = v[k];
          var sp = Math.abs(uk) + Math.abs(vk);
          energy += sp;

          if (I < 0.07) { cells[o] = 0; continue; }
          if (I > 1) I = 1;

          var gi;
          if (sp > 2.2 && I > 0.16) {
            var ang = Math.atan2(vk, uk);
            gi = nR + (((Math.round(ang / (Math.PI / 4)) % 4) + 4) % 4);
          } else {
            gi = Math.min(nR - 1, ((I - 0.07) / 0.93 * nR) | 0);
          }
          var lv = Math.pow(I, 0.8);
          var strength = LUM_MIN + span * lv;
          if (strongMark && mk > 0.3) {
            // light theme: the wordmark prints in full ink with dense glyphs
            strength = Math.max(strength, 0.82 + 0.18 * mk);
            if (gi < nR) gi = Math.max(gi, nR - 3);
          }
          if (gl) {
            cells[o] = gi + 1;
            cells[o + 1] = Math.round(Math.min(1, strength) * 255);
          } else {
            var li = Math.min(LEVELS - 1, ((strength - LUM_MIN) / span * LEVELS) | 0);
            ctx.drawImage(atlas, gi * acw, li * ach, acw, ach,
              Math.round((i - 1) * cwD), dy, acw, ach);
          }
        }
      }
      if (gl) glPresent();
      self.energy = energy / (cols * rows) * 12;
    }

    /* ---------- webgl presenter: one quad, glyphs looked up per cell ---------- */

    function glInit() {
      var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
      var fs = [
        'precision mediump float;',
        'uniform sampler2D uCells;uniform sampler2D uAtlas;',
        'uniform vec2 uGrid;uniform vec2 uCell;uniform float uH;uniform float uGlyphs;uniform vec3 uBg;uniform vec3 uInk;',
        'void main(){',
        ' vec2 px=vec2(gl_FragCoord.x,uH-gl_FragCoord.y);',
        ' vec2 cell=floor(px/uCell);',
        ' vec2 f=(px-cell*uCell)/uCell;',
        ' if(cell.x>=uGrid.x||cell.y>=uGrid.y){gl_FragColor=vec4(uBg,1.);return;}',
        ' vec4 c=texture2D(uCells,(cell+.5)/uGrid);',
        ' float g=floor(c.r*255.+.5);',
        ' if(g<.5){gl_FragColor=vec4(uBg,1.);return;}',
        ' float a=texture2D(uAtlas,vec2((g-1.+f.x)/uGlyphs,f.y)).a;',
        ' gl_FragColor=vec4(mix(uBg,uInk,c.g*a),1.);',
        '}'
      ].join('\n');
      function sh(type, src) {
        var o = gl.createShader(type);
        gl.shaderSource(o, src); gl.compileShader(o);
        if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o));
        return o;
      }
      var prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      var loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      function tex(unit, filter) {
        var tx = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tx);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tx;
      }
      glr = {
        cellsTex: tex(0, gl.NEAREST),
        atlasTex: tex(1, gl.LINEAR),
        uGrid: gl.getUniformLocation(prog, 'uGrid'),
        uCell: gl.getUniformLocation(prog, 'uCell'),
        uH: gl.getUniformLocation(prog, 'uH'),
        uGlyphs: gl.getUniformLocation(prog, 'uGlyphs'),
        uBg: gl.getUniformLocation(prog, 'uBg'),
        uInk: gl.getUniformLocation(prog, 'uInk')
      };
      gl.uniform1i(gl.getUniformLocation(prog, 'uCells'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 1);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    }

    function glAtlas() {
      if (!glr) return;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, glr.atlasTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, glr.cellsTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(glr.uGrid, cols, rows);
      gl.uniform2f(glr.uCell, cw * dpr, ch * dpr);
      gl.uniform1f(glr.uH, canvas.height);
      gl.uniform1f(glr.uGlyphs, GLYPHS.length);
      glTheme();
    }

    function glTheme() {
      if (!glr) return;
      gl.uniform3f(glr.uBg, theme.bg[0], theme.bg[1], theme.bg[2]);
      gl.uniform3f(glr.uInk, theme.ink[0], theme.ink[1], theme.ink[2]);
    }

    function glPresent() {
      if (!glr) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, cells);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (gl) {
      try { glInit(); } catch (e) { glr = null; }
      if (!glr) {
        // WebGL unusable: swap in a fresh canvas and fall back to 2D.
        gl = null;
        var fresh = canvas.cloneNode(false);
        if (canvas.parentNode) canvas.parentNode.replaceChild(fresh, canvas);
        canvas = fresh;
        ctx = canvas.getContext('2d', { alpha: false });
      } else {
        canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); glr = null; });
        canvas.addEventListener('webglcontextrestored', function () {
          try { glInit(); rebuild(); } catch (e) { glr = null; }
        });
      }
    }

    /* ---------- loop ---------- */

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = last ? Math.min(50, now - last) : 16;
      last = now;
      t += dt / 1000;

      var start = performance.now();

      if (now - pointer.lastMove > 2600) wander(dt);
      step();
      draw();

      frameCost += performance.now() - start;
      frameCount++;
      if (frameCount === 90) {
        if (frameCost / 90 > 12 && fontSize < 18) {
          fontSize += 1; tuned = 1; rebuild();
        }
        frameCost = 0; frameCount = 0;
      }

      statsTimer += dt;
      if (statsTimer > 120) {
        statsTimer = 0;
        onStats({ x: pointer.x, y: pointer.y, flow: self.energy || 0 });
      }
    }

    function wander(dt) {
      ghost.phase += dt / 1000;
      var g = ghost.phase;
      var nx = W * (0.5 + 0.42 * Math.sin(g * 0.37) * Math.cos(g * 0.11));
      var ny = H * (0.5 + 0.4 * Math.sin(g * 0.29 + 1.3));
      var dx = nx - ghost.x, dy = ny - ghost.y;
      ghost.x = nx; ghost.y = ny;
      // a faint drift only: never strong enough to draw directional strokes
      queue.push({ x: nx, y: ny, dx: dx * 0.025, dy: dy * 0.025, amount: 0.01, r: 56 });
    }

    /* ---------- input ---------- */

    function move(x, y) {
      var now = performance.now();
      if (pointer.px < 0) { pointer.px = x; pointer.py = y; }
      var dx = x - pointer.px, dy = y - pointer.py;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.min(12, Math.max(1, Math.ceil(dist / (cw * 2.5))));
      var amount = Math.min(0.5, 0.06 + dist * 0.012);
      for (var s = 1; s <= steps; s++) {
        var f = s / steps;
        queue.push({
          x: pointer.px + dx * f, y: pointer.py + dy * f,
          dx: (dx / steps) * 1.1, dy: (dy / steps) * 1.1,
          amount: amount / steps * 1.6, r: W < 640 ? 34 : 46
        });
      }
      pointer.px = x; pointer.py = y;
      pointer.x = x; pointer.y = y;
      pointer.lastMove = now;
    }

    self.pointerMove = function (x, y) { if (running) move(x, y); else { pointer.x = x; pointer.y = y; } };
    self.pointerLeave = function () { pointer.px = -1; pointer.py = -1; };
    self.burst = function (x, y, strength) {
      if (!running) return;
      queue.push({ x: x, y: y, burst: strength || 9, amount: 0.9, r: 70 });
      pointer.lastMove = performance.now();
    };
    self.gust = function (x, y, dx, dy, r) {
      if (!running) return;
      queue.push({ x: x, y: y, dx: dx, dy: dy, amount: 0.25, r: r || 60 });
    };
    self.scroll = function (y) {
      var delta = y - scrollY;
      scrollY = y;
      if (running && Math.abs(delta) > 0.5) {
        // spread thin across the full width so no single jet forms on big jumps
        var push = Math.max(-5, Math.min(5, -delta * 0.15));
        for (var n = 0; n < 7; n++) {
          queue.push({ x: W * ((n + 0.5) / 7) + (Math.random() - 0.5) * 60,
            y: H * (0.35 + Math.random() * 0.4), dx: 0, dy: push, amount: 0.012, r: 80 });
        }
      }
      if (!running) draw();
    };
    self.setDim = function (x) { dim = x; };
    self.setTheme = function (next) {
      theme = next;
      if (atlas) buildAtlas();
      if (gl) glTheme();
      draw();
    };
    self.start = function () {
      if (running) return;
      running = true; last = 0;
      raf = requestAnimationFrame(frame);
    };
    self.stop = function () {
      running = false;
      cancelAnimationFrame(raf);
      draw();
    };
    self.isRunning = function () { return running; };
    self.redraw = draw;

    var lastW = 0, lastH = 0, rt = 0;
    self.resize = function (force) {
      var w = window.innerWidth, h = window.innerHeight;
      if (!force && w === lastW && h <= H && h > H - 220) return;
      lastW = w; lastH = h;
      clearTimeout(rt);
      rt = setTimeout(rebuild, force ? 0 : 120);
    };

    lastW = window.innerWidth; lastH = window.innerHeight;
    rebuild();
  }

  window.AsciiField = AsciiField;
})();
