(function () {
  'use strict';

  /* ------------------------------------------------------------------
   * EDIT ME: your contact details.
   * ------------------------------------------------------------------ */
  // Set `emailPlaceholder` to false once `email` is your real address;
  // that removes the visible "placeholder" mark under it.
  var CONTACT = {
    email: 'hello@ncgg.dev',
    emailPlaceholder: false,
    github: 'https://github.com/samncg',
    discord: 'ncg_'
  };

  var root = document.documentElement;
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = window.matchMedia('(pointer: coarse)').matches;
  var MONO = '"Azeret Mono", ui-monospace, Menlo, Consolas, monospace';
  var DISPLAY = '"Martian Mono", "Azeret Mono", monospace';
  var STORE_KEY = 'ncgg:motion';

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }

  /* ---------- contact wiring ---------- */

  var mail = $('.contact__mail');
  if (mail) {
    mail.href = 'mailto:' + CONTACT.email;
    mail.setAttribute('data-email', CONTACT.email);
    mail.textContent = CONTACT.email;
  }
  var gh = $('[data-github]');
  if (gh) gh.href = CONTACT.github;
  $$('[data-contact-placeholder="email"]').forEach(function (el) { el.hidden = !CONTACT.emailPlaceholder; });
  var year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());


  /* ---------- split text for per-glyph weight ---------- */

  var weighed = [];
  $$('[data-weigh]').forEach(function (el) {
    var text = el.textContent;
    var vis = document.createElement('span');
    vis.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement('span');
      s.className = 'ch';
      s.textContent = text[i];
      vis.appendChild(s);
    }
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.textContent = '';
    el.appendChild(sr);
    el.appendChild(vis);
    weighed.push({ el: el, chars: $$('.ch', vis), on: false });
  });

  /* ---------- field ---------- */

  var hero = $('.hero');
  var field = null;
  var rx = $('[data-rx]'), ry = $('[data-ry]'), rf = $('[data-rf]');
  function pad(n) { n = Math.max(0, Math.round(n)); return ('0000' + n).slice(-4); }

  var intro = $('.hero__intro');
  var bar = $('.bar');

  function maskBox(W) {
    var heroH = hero ? hero.offsetHeight : window.innerHeight;
    var gut = Math.max(16, Math.min(56, W * 0.04));
    var narrow = W < 720;
    var c = document.createElement('canvas').getContext('2d');
    c.font = '800 100px ' + DISPLAY;
    var m = c.measureText('ncgg');
    var asc = (m.actualBoundingBoxAscent || 62) / 100;
    var desc = (m.actualBoundingBoxDescent || 24) / 100;
    // free band: below the bar, above the intro paragraph
    var top = (bar ? bar.offsetHeight : 64) + (narrow ? 34 : 60);
    var bottom = intro ? intro.offsetTop - (narrow ? 28 : 40) : heroH * 0.75;
    var git = $('.hero__git');
    if (git && !narrow) bottom = Math.min(bottom, git.offsetTop - 32);
    var avail = Math.max(60, bottom - top);
    var lines, fs, x;
    if (narrow) {
      // stacked "nc / gg" so each letter gets enough glyph rows to read on a phone
      var gap = 0.14;
      fs = Math.min((W - gut * 2) * 100 / (c.measureText('nc').width || 150), avail / (2 * (asc + desc) + gap));
      var h = fs * (2 * (asc + desc) + gap);
      var b1 = top + (avail - h) / 2 + fs * asc;
      x = gut - fs * 0.02;
      lines = [
        { text: 'nc', x: x, baseline: b1 },
        { text: 'gg', x: x, baseline: b1 + fs * (asc + desc + gap) }
      ];
    } else {
      fs = Math.min(Math.min(W * 0.64, 1180) * 100 / (m.width || 300), avail / (asc + desc));
      var h1 = fs * (asc + desc);
      lines = [{ text: 'ncgg', x: gut - fs * 0.03, baseline: top + (avail - h1) / 2 + fs * asc }];
    }
    return { lines: lines, fontSize: fs, weight: 800, areaHeight: heroH + 40 };
  }

  /* ---------- theme ---------- */

  var THEMES = {
    dark: { bg: [0, 0, 0], ink: [1, 1, 1], meta: '#000000' },
    light: { bg: [0.949, 0.949, 0.949], ink: [0.04, 0.04, 0.04], meta: '#f2f2f2', mark: true, field: 1.3, floor: 0.32, weight: 600 }
  };
  var themeBtn = $('[data-theme-toggle]');
  var themeMeta = $('meta[name="theme-color"]');
  function currentTheme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function paintTheme() {
    var name = currentTheme(), t = THEMES[name];
    if (field) field.setTheme(t);
    medias.forEach(function (m) { m.setTheme(t); });
    if (themeMeta) themeMeta.setAttribute('content', t.meta);
    drawHeat();
    if (themeBtn) {
      var next = name === 'light' ? 'dark' : 'light';
      $('.theme__label', themeBtn).textContent = next;
      themeBtn.setAttribute('aria-label', 'Switch to ' + next + ' mode');
    }
  }
  function setTheme(name) {
    if (name === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
    store('ncgg:theme', name);
    paintTheme();
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function (e) {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      var canAnimate = document.startViewTransition && !reduceMQ.matches;
      if (!canAnimate) { setTheme(next); return; }
      var r = themeBtn.getBoundingClientRect();
      var x = e.clientX || r.left + r.width / 2, y = e.clientY || r.top + r.height / 2;
      var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      var vt = document.startViewTransition(function () { setTheme(next); });
      vt.ready.then(function () {
        root.animate(
          { clipPath: ['circle(0px at ' + x + 'px ' + y + 'px)', 'circle(' + radius + 'px at ' + x + 'px ' + y + 'px)'] },
          { duration: 760, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', pseudoElement: '::view-transition-new(root)' }
        );
      }).catch(function () {});
    });
  }

  function initField() {
    var canvas = $('#field');
    if (!canvas || !window.AsciiField) return;
    field = new window.AsciiField(canvas, {
      fontFamily: MONO,
      theme: THEMES[currentTheme()],
      maskFont: DISPLAY,
      maskText: 'ncgg',
      maskBox: maskBox,
      onStats: function (s) {
        if (!rx) return;
        rx.textContent = s.x < 0 ? '----' : pad(s.x);
        ry.textContent = s.y < 0 ? '----' : pad(s.y);
        rf.textContent = Math.min(9.99, s.flow).toFixed(2);
      }
    });
    onScroll();
    paintTheme();
    root.classList.add('field-ready');
    applyMotion();
  }

  /* ---------- motion preference ---------- */

  var motionBtn = $('[data-motion]');
  var saved = store(STORE_KEY);
  var motion = saved ? saved === 'on' : !reduceMQ.matches;
  var medias = [];

  function applyMotion() {
    if (motionBtn) {
      motionBtn.setAttribute('aria-pressed', motion ? 'true' : 'false');
      $('.motion__state', motionBtn).textContent = motion ? 'on' : 'off';
      motionBtn.setAttribute('aria-label', motion ? 'Pause background motion' : 'Play background motion');
    }
    root.classList.toggle('still', !motion);
    if (field) {
      if (motion && !document.hidden) field.start(); else field.stop();
    }
    medias.forEach(function (m) { m.setEnabled(motion); });
  }
  if (motionBtn) {
    motionBtn.addEventListener('click', function () {
      motion = !motion;
      store(STORE_KEY, motion ? 'on' : 'off');
      applyMotion();
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (!field) return;
    if (document.hidden) field.stop(); else if (motion) field.start();
  });

  /* ---------- input ---------- */

  window.addEventListener('pointermove', function (e) {
    if (field) field.pointerMove(e.clientX, e.clientY);
    queueWeigh(e.clientX, e.clientY);
  }, { passive: true });
  document.addEventListener('pointerleave', function () { if (field) field.pointerLeave(); });
  window.addEventListener('touchstart', function (e) {
    if (field) { field.pointerLeave(); var t = e.touches[0]; field.pointerMove(t.clientX, t.clientY); }
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (field && t) field.pointerMove(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchend', function () { if (field) field.pointerLeave(); }, { passive: true });


  /* ---------- scroll ---------- */

  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY;
    if (field) {
      var h = hero ? hero.offsetHeight : window.innerHeight;
      field.setDim(1 - 0.5 * Math.min(1, y / h));
      field.scroll(y);
    }
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  window.addEventListener('resize', function () {
    if (field) field.resize();
    medias.forEach(function (m) { m.resize(); });
  });

  /* ---------- per-glyph weight follows the cursor ---------- */

  var wx = -9999, wy = -9999, wPending = false;
  function queueWeigh(x, y) {
    if (coarse) return;
    wx = x; wy = y;
    if (!wPending) { wPending = true; requestAnimationFrame(weigh); }
  }
  function weigh() {
    wPending = false;
    for (var n = 0; n < weighed.length; n++) {
      var w = weighed[n];
      if (!w.on) continue;
      for (var i = 0; i < w.chars.length; i++) {
        var c = w.chars[i];
        var r = c.getBoundingClientRect();
        var dx = r.left + r.width / 2 - wx, dy = r.top + r.height / 2 - wy;
        var f = Math.exp(-(dx * dx + dy * dy) / (2 * 150 * 150));
        c.style.setProperty('--wg', String(Math.round(300 + 500 * f)));
      }
    }
  }
  if ('IntersectionObserver' in window) {
    var wio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        for (var n = 0; n < weighed.length; n++) if (weighed[n].el === en.target) weighed[n].on = en.isIntersecting;
      });
    });
    weighed.forEach(function (w) { wio.observe(w.el); });
  }

  /* ---------- scramble ---------- */

  var POOL = '.:-=+*#%@/\\|~<>[]{}';
  function scramble(el, text) {
    if (el._scr) cancelAnimationFrame(el._scr);
    if (!motion || reduceMQ.matches) { el.textContent = text; return; }
    var start = performance.now(), dur = 420;
    (function tick(now) {
      var p = Math.min(1, (now - start) / dur);
      var out = '';
      for (var i = 0; i < text.length; i++) {
        var reveal = i / text.length < p * 1.15 - 0.1;
        out += reveal || text[i] === ' ' ? text[i] : POOL[(Math.random() * POOL.length) | 0];
      }
      el.textContent = out;
      if (p < 1) el._scr = requestAnimationFrame(tick); else el.textContent = text;
    })(start);
  }
  $$('[data-scramble]').forEach(function (el) {
    var text = el.textContent;
    el.setAttribute('aria-label', text);
    var run = function () { scramble(el, text); };
    el.addEventListener('mouseenter', run);
    el.addEventListener('focus', run);
  });

  /* ---------- practice rows push the field ---------- */

  $$('[data-gust]').forEach(function (row) {
    var glyph = $('.discipline__glyph', row);
    var g = glyph ? glyph.getAttribute('data-glyph') : '';
    row.addEventListener('mouseenter', function (e) {
      var r = row.getBoundingClientRect();
      if (field) {
        field.gust(r.left + 40, r.top + r.height / 2, 16, 0, 70);
        field.gust(e.clientX, r.top + r.height / 2, 10, 0, 60);
      }
      if (glyph) scramble(glyph, g);
    });
  });

  /* ---------- media ---------- */

  function initMedia() {
    if (!window.AsciiMedia) return;
    $$('canvas[data-media]').forEach(function (cv) {
      var mode = cv.getAttribute('data-media');
      var Ctor = mode === 'ftc' && window.FtcMatch ? window.FtcMatch : window.AsciiMedia;
      var m = new Ctor(cv, mode, { fontFamily: MONO, theme: THEMES[currentTheme()] });
      m.setEnabled(motion);
      medias.push(m);
      var fig = cv.closest('.piece');
      if (fig) {
        fig.addEventListener('mouseenter', function () { m.setHover(true); });
        fig.addEventListener('mouseleave', function () { m.setHover(false); });
      }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { m.setVisible(en[0].isIntersecting); }, { rootMargin: '80px' }).observe(cv);
      } else {
        m.setVisible(true);
      }
      if ('ResizeObserver' in window) {
        var first = true;
        new ResizeObserver(function () { if (first) { first = false; return; } m.resize(); }).observe(cv);
      }
    });
  }

  /* ---------- reveal ---------- */

  var reveals = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMQ.matches) {
    var groups = new Map();
    reveals.forEach(function (el) {
      var p = el.parentElement;
      var idx = groups.get(p) || 0;
      groups.set(p, idx + 1);
      el.style.setProperty('--d', Math.min(idx * 0.08, 0.32) + 's');
    });
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); rio.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach(function (el) { rio.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ---------- active nav ---------- */

  var navLinks = $$('.bar__nav a');
  var sectionFor = { top: '', about: 'about', practice: 'about', work: 'work', stack: 'work', contact: 'contact' };
  var sections = $$('main > section');
  var currentNav = null;
  function updateNav() {
    var line = window.innerHeight * 0.4, id = '';
    for (var i = 0; i < sections.length; i++) {
      if (sections[i].getBoundingClientRect().top <= line) id = sectionFor[sections[i].id] || '';
    }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) id = 'contact';
    if (id === currentNav) return;
    currentNav = id;
    navLinks.forEach(function (a) {
      if (id && a.getAttribute('href') === '#' + id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('scroll', updateNav, { passive: true });
  window.addEventListener('resize', updateNav);
  updateNav();

  /* ---------- copy email ---------- */

  var live = $('[data-live]');
  $$('[data-copy]').forEach(function (btn) {
    var label = $('[data-copy-label]', btn);
    var idle = label.textContent;
    var what = btn.getAttribute('data-copy-what') || 'Email address';
    var isDiscord = btn.getAttribute('data-copy') === 'discord';
    var target = isDiscord ? $('[data-discord-name]') : mail;
    var timer = 0;
    btn.addEventListener('click', function () {
      var value = isDiscord ? CONTACT.discord : CONTACT.email;
      var done = function (ok) {
        label.textContent = ok ? 'copied' : 'selected, copy it';
        btn.setAttribute('data-state', ok ? 'done' : 'fail');
        if (live) live.textContent = ok ? what + ' copied to clipboard.' : 'Copy failed. Select the text to copy it.';
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = idle; btn.removeAttribute('data-state'); }, 2200);
        if (!ok && target) {
          var sel = window.getSelection(), range = document.createRange();
          range.selectNodeContents(target); sel.removeAllRanges(); sel.addRange(range);
        }
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
      } else done(false);
    });
  });

  /* ---------- contribution heatmap (public calendar via github-contributions-api, cached 1 h) ---------- */

  var drawHeat = function () {};
  (function () {
    var cv = $('[data-heat]'), cap = $('[data-heat-cap]');
    if (!cv || !cap || !window.fetch) return;
    var KEY = 'ncgg:heat', TTL = 60 * 60 * 1000, days = null, total = 0, cells = [];
    var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    function summary() { cap.textContent = total + ' contributions in the last year'; }
    drawHeat = function () {
      if (!days) return;
      var r = cv.getBoundingClientRect();
      if (!r.width) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var first = new Date(days[0].date + 'T00:00:00').getDay();
      var weeks = Math.ceil((days.length + first) / 7);
      var gap = r.width < 420 ? 1 : 2;
      var cell = Math.max(2.5, (r.width - gap * (weeks - 1)) / weeks);
      var h = cell * 7 + gap * 6;
      cv.style.height = h + 'px';
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(h * dpr);
      var ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var cs = getComputedStyle(root);
      var fg = cs.getPropertyValue('--fg-rgb').trim().split(/\s+/).join(',');
      var line = cs.getPropertyValue('--line-2').trim();
      var ALPHA = [0, 0.28, 0.5, 0.75, 1];
      var offset = 0;
      cells = [];
      days.forEach(function (d, i) {
        var k = i + first, x = offset + Math.floor(k / 7) * (cell + gap), y = (k % 7) * (cell + gap);
        ctx.fillStyle = d.level ? 'rgba(' + fg + ',' + ALPHA[d.level] + ')' : line;
        ctx.fillRect(x, y, cell, cell);
        cells.push({ x: x, y: y, s: cell, d: d });
      });
    };
    cv.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        if (mx >= c.x && mx < c.x + c.s + 2 && my >= c.y && my < c.y + c.s + 2) {
          var dt = new Date(c.d.date + 'T00:00:00');
          cap.textContent = c.d.count + (c.d.count === 1 ? ' contribution' : ' contributions') + ' on ' + dt.getDate() + ' ' + MONTHS[dt.getMonth()] + ' ' + dt.getFullYear();
          return;
        }
      }
      summary();
    });
    cv.addEventListener('mouseleave', function () { if (days) summary(); });
    window.addEventListener('resize', function () { drawHeat(); });

    function use(data) {
      days = data.contributions; total = data.total;
      cv.setAttribute('aria-label', 'GitHub contribution heatmap: ' + total + ' contributions in the last year');
      summary(); drawHeat();
    }
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.days && Date.now() - cached.at < TTL) { use({ contributions: cached.days, total: cached.total }); return; }
    fetch('https://github-contributions-api.jogruber.de/v4/samncg?y=last')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        var list = (d.contributions || []).map(function (c) { return { date: c.date, count: c.count, level: c.level }; });
        var tot = d.total && (d.total.lastYear != null ? d.total.lastYear : 0);
        if (!list.length) throw new Error('empty');
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), days: list, total: tot })); } catch (e) {}
        use({ contributions: list, total: tot });
      })
      .catch(function () {
        if (cached && cached.days) use({ contributions: cached.days, total: cached.total });
        else { cv.hidden = true; cap.textContent = 'contribution graph unavailable right now'; }
      });
  })();

  /* ---------- recent public commits (GitHub REST, cached 15 min) ---------- */

  (function () {
    var log = $('[data-git-log]');
    if (!log || !window.fetch) return;
    var USER = 'samncg', KEY = 'ncgg:commits', TTL = 15 * 60 * 1000;
    function age(iso) {
      var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm';
      if (s < 86400) return Math.round(s / 3600) + 'h';
      if (s < 86400 * 30) return Math.round(s / 86400) + 'd';
      if (s < 86400 * 365) return Math.round(s / (86400 * 30)) + 'mo';
      return Math.round(s / (86400 * 365)) + 'y';
    }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function render(list) {
      log.textContent = '';
      if (!list.length) { log.appendChild(el('li', 'hero__git-note', 'no public commits yet')); return; }
      list.slice(0, 4).forEach(function (c, i) {
        var li = el('li', 'is-new');
        li.style.setProperty('--d', (i * 0.09) + 's');
        var a = el('a');
        a.href = c.url; a.target = '_blank'; a.rel = 'noopener';
        a.setAttribute('aria-label', c.repo + ': ' + c.msg + ', ' + age(c.date) + ' ago');
        a.appendChild(el('span', 'hero__git-sha', c.sha));
        a.appendChild(el('span', 'hero__git-repo', c.repo));
        a.appendChild(el('span', 'hero__git-msg', c.msg));
        a.appendChild(el('span', 'hero__git-age', age(c.date)));
        li.appendChild(a);
        log.appendChild(li);
      });
    }
    function fail() {
      log.textContent = '';
      log.appendChild(el('li', 'hero__git-note', 'commits unavailable right now'));
    }
    var cached = null;
    try { cached = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.list && Date.now() - cached.at < TTL) { render(cached.list); return; }
    function get(url) {
      return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
    }
    get('https://api.github.com/users/' + USER + '/repos?sort=pushed&per_page=6&type=owner')
      .then(function (repos) {
        repos = repos.filter(function (r) { return !r.fork; }).slice(0, 3);
        return Promise.all(repos.map(function (r) {
          return get('https://api.github.com/repos/' + r.full_name + '/commits?per_page=3').then(function (cs) {
            return cs.map(function (c) {
              return { repo: r.name, sha: c.sha.slice(0, 7), msg: (c.commit.message || '').split('\n')[0],
                date: (c.commit.author || c.commit.committer || {}).date, url: c.html_url };
            });
          }, function () { return null; });
        }));
      })
      .then(function (groups) {
        var failed = groups.some(function (g) { return g === null; });
        var list = [].concat.apply([], groups.filter(Boolean)).filter(function (c) { return c.date; });
        if (!list.length && failed) throw new Error('rate limited');
        list.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
        list = list.slice(0, 4);
        try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), list: list })); } catch (e) {}
        render(list);
      })
      .catch(function () { if (cached && cached.list) render(cached.list); else fail(); });
  })();

  /* ---------- photo drawer ---------- */

  function initDrawer(d) {
    if (!d || typeof d.showModal !== 'function') return;
    var opener = null;
    var items = $$('.gallery__item', d);
    var viewer = $('.viewer', d);
    var vImg = null, vCap = $('.viewer__caption', d);
    function ensureImg() {
      if (vImg) return vImg;
      vImg = document.createElement('img');
      vImg.className = 'viewer__img';
      vImg.decoding = 'async';
      viewer.insertBefore(vImg, viewer.firstChild);
      return vImg;
    }
    var current = -1;

    function show(i) {
      current = (i + items.length) % items.length;
      var it = items[current], thumb = $('img', it);
      ensureImg().src = it.getAttribute('data-full');
      vImg.alt = thumb ? thumb.alt : '';
      vCap.textContent = (current + 1) + ' / ' + items.length + '  ' + ($('span', it) ? $('span', it).textContent : '');
      if (viewer.hidden) { viewer.hidden = false; $('[data-viewer="close"]', viewer).focus(); }
    }
    function hideViewer() {
      if (viewer.hidden) return;
      viewer.hidden = true;
      if (items[current]) items[current].focus();
    }
    function close() {
      if (!d.open) return;
      if (reduceMQ.matches) { d.close(); return; }
      d.classList.add('is-closing');
      setTimeout(function () { d.classList.remove('is-closing'); d.close(); }, 420);
    }

    $$('[data-drawer-open="' + d.id + '"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        opener = btn;
        viewer.hidden = true;
        d.showModal();
        root.classList.add('drawer-open');
        var first = $('[data-drawer-close]', d);
        if (first) first.focus();
      });
    });
    items.forEach(function (it, i) { it.addEventListener('click', function () { show(i); }); });
    $$('[data-viewer]', d).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-viewer');
        if (a === 'prev') show(current - 1); else if (a === 'next') show(current + 1); else hideViewer();
      });
    });
    $$('[data-drawer-close]', d).forEach(function (b) { b.addEventListener('click', close); });
    d.addEventListener('cancel', function (e) {
      e.preventDefault();
      if (!viewer.hidden) hideViewer(); else close();
    });
    d.addEventListener('click', function (e) { if (e.target === d) close(); });
    d.addEventListener('keydown', function (e) {
      if (viewer.hidden) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(current - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); show(current + 1); }
    });
    d.addEventListener('close', function () {
      root.classList.remove('drawer-open');
      viewer.hidden = true;
      if (opener) opener.focus();
    });
  }
  $$('dialog.drawer').forEach(initDrawer);

  /* ---------- boot after fonts ---------- */

  function boot() {
    initField();
    initMedia();
  }
  var fontsReady = document.fonts && document.fonts.load
    ? Promise.all([
        document.fonts.load('400 13px "Azeret Mono"'),
        document.fonts.load('800 100px "Martian Mono"')
      ])
    : Promise.resolve();
  var booted = false;
  function once() { if (!booted) { booted = true; boot(); } }
  fontsReady.then(once, once);
  setTimeout(once, 2500);
})();
