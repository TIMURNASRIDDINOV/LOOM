import { REF_RECT, TEX_SIZE, type SceneDesign } from './print'
import { DRAW_ELEMENT_JS, FONTS_CSS, SITE_ORIGIN } from './scene-html'

// Front and back mockups for the admin (LOOM-163), drawn the way the flat stage
// shows the garment: the web's flat garment art tinted to the shirt colour, the
// layers painted by the same drawElement as the 3D scene. It runs in a hidden
// page (a WebView on a phone, an iframe on Expo web) because React Native has
// no canvas; the page's origin is SITE_ORIGIN, so the garment art is same-origin
// and the canvas can be exported.

/** The web configurator's flat garment (configurator.js FLAT_ART). */
const GARMENT_URL = `${SITE_ORIGIN}/configuratorprodutcs/tshirt_flat_white_1200.png`

/** Mockup side, px. Small enough that a cart of them fits in AsyncStorage. */
export const MOCKUP_PX = 720

export type MockupRequest = {
  design: SceneDesign
  /** Print rect in mockup px, from the flat stage's geometry. */
  rect: { x: number; y: number; w: number; h: number }
  size: number
}

/** JPEG data URLs, or null for a side that could not be drawn. */
export type Mockups = { front: string | null; back: string | null }

export const NO_MOCKUPS: Mockups = { front: null, back: null }

/** Never let a stuck page hold up add-to-cart: past `ms`, go on without mockups. */
export function withTimeout(p: Promise<Mockups>, ms = 6000): Promise<Mockups> {
  return Promise.race([p, new Promise<Mockups>((resolve) => setTimeout(() => resolve(NO_MOCKUPS), ms))])
}

export function buildMockupHtml(): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<link rel="stylesheet" href="${FONTS_CSS}">` +
    '</head><body><script>' +
    'window.__LOOM_CFG=' +
    JSON.stringify({ TEX_SIZE, REF_RECT, GARMENT_URL }) +
    ';' +
    MOCKUP_JS +
    '</script></body></html>'
  )
}

const MOCKUP_JS = String.raw`
(function () {
  var CFG = window.__LOOM_CFG;
  var TEX = CFG.TEX_SIZE, REF = CFG.REF_RECT;
  var images = {};

  function post(m) {
    var s = JSON.stringify(m);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
    else if (window.parent && window.parent !== window) window.parent.postMessage(s, '*');
  }
  function load(src) {
    return new Promise(function (res) {
      var i = new Image();
      if (!/^data:/.test(src)) i.crossOrigin = 'anonymous';
      i.onload = function () { res(i); };
      i.onerror = function () { res(null); };
      i.src = src;
    });
  }
  var garment = load(CFG.GARMENT_URL);

  ${DRAW_ELEMENT_JS}

  function drawFace(art, els, color, rect, S) {
    var c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d');
    g.fillStyle = '#F2F0EB'; // JPEG has no alpha; a white garment needs a ground
    g.fillRect(0, 0, S, S);
    if (art) {
      // White art with soft shading: multiply keeps the folds, destination-in
      // restores the cut-out (configurator.js _flatGarmentLayer).
      var t = document.createElement('canvas'); t.width = t.height = S;
      var tg = t.getContext('2d');
      tg.drawImage(art, 0, 0, S, S);
      if (String(color).toUpperCase() !== '#FFFFFF') {
        tg.globalCompositeOperation = 'multiply'; tg.fillStyle = color; tg.fillRect(0, 0, S, S);
        tg.globalCompositeOperation = 'destination-in'; tg.drawImage(art, 0, 0, S, S);
      }
      g.drawImage(t, 0, 0);
    }
    (els || []).forEach(function (el) { drawElement(g, el, rect); });
    return c.toDataURL('image/jpeg', 0.82);
  }

  window.__loomRender = function (req) {
    var d = req.design, els = (d.front || []).concat(d.back || []);
    var waits = [garment];
    els.forEach(function (el) {
      if (el.type === 'image' && el.src) waits.push(load(el.src).then(function (i) { if (i) images[el.src] = i; }));
      if (el.type === 'text' && document.fonts) waits.push(document.fonts.load('bold 40px "' + el.font + '"').catch(function () {}));
    });
    Promise.all(waits).then(function (r) {
      post({
        type: 'mockups', id: req.id,
        front: drawFace(r[0], d.front, d.shirtColor, req.rect, req.size),
        back: drawFace(r[0], d.back, d.shirtColor, req.rect, req.size)
      });
    }).catch(function () { post({ type: 'mockups', id: req.id, front: null, back: null }); });
  };
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch (_) { return; } }
    if (m && m.type === 'render') window.__loomRender(m);
  });
  post({ type: 'ready' });
})();
`

/** What the studio holds: one call per add-to-cart. */
export type MockupRendererHandle = { render: (req: MockupRequest) => Promise<Mockups> }

/** Shared reply bookkeeping for the native and web hosts. */
export function mockupBridge() {
  const pending = new Map<number, (m: Mockups) => void>()
  let seq = 0
  return {
    ready: false,
    /** Queue a request; `send` delivers it to the page. */
    request(req: MockupRequest, send: (msg: string) => void): Promise<Mockups> {
      if (!this.ready) return Promise.resolve(NO_MOCKUPS)
      const id = ++seq
      const p = new Promise<Mockups>((resolve) => pending.set(id, resolve))
      send(JSON.stringify({ ...req, type: 'render', id }))
      return withTimeout(p)
    },
    /** Handle a message from the page. */
    receive(data: unknown) {
      let m: { type?: string; id?: number; front?: string | null; back?: string | null }
      try {
        m = typeof data === 'string' ? JSON.parse(data) : (data as typeof m)
      } catch {
        return
      }
      if (m?.type === 'ready') this.ready = true
      if (m?.type === 'mockups' && typeof m.id === 'number') {
        pending.get(m.id)?.({ front: m.front ?? null, back: m.back ?? null })
        pending.delete(m.id)
      }
    },
  }
}
