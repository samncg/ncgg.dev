/* Runs the planner and the auto-match search off the main thread. */
importScripts('engine.js?v=45');

var E = self.StickerEngine, img = null;
function makeCanvas(w, h) { return new OffscreenCanvas(w, h); }

// quick: skip the score (live previews during auto-match only need the strokes)
function planFor(P, quick) {
  var G = E.grid(P), base = E.luminance(img, G.W, G.H, P.fit, makeCanvas);
  var g = E.adjust(base, G.W, G.H, P), r = E.plan(g, G.W, G.H, P);
  var sc = quick ? { match: null } : E.compare(E.rasterize(r.strokes, G.W, G.H, P, makeCanvas, 2), E.inkTarget(base, G.W, G.H, P), G.W, G.H, P);
  // strokes travel as plain arrays plus their flags, so nothing is lost in the copy
  var strokes = r.strokes.map(function (p) { return { p: p.slice(), er: p.er ? 1 : 0, ty: p.ty || 's', dot: p.dot ? 1 : 0, band: p.band, pass: p.pass }; });
  return { W: G.W, H: G.H, g: g, strokes: strokes, gap: r.gap, match: sc.match };
}

onmessage = function (e) {
  var m = e.data;
  try {
    if (m.type === 'image') { img = m.bitmap; postMessage({ type: 'ready', id: m.id }); return; }
    if (!img) throw new Error('no image');
    if (m.type === 'plan') { postMessage({ type: 'planned', id: m.id, result: planFor(m.P, m.quick) }); return; }
    if (m.type === 'match') {
      // the candidate being tried goes to the page at most twice a second, for the live preview
      var tryAt = 0;
      var r = E.autoMatch(img, m.P, {
        makeCanvas: makeCanvas,
        onTry: function (P) {
          // on a fixed half-second beat, so a slow candidate does not push the next update back
          var t = Date.now();
          if (t < tryAt) return;
          tryAt = Math.max(tryAt + 500, t - 250);
          postMessage({ type: 'trying', id: m.id, P: P });
        },
        onProgress: function (pct, best) {
          postMessage({ type: 'progress', id: m.id, pct: pct, match: best ? best.match : null, mode: best ? best.P.mode : null });
        }
      });
      postMessage({ type: 'matched', id: m.id, result: r });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
