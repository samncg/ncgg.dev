/* Runs the planner and the auto-match search off the main thread. */
importScripts('engine.js?v=34');

var E = self.StickerEngine, img = null;
function makeCanvas(w, h) { return new OffscreenCanvas(w, h); }

function planFor(P) {
  var G = E.grid(P), base = E.luminance(img, G.W, G.H, P.fit, makeCanvas);
  var g = E.adjust(base, G.W, G.H, P), r = E.plan(g, G.W, G.H, P);
  var ink = E.rasterize(r.strokes, G.W, G.H, P, makeCanvas, 2);
  var sc = E.compare(ink, E.inkTarget(base, G.W, G.H, P), G.W, G.H, P);
  // strokes travel as plain arrays plus their flags, so nothing is lost in the copy
  var strokes = r.strokes.map(function (p) { return { p: p.slice(), er: p.er ? 1 : 0, ty: p.ty || 's', dot: p.dot ? 1 : 0, band: p.band, pass: p.pass }; });
  return { W: G.W, H: G.H, g: g, strokes: strokes, gap: r.gap, match: sc.match };
}

onmessage = function (e) {
  var m = e.data;
  try {
    if (m.type === 'image') { img = m.bitmap; postMessage({ type: 'ready', id: m.id }); return; }
    if (!img) throw new Error('no image');
    if (m.type === 'plan') { postMessage({ type: 'planned', id: m.id, result: planFor(m.P) }); return; }
    if (m.type === 'match') {
      var r = E.autoMatch(img, m.P, {
        makeCanvas: makeCanvas,
        onProgress: function (pct, best) { postMessage({ type: 'progress', id: m.id, pct: pct, match: best ? best.match : null, mode: best ? best.P.mode : null }); }
      });
      postMessage({ type: 'matched', id: m.id, result: r });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
