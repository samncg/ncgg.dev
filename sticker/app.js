(function () {
  'use strict';

  var E = window.StickerEngine;
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function fmtN(n) { return n.toLocaleString('en-US'); }
  function has(s, c) { return s.indexOf(c) >= 0; }

  /* ---------- settings ---------- */

  var KEY_PHONE = 'ncgg:sticker:phone';
  var PHONE_DEFAULTS = {
    rx: 100, ry: 600, rw: 880, rh: 880, pen: 6, esz: 8, method: 'mo', dur: 100,
    ex: 0, ey: 0, tx: 0, ty: 0, ex2: '', tx2: '', sd: 2, pt: 120,
    tdev: '/dev/input/event8', mx: 121999, my: 265599, scw: 1220, sch: 2656, mc: false
  };
  var Ph = Object.assign({}, PHONE_DEFAULTS, load(KEY_PHONE) || {});
  // settings saved before aimed motion: swipes lost the ends of lines, so move them over once
  if (!(Ph.v >= 2)) { if (Ph.method === 'sw') Ph.method = 'mo'; if (+Ph.dur < 100) Ph.dur = 100; Ph.v = 2; save(KEY_PHONE, Ph); }
  var P = E.withDefaults({});
  function syncPhysical() { P.rw = +Ph.rw || 880; P.rh = +Ph.rh || 880; P.pen = +Ph.pen || 6; P.esz = +Ph.esz || 8; }
  syncPhysical();

  var state = { img: null, name: '', result: null, ranking: {}, autoMode: null, adjusted: false, matching: false };

  /* ---------- controls ---------- */

  function lineStyle(m) { return !E.isPixel(m); }
  var TONE = [
    { k: 'br', label: 'Brightness', min: -100, max: 100, step: 1 },
    { k: 'co', label: 'Contrast', min: -100, max: 100, step: 1 },
    { k: 'gm', label: 'Midtones', min: 40, max: 250, step: 1, hint: 'Higher lifts the shadows, lower deepens them.' },
    { k: 'lc', label: 'Local contrast', min: 0, max: 100, step: 1, hint: 'Gives dark and pale regions their own range, so a dark face or a pale sky keeps its features.' }
  ];
  var STYLE_CTL = [
    { k: 'thr', label: 'Darkness cutoff', min: 20, max: 235, step: 1, hint: 'Ink goes where the image is darker than this.', show: function (m) { return has('whbcym', m); } },
    { k: 'dth', label: 'Dot cutoff', min: 150, max: 254, step: 1, hint: 'Anything lighter than this stays paper.', show: function (m) { return has('dm', m); } },
    { k: 'sen', label: 'Edge sensitivity', min: 0, max: 100, step: 1, hint: 'Higher traces fainter edges.', show: function (m) { return has('ebm', m); } },
    { k: 'tn', label: 'Tiles per side', min: 1, max: 12, step: 1, hint: 'Drawn tile by tile from the top left. Each tile is finished before the next, and later tiles never draw over it. 1 is the whole canvas at once.', show: function (m) { return has('zw', m) || P.tile; } },
    { k: 'ps', label: 'Passes', min: 0, max: 30, step: 1, hint: 'Brush and eraser rounds per band (0 keeps going until it stops helping).', show: function (m) { return has('zw', m); } },
    { k: 'cross', label: 'Cross-hatch dark areas', type: 'check', show: function (m) { return has('hb', m); } },
    { k: 'era', label: 'Eraser pass to carve highlights', type: 'check', show: function (m) { return has('hbc', m); } },
    { k: 'hl', label: 'Highlight level', min: 120, max: 250, step: 1, hint: 'The eraser clears tones lighter than this.', show: function (m) { return m === 'l' || (P.era && has('hbc', m)); } }
  ];
  var MORE = [
    { k: 'res', label: 'Detail', min: 60, max: 800, step: 10, hint: 'Grid size for line styles: finer, but longer to draw.', show: lineStyle },
    { k: 'min', label: 'Shortest stroke', min: 1, max: 20, step: 1, hint: 'Skip strokes shorter than this many cells.', show: lineStyle },
    { k: 'sm', label: 'Smoothing', min: 0, max: 4, step: 1, hint: 'Blur the image a little before drawing.' },
    { k: 'auto', label: 'Automatic line spacing', type: 'check', show: function (m) { return has('hbcdplm', m); } },
    { k: 'gap', label: 'Line spacing', min: 1, max: 30, step: 1, show: function (m) { return !P.auto && has('hbcdplm', m); } },
    { k: 'gap2', label: 'Dark-area spacing', min: 1, max: 30, step: 1, show: function (m) { return !P.auto && has('hbm', m); } },
    { k: 'trim', label: 'Thin lines with the eraser', type: 'check', show: function (m) { return !has('zw', m); } },
    { k: 'tw', label: 'Thin to (px)', min: 0.5, max: 20, step: 0.5, show: function (m) { return P.trim && !has('zw', m); } },
    { k: 'tile', label: 'Tile sweep: brush and eraser one tile at a time', type: 'check', show: function (m) { return !has('zw', m); } },
    { k: 'guard', label: 'Keep erasers off finished tiles', type: 'check', show: function (m) { return P.tile && !has('zw', m); } },
    { k: 'inv', label: 'Invert', type: 'check' },
    { k: 'shape', label: 'Sticker shape', type: 'select', options: [['rect', 'rectangle'], ['circle', 'circle']] }
  ];
  var ALL = TONE.concat(STYLE_CTL, MORE);

  function ctlHTML(c) {
    var id = 'c-' + c.k;
    if (c.type === 'check') {
      return '<label class="chk" data-key="' + c.k + '"><input type="checkbox" id="' + id + '"><span>' + c.label + '</span></label>';
    }
    if (c.type === 'select') {
      return '<div class="ctl" data-key="' + c.k + '"><label for="' + id + '">' + c.label + '</label>' +
        '<select class="num" id="' + id + '" style="grid-column: span 2; text-align: left">' +
        c.options.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    return '<div class="ctl" data-key="' + c.k + '"><label for="' + id + '">' + c.label + '</label>' +
      '<input type="range" id="' + id + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '">' +
      '<input class="num" type="number" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" aria-label="' + c.label + ' value">' +
      (c.hint ? '<p class="ctl__hint">' + c.hint + '</p>' : '') + '</div>';
  }
  $('#tone').innerHTML = TONE.map(ctlHTML).join('');
  // brightness and contrast again at the top (step 01), kept in step with the ones under Tone
  var QUICK = TONE.filter(function (c) { return c.k === 'br' || c.k === 'co'; });
  $('#quick-tone').innerHTML = QUICK.map(function (c) {
    return '<div class="ctl" data-qkey="' + c.k + '"><label for="q-' + c.k + '">' + c.label + '</label>' +
      '<input type="range" id="q-' + c.k + '" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '">' +
      '<input class="num" type="number" min="' + c.min + '" max="' + c.max + '" step="' + c.step + '" aria-label="' + c.label + ' value"></div>';
  }).join('');
  function paintQuick() {
    QUICK.forEach(function (c) {
      var n = $('.num', $('[data-qkey="' + c.k + '"]'));
      $('#q-' + c.k).value = P[c.k];
      if (document.activeElement !== n) n.value = P[c.k];
    });
  }
  QUICK.forEach(function (c) {
    var el = $('#q-' + c.k), num = $('.num', $('[data-qkey="' + c.k + '"]'));
    el.addEventListener('input', function () { P[c.k] = +el.value; paintControls(); replan(); });
    num.addEventListener('input', function () {
      var v = parseFloat(num.value);
      if (isNaN(v)) return;
      P[c.k] = Math.max(c.min, Math.min(c.max, v)); paintControls(); replan();
    });
  });
  $('#style-controls').innerHTML = STYLE_CTL.map(ctlHTML).join('');
  $('#more-controls').innerHTML = MORE.map(ctlHTML).join('');

  $('#style-list').innerHTML = E.STYLES.map(function (s) {
    return '<label class="style"><input type="radio" name="style" value="' + s.id + '">' +
      '<span class="style__name">' + s.name + '<i data-rank="' + s.id + '"></i></span>' +
      '<span class="style__blurb">' + s.blurb + '</span></label>';
  }).join('');

  function paintControls() {
    ALL.forEach(function (c) {
      var wrap = $('[data-key="' + c.k + '"]'), el = $('#c-' + c.k);
      if (c.type === 'check') el.checked = !!P[c.k];
      else if (c.type === 'select') el.value = P[c.k];
      else { el.value = P[c.k]; var n = $('.num', wrap); if (document.activeElement !== n) n.value = P[c.k]; }
      wrap.hidden = c.show ? !c.show(P.mode, P) : false;
    });
    var any = STYLE_CTL.some(function (c) { return !c.show || c.show(P.mode, P); });
    $('#style-group').hidden = !any;
    var r = $('input[name="style"][value="' + P.mode + '"]');
    if (r) r.checked = true;
    $$('.paper[data-shape]').forEach(function (p) { p.classList.toggle('is-circle', P.shape === 'circle'); p.style.aspectRatio = (P.rw || 1) + ' / ' + (P.rh || 1); });
    $$('[data-fit]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-fit') === P.fit)); });
    paintQuick();
  }

  // image fit sits at the top (step 01): fill the canvas (default) or fit inside
  $$('[data-fit]').forEach(function (b) {
    b.addEventListener('click', function () {
      var v = b.getAttribute('data-fit');
      if (P.fit === v) return;
      P.fit = v;
      paintControls(); drawSource(); replan(); softRematch();
    });
  });

  ALL.forEach(function (c) {
    var wrap = $('[data-key="' + c.k + '"]'), el = $('#c-' + c.k);
    if (c.type === 'check') {
      el.addEventListener('change', function () { P[c.k] = el.checked; paintControls(); replan(); });
    } else if (c.type === 'select') {
      el.addEventListener('change', function () { P[c.k] = el.value; paintControls(); drawSource(); replan(); if (c.k === 'fit' || c.k === 'shape') softRematch(); });
    } else {
      var num = $('.num', wrap);
      el.addEventListener('input', function () { P[c.k] = +el.value; num.value = el.value; paintQuick(); replan(); });
      num.addEventListener('input', function () {
        var v = parseFloat(num.value);
        if (isNaN(v)) return;
        v = Math.max(c.min, Math.min(c.max, v));
        P[c.k] = v; el.value = v; paintQuick(); replan();
      });
    }
  });
  $('#style-list').addEventListener('change', function (e) {
    if (e.target.name !== 'style') return;
    P.mode = e.target.value; paintControls(); replan();
  });

  /* ---------- phone fields ---------- */

  function field(k, label, opts) {
    opts = opts || {};
    var id = 'p-' + k, input;
    if (opts.options) input = '<select id="' + id + '">' + opts.options.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</select>';
    else if (opts.check) return '<label class="chk field--wide" data-pkey="' + k + '"><input type="checkbox" id="' + id + '"><span>' + label + '</span></label>';
    else input = '<input id="' + id + '" type="' + (opts.text ? 'text' : 'number') + '" inputmode="' + (opts.text ? 'text' : 'decimal') + '"' +
      (opts.placeholder ? ' placeholder="' + opts.placeholder + '"' : '') + (opts.step ? ' step="' + opts.step + '"' : '') + '>';
    return '<label class="field' + (opts.wide ? ' field--wide' : '') + '" data-pkey="' + k + '"><span>' + label + '</span>' + input + (opts.small ? '<small>' + opts.small + '</small>' : '') + '</label>';
  }
  $('#canvas-fields').innerHTML = field('rx', 'Left') + field('ry', 'Top') + field('rw', 'Width') + field('rh', 'Height');
  $('#tool-size-fields').innerHTML = field('pen', 'Brush size (px)', { small: 'How wide HeyTea’s smallest brush really draws on this phone: about 3 dp, 10.5 px at 560 dpi. Finding the canvas from a screenshot sets it.', step: 0.5 }) +
    field('esz', 'Eraser size (px)', { step: 0.5 });
  $('#method-fields').innerHTML = field('method', 'How the pen moves', { options: [['mo', 'aimed motion · Android 10+, exact'], ['sw', 'swipes there and back · any Android'], ['fe', 'raw touch events · needs root on most phones']] }) +
    field('dur', 'Line time (ms)', { small: 'How long each line takes. HeyTea leaves off the last 20–30 ms of a stroke, so lines are drawn there and back and never faster than 80 ms. Dots stay quick.' });
  $('#tool-fields').innerHTML = field('ex', 'Eraser X') + field('ey', 'Eraser Y') + field('tx', 'Pen X') + field('ty', 'Pen Y');
  $('#tool-extra').innerHTML = field('ex2', 'Extra taps after eraser', { text: true, placeholder: 'x,y; x,y' }) +
    field('tx2', 'Extra taps after pen', { text: true, placeholder: 'x,y; x,y' }) +
    field('sd', 'Wait after switching (s)', { step: 0.5 }) + field('pt', 'Button press (ms)');
  $('#fast-fields').innerHTML = field('tdev', 'Touch device', { text: true, wide: true }) + field('mx', 'Raw max X') + field('my', 'Raw max Y') +
    field('scw', 'Screen width (px)') + field('sch', 'Screen height (px)') + field('mc', 'Combine events into one sendevent call (only if your phone supports it)', { check: true });

  var REPLAN_KEYS = { rw: 1, rh: 1, pen: 1, esz: 1 };

  // auto line-up: find the sticker canvas on a screenshot of the phone and fill in its edges
  function findFromScreenshot(file) {
    var note = $('#shot-note'), url = URL.createObjectURL(file), im = new Image();
    note.textContent = 'Looking for the canvas…';
    im.onload = function () {
      var W = im.naturalWidth, H = im.naturalHeight, c = makeCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0);
      var data = x.getImageData(0, 0, W, H).data, f = E.findCanvas(data, W, H), view = $('#shot-view'), sc = Math.min(1, 640 / H);
      var tools = f ? E.findTools(data, W, H, f.y + f.h) : null;
      URL.revokeObjectURL(url);
      view.width = Math.round(W * sc); view.height = Math.round(H * sc); view.hidden = false;
      var v = view.getContext('2d');
      v.drawImage(im, 0, 0, view.width, view.height);
      if (!f) {
        note.textContent = 'No canvas found on that screenshot. Open Create Sticker in HeyTea so the empty canvas shows, or enter the edges below.';
        return;
      }
      v.strokeStyle = '#ff2d55'; v.lineWidth = 3;
      if (f.shape === 'circle') { v.beginPath(); v.ellipse((f.x + f.w / 2) * sc, (f.y + f.h / 2) * sc, f.w / 2 * sc, f.h / 2 * sc, 0, 0, Math.PI * 2); v.stroke(); }
      else v.strokeRect(f.x * sc - 1.5, f.y * sc - 1.5, f.w * sc + 3, f.h * sc + 3);
      Ph.rx = f.x; Ph.ry = f.y; Ph.rw = f.w; Ph.rh = f.h; Ph.scw = W; Ph.sch = H;
      // HeyTea's smallest brush and eraser, as wide as they draw on this screen
      var size = E.toolSize(f.w);
      Ph.pen = size; Ph.esz = size;
      if (tools) {
        Ph.tx = tools.pen[0]; Ph.ty = tools.pen[1]; Ph.ex = tools.eraser[0]; Ph.ey = tools.eraser[1];
        [tools.pen, tools.eraser].forEach(function (t) { v.beginPath(); v.arc(t[0] * sc, t[1] * sc, 14, 0, Math.PI * 2); v.stroke(); });
      }
      if (f.shape === 'circle') P.shape = 'circle';
      save(KEY_PHONE, Ph);
      paintPhone(); syncPhysical(); paintControls(); drawSource(); replan();
      note.textContent = 'Found the canvas: left ' + f.x + ', top ' + f.y + ', ' + f.w + ' × ' + f.h + (f.shape === 'circle' ? ' (round)' : '') + ' on a ' + W + ' × ' + H + ' screen' +
        '; brush and eraser about ' + size + ' px wide' + (tools ? '; and the Brush (' + tools.pen.join(', ') + ') and Eraser (' + tools.eraser.join(', ') + ') buttons. Filled in below.'
          : '. No Brush and Eraser buttons on it: pick the Brush so its panel opens and use a new screenshot, because the canvas moves up when the panel opens.');
      if (tools) $('#tools-more').open = true;
      toast('Canvas lined up: ' + f.w + ' × ' + f.h);
    };
    im.onerror = function () { URL.revokeObjectURL(url); note.textContent = 'That file could not be opened as an image.'; };
    im.src = url;
  }
  $('#shot').addEventListener('change', function () { var f = this.files && this.files[0]; if (f) findFromScreenshot(f); this.value = ''; });
  // a screenshot dropped here is for lining up, not the picture to draw
  var finder = $('#finder');
  ['dragenter', 'dragover'].forEach(function (n) { finder.addEventListener(n, function (e) { e.preventDefault(); e.stopPropagation(); finder.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (n) { finder.addEventListener(n, function (e) { e.preventDefault(); e.stopPropagation(); finder.classList.remove('is-over'); }); });
  finder.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) findFromScreenshot(f);
  });
  function paintPhone() {
    Object.keys(PHONE_DEFAULTS).forEach(function (k) {
      var el = $('#p-' + k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!Ph[k]; else if (document.activeElement !== el) el.value = Ph[k];
    });
    $('[data-pkey="dur"]').hidden = Ph.method !== 'sw';
    $('#fast-more').hidden = Ph.method !== 'fe';
    if (Ph.method === 'fe') $('#fast-more').open = true;
  }
  Object.keys(PHONE_DEFAULTS).forEach(function (k) {
    var el = $('#p-' + k);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', function () {
      var v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? parseFloat(el.value) : el.value;
      if (el.type === 'number' && isNaN(v)) return;
      Ph[k] = v;
      save(KEY_PHONE, Ph);
      paintPhone();
      if (REPLAN_KEYS[k]) { syncPhysical(); paintControls(); drawSource(); replan(); }
      else queueScript();
    });
  });

  /* ---------- workers ---------- */

  var canWork = typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
  function makeCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var planner = null, matcher = null, seq = 0, planWanted = null, planBusy = false, matchId = 0;

  function spawn() {
    var w = new Worker('worker.js?v=44');
    w.onerror = function () { canWork = false; };
    return w;
  }
  function sendImage(w) {
    return createImageBitmap(state.img).then(function (bmp) { w.postMessage({ type: 'image', bitmap: bmp, id: 0 }, [bmp]); });
  }

  /* ---------- image ---------- */

  function loadImage(src, name) {
    var im = new Image();
    im.onload = function () {
      state.img = im; state.name = name || 'image';
      state.result = null; state.ranking = {};
      $('#drop').hidden = true;
      $('#loaded').hidden = false;
      $('#thumb').style.backgroundImage = 'url("' + src + '")';
      $('#file-name').textContent = state.name + ' · ' + im.naturalWidth + ' × ' + im.naturalHeight;
      $$('[data-empty]').forEach(function (e) { e.hidden = true; });
      $('#toggle-adjusted').hidden = false;
      drawSource();
      if (canWork) {
        if (planner) planner.terminate();
        stopLive();
        if (matcher) matcher.terminate();
        planner = spawn(); matcher = spawn();
        planBusy = false; planWanted = null; planJobs = {};
        planner.onmessage = onPlanner; matcher.onmessage = onMatcher;
        Promise.all([sendImage(planner), sendImage(matcher)]).then(runMatch, function () { canWork = false; runMatch(); });
      } else runMatch();
    };
    im.onerror = function () { toast('That file could not be opened as an image.'); };
    im.src = src;
  }
  var fileInput = $('#file');
  fileInput.addEventListener('change', function () {
    var f = fileInput.files && fileInput.files[0];
    if (f) loadImage(URL.createObjectURL(f), f.name);
  });
  function fromItems(list) {
    for (var i = 0; i < list.length; i++) if (list[i].type && list[i].type.indexOf('image/') === 0) return list[i].getAsFile ? list[i].getAsFile() : list[i];
    return null;
  }
  var drop = $('#drop');
  ['dragenter', 'dragover'].forEach(function (n) {
    window.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (n) {
    window.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  window.addEventListener('drop', function (e) {
    var f = e.dataTransfer && fromItems(e.dataTransfer.files);
    if (f) loadImage(URL.createObjectURL(f), f.name);
  });
  window.addEventListener('paste', function (e) {
    var f = e.clipboardData && fromItems(e.clipboardData.items);
    if (f) loadImage(URL.createObjectURL(f), 'pasted image');
  });
  $('#sample').addEventListener('click', function () { loadImage('../assets/sticker/source.jpg', 'sample.jpg'); });

  /* ---------- auto-match ---------- */

  function busy(on, pct, text) {
    $('#busy').hidden = !on;
    if (pct !== undefined) $('#busy-bar').style.width = pct + '%';
    if (text) $('#busy-text').textContent = text;
  }
  function styleName(id) { for (var i = 0; i < E.STYLES.length; i++) if (E.STYLES[i].id === id) return E.STYLES[i].name; return id; }
  function matchSettings() {
    var Q = E.copy(P);
    Q.mode = P.mode; return Q;
  }
  function runMatch() {
    if (!state.img) return;
    state.matching = true;
    state.live = null; state.matchPct = 0; state.bestMatch = undefined;
    var id = ++matchId;
    busy(true, 2, 'finding the closest settings');
    setButtons(false);
    $('#stats').textContent = 'Drawing the pixel sweep at different tones and comparing it with your image…';
    if (canWork) { startLive(); matcher.postMessage({ type: 'match', id: id, P: matchSettings() }); return; }
    setTimeout(function () {
      var r = E.autoMatch(state.img, matchSettings(), { makeCanvas: makeCanvas, onProgress: function () {} });
      matched(r, id);
    }, 30);
  }
  // fit or shape changed: start the search again, abandoning one that is still running
  function softRematch() {
    if (!state.img) return;
    if (state.matching && canWork && matcher) {
      matcher.terminate();
      matcher = spawn(); matcher.onmessage = onMatcher;
      sendImage(matcher).then(runMatch, function () { canWork = false; runMatch(); });
      return;
    }
    runMatch();
  }
  function onMatcher(e) {
    var m = e.data;
    if (m.id !== matchId) return;
    if (m.type === 'progress') {
      state.matchPct = m.pct;
      if (m.match !== null) state.bestMatch = m.match;
      paintLive();
    } else if (m.type === 'trying') livePlan(m.P);
    else if (m.type === 'matched') matched(m.result, m.id);
    else if (m.type === 'error') { state.matching = false; state.live = null; stopLive(); busy(false); toast('Auto-match failed: ' + m.message); replan(); }
  }
  /*
   * live view: while the search runs, it sends the settings it is trying twice a second. Planning one can
   * take longer than that, so two workers of their own take turns (one on a single-core machine); a result
   * is drawn unless a newer one has already been. They stop when the search does.
   */
  var KEEP = ['rw', 'rh', 'pen', 'esz', 'shape', 'fit'];
  var live = { workers: [], wanted: null, seq: 0, shown: 0 };
  function startLive() {
    if (!canWork || live.workers.length) return;
    var n = (navigator.hardwareConcurrency || 2) > 2 ? 2 : 1;
    for (var i = 0; i < n; i++) (function (L) {
      L.w.onerror = function () { L.dead = true; };
      L.w.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'ready') L.ready = true;
        else if (m.type === 'planned' || m.type === 'error') {
          L.busy = false;
          if (m.type === 'planned' && state.matching && m.id > live.shown) { live.shown = m.id; liveDrawn(m.result, L.P); }
        }
        pumpLive();
      };
      live.workers.push(L);
      sendImage(L.w).catch(function () { L.dead = true; });
    })({ w: spawn(), ready: false, busy: false, dead: false });
  }
  function stopLive() {
    live.workers.forEach(function (L) { L.w.terminate(); });
    live.workers = []; live.wanted = null;
  }
  function pumpLive() {
    live.workers.forEach(function (L) {
      if (!live.wanted || !L.ready || L.busy || L.dead) return;
      L.busy = true; L.P = live.wanted.P;
      L.w.postMessage({ type: 'plan', id: live.wanted.id, P: L.P, quick: true });
      live.wanted = null;
    });
  }
  function livePlan(tryP) {
    var Q = E.withDefaults(tryP);
    KEEP.forEach(function (k) { Q[k] = P[k]; });
    live.wanted = { id: ++live.seq, P: Q };
    pumpLive();
  }
  function liveDrawn(res, Q) {
    state.result = res; state.planP = Q;
    state.live = { strokes: res.strokes.length, P: Q };
    if (state.adjusted) drawSource();
    startDrawing(false);
    paintLive();
  }
  function paintLive() {
    var L = state.live, pct = state.matchPct || 0, b = state.bestMatch;
    busy(true, pct, 'matching the tone · ' + pct + '%' + (b !== undefined ? ' · best so far ' + Math.round(b) + '%' : ''));
    if (b !== undefined) $('#match').textContent = 'best so far ' + Math.round(b) + '%';
    if (L) {
      var Q = L.P, sign = function (v) { return v > 0 ? '+' + v : v < 0 ? '−' + -v : '0'; };
      $('#stats').textContent = 'Trying: brightness ' + sign(Q.br) + ', contrast ' + sign(Q.co) + ', midtones ' + Q.gm +
        ('zw'.indexOf(Q.mode) >= 0 ? ', ' + Q.ps + ' passes' : '') + ' · ' + fmtN(L.strokes) + ' strokes';
    }
  }

  function matched(r, id) {
    if (id !== matchId) return;
    state.matching = false;
    state.live = null;
    stopLive();
    var keep = { rw: P.rw, rh: P.rh, pen: P.pen, esz: P.esz, shape: P.shape, fit: P.fit };
    P = E.withDefaults(r.P);
    Object.keys(keep).forEach(function (k) { P[k] = keep[k]; });
    state.autoMode = P.mode;
    state.ranking = {};
    r.ranking.forEach(function (x) { state.ranking[x.mode] = x.match; });
    state.ranking[P.mode] = Math.round(r.match);
    $$('[data-rank]').forEach(function (el) {
      var v = state.ranking[el.getAttribute('data-rank')];
      el.textContent = v === undefined ? '' : v + '%';
      el.classList.toggle('is-best', el.getAttribute('data-rank') === state.autoMode);
    });
    state.looks = r.looks || {};
    state.look = r.look;
    paintLooks();
    $('#auto').hidden = false;
    $('#auto-style').textContent = styleName(P.mode);
    $('#auto-match').textContent = Math.round(r.match) + '% match';
    busy(false);
    paintControls();
    replan(true);
  }
  $('#rematch').addEventListener('click', runMatch);

  // clean lines / halftone: each look's own best settings from the search
  function paintLooks() {
    $$('[data-look]').forEach(function (b) {
      var k = b.getAttribute('data-look'), L = state.looks && state.looks[k];
      b.hidden = !L;
      b.setAttribute('aria-pressed', String(k === state.look));
      var m = $('[data-look-match="' + k + '"]', b);
      if (m) m.textContent = L ? Math.round(L.match) + '%' : '';
    });
  }
  $$('[data-look]').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-look'), L = state.looks && state.looks[k];
      if (!L || state.matching) return;
      var keep = { rw: P.rw, rh: P.rh, pen: P.pen, esz: P.esz, shape: P.shape, fit: P.fit, tn: P.tn };
      P = E.withDefaults(L.P);
      Object.keys(keep).forEach(function (q) { P[q] = keep[q]; });
      state.look = k;
      $('#auto-match').textContent = Math.round(L.match) + '% match';
      paintLooks(); paintControls(); replan(true);
    });
  });

  /* ---------- planning ---------- */

  var planTimer = 0, animateNext = false;
  function replan(animate) {
    if (!state.img || state.matching) return;
    if (animate) animateNext = true;
    clearTimeout(planTimer);
    planTimer = setTimeout(requestPlan, animate ? 0 : 90);
  }
  // one plan at a time in the worker; only the newest waiting request is kept
  var planJobs = {};
  function sendPlan(Q) {
    if (planBusy) { planWanted = Q; return; }
    planBusy = true;
    planJobs[++seq] = Q;
    planner.postMessage({ type: 'plan', id: seq, P: Q });
  }
  function requestPlan() {
    var Q = E.copy(P);
    if (canWork && planner) {
      sendPlan(Q);
      $('#stats').textContent = 'Planning strokes…';
      return;
    }
    var G = E.grid(Q), base = E.luminance(state.img, G.W, G.H, Q.fit, makeCanvas), g = E.adjust(base, G.W, G.H, Q), r = E.plan(g, G.W, G.H, Q);
    var ink = E.rasterize(r.strokes, G.W, G.H, Q, makeCanvas, 2), sc = E.compare(ink, E.inkTarget(base, G.W, G.H, Q), G.W, G.H, Q);
    planned({ W: G.W, H: G.H, g: g, gap: r.gap, match: sc.match, strokes: r.strokes.map(function (p) { return { p: p, er: p.er ? 1 : 0, ty: p.ty, dot: p.dot ? 1 : 0, band: p.band, pass: p.pass }; }) }, Q);
  }
  function onPlanner(e) {
    var m = e.data;
    var Q = planJobs[m.id];
    delete planJobs[m.id];
    if (!Q) return; // from a planner that has since been replaced
    if (m.type === 'planned') {
      planBusy = false;
      // a newer request is waiting: this result is already out of date
      if (planWanted) { var w = planWanted; planWanted = null; sendPlan(w); return; }
      planned(m.result, Q);
    } else if (m.type === 'error') { planBusy = false; toast('Planning failed: ' + m.message); }
  }
  function planned(res, Q) {
    state.result = res; state.planP = Q;
    if (!P.auto) { /* keep manual spacing */ } else { P.gap = res.gap[0]; P.gap2 = res.gap[1]; paintControls(); }
    $('#match').textContent = Math.round(res.match) + '% match';
    if (state.adjusted) drawSource();
    var anim = animateNext && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    animateNext = false;
    startDrawing(anim);
    setButtons(true);
    queueScript();
  }

  /* ---------- preview ---------- */

  var srcCv = $('#src-view'), drawCv = $('#draw-view'), pen = $('#pen');
  function drawSource() {
    if (!state.img) return;
    var x = srcCv.getContext('2d'), S = 880;
    srcCv.width = S; srcCv.height = Math.round(S * (P.rh || 1) / (P.rw || 1));
    x.fillStyle = '#fff'; x.fillRect(0, 0, srcCv.width, srcCv.height);
    if (state.adjusted && state.result) {
      var r = state.result, c = makeCanvas(r.W, r.H), cx = c.getContext('2d'), id = cx.createImageData(r.W, r.H);
      for (var i = 0; i < r.W * r.H; i++) { var v = r.g[i]; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
      cx.putImageData(id, 0, 0);
      x.imageSmoothingEnabled = false;
      x.drawImage(c, 0, 0, srcCv.width, srcCv.height);
      $('#src-label').textContent = 'adjusted image';
      return;
    }
    var im = state.img, W = srcCv.width, H = srcCv.height, s = P.fit === 'cover' ? Math.max(W / im.naturalWidth, H / im.naturalHeight) : Math.min(W / im.naturalWidth, H / im.naturalHeight);
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, (W - im.naturalWidth * s) / 2, (H - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
    $('#src-label').textContent = 'your image';
  }
  $('#toggle-adjusted').addEventListener('click', function () {
    state.adjusted = !state.adjusted;
    this.textContent = state.adjusted ? 'show original' : 'show adjusted';
    drawSource();
  });

  var anim = { raf: 0, i: 0, t0: 0, dur: 8000 };
  function drawTo(n) {
    var r = state.result, x = drawCv.getContext('2d'), sc = drawCv.width / r.W, Q = state.planP, cur = -1;
    x.lineCap = x.lineJoin = 'round';
    x.beginPath();
    for (; anim.i < n; anim.i++) {
      var s = r.strokes[anim.i], p = s.p;
      if (s.er !== cur) {
        if (cur !== -1) { x.stroke(); x.beginPath(); }
        x.strokeStyle = s.er ? '#fff' : '#111';
        x.lineWidth = E.px(Q, r.W, s.er ? Q.esz : Q.pen) * sc;
        cur = s.er;
      }
      x.moveTo((p[0][0] + 0.5) * sc, (p[0][1] + 0.5) * sc);
      for (var j = 1; j < p.length; j++) x.lineTo((p[j][0] + 0.5) * sc, (p[j][1] + 0.5) * sc);
    }
    x.stroke();
  }
  function clearDraw() {
    var r = state.result, sc = Math.max(1, Math.round(880 / Math.max(r.W, r.H)));
    drawCv.width = r.W * sc; drawCv.height = r.H * sc;
    var x = drawCv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, drawCv.width, drawCv.height);
    anim.i = 0;
  }
  function startDrawing(animate) {
    cancelAnimationFrame(anim.raf);
    if (!state.result) return;
    clearDraw();
    var n = state.result.strokes.length;
    if (!animate || !n) { drawTo(n); pen.hidden = true; return; }
    anim.dur = Math.max(4000, Math.min(12000, n / 3));
    anim.t0 = performance.now();
    (function frame(now) {
      var k = Math.min(1, (now - anim.t0) / anim.dur), m = Math.round(k * n);
      drawTo(m);
      var s = state.result.strokes[Math.max(0, m - 1)];
      if (s && k < 1) {
        var q = s.p[s.p.length - 1];
        pen.hidden = false;
        pen.style.left = ((q[0] + 0.5) / state.result.W * 100) + '%';
        pen.style.top = ((q[1] + 0.5) / state.result.H * 100) + '%';
        pen.classList.toggle('is-eraser', !!s.er);
        anim.raf = requestAnimationFrame(frame);
      } else pen.hidden = true;
    })(anim.t0);
  }
  $('#replay').addEventListener('click', function () { startDrawing(true); });
  $('#finish').addEventListener('click', function () {
    cancelAnimationFrame(anim.raf);
    if (!state.result) return;
    drawTo(state.result.strokes.length); pen.hidden = true;
  });
  function setButtons(on) { ['#replay', '#finish', '#download', '#copy'].forEach(function (s) { $(s).disabled = !on; }); }

  /* ---------- script ---------- */

  var scriptTimer = 0, scriptText = '';
  function phoneSettings() { var o = Object.assign({}, Ph); o.rw = +Ph.rw; o.rh = +Ph.rh; return o; }
  function queueScript() { clearTimeout(scriptTimer); scriptTimer = setTimeout(buildScript, 120); }
  function buildScript() {
    var r = state.result;
    if (!r) return;
    var strokes = r.strokes.map(function (s) { var p = s.p.slice(); if (s.er) p.er = 1; return p; });
    scriptText = E.script(strokes, r.W, r.H, phoneSettings());
    $('#script').value = scriptText.length > 400000 ? scriptText.slice(0, 400000) + '\n# … (' + fmtN(scriptText.length) + ' characters; download for the full script)' : scriptText;
    var est = E.estimate(scriptText), sw = 0, last = 0;
    r.strokes.forEach(function (s) { if (s.er !== last) { sw++; last = s.er; } });
    var mins = est.sec / 60, t = mins < 1.5 ? Math.round(est.sec) + ' s' : mins < 90 ? Math.round(mins) + ' min' : (mins / 60).toFixed(1) + ' h';
    $('#summary').innerHTML = '<b>' + fmtN(r.strokes.length) + '</b> strokes · <b>' + sw + '</b> tool switches · about <b>' + t + '</b> on the phone (' + fmtN(est.calls) + ' commands, rough estimate).';
    $('#stats').textContent = fmtN(r.strokes.length) + ' strokes · about ' + t + ' to draw';
    var noButtons = sw && !(+Ph.ex || +Ph.ey) && !(Ph.ex2 || '').trim();
    $('#eraser-note').textContent = sw ? (noButtons ? 'this drawing uses the eraser: set its buttons' : 'this drawing uses the eraser') : '';
    $('#eraser-warn').hidden = !noButtons;
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/x-sh' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function copyText(text, done) {
    var ok = function () { toast(done); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { fallbackCopy(text); ok(); });
    else { fallbackCopy(text); ok(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) {}
    t.remove();
  }
  $('#download').addEventListener('click', function () { if (scriptText) download('draw.sh', scriptText); });
  $('#copy').addEventListener('click', function () { if (scriptText) copyText(scriptText, 'Script copied'); });
  $('#test').addEventListener('click', function () {
    var G = E.grid(P);
    download('switch-test.sh', E.testScript(G.W, G.H, phoneSettings()));
    toast('Run it like draw.sh: expect a line with a gap in it, then a second line');
  });
  $$('[data-copy-cmd]').forEach(function (b) {
    b.addEventListener('click', function () { copyText(b.previousElementSibling.textContent, 'Command copied'); });
  });

  var toastEl = null, toastT = 0;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('is-on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-on'); }, 2600);
  }

  /* ---------- theme ---------- */

  var themeBtn = $('[data-theme-toggle]');
  function paintTheme() {
    var light = document.documentElement.getAttribute('data-theme') === 'light';
    $('[data-theme-label]').textContent = light ? 'dark' : 'light';
    themeBtn.setAttribute('aria-label', 'Switch to ' + (light ? 'dark' : 'light') + ' mode');
    var meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f2f2f2' : '#000000');
  }
  themeBtn.addEventListener('click', function () {
    var light = document.documentElement.getAttribute('data-theme') !== 'light';
    if (light) document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('ncgg:theme', light ? 'light' : 'dark'); } catch (e) {}
    paintTheme();
  });

  paintTheme();
  paintControls();
  paintPhone();
})();
