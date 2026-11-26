/* MarsevTech — client pitch engine + immersive motion layer
   Vanilla ES modules. No build step. The only runtime dependency is <model-viewer>, loaded after first render.

   Flow: read ?client= → validate slug → fetch pitches/{slug}.json (fallback default.json)
         → normalize config → render hero, showroom, pricing, footer → wire WhatsApp links → start motion. */

const PITCH_DIR = 'pitches/';
const DEFAULT_SLUG = 'default';
const FALLBACK_WA_NUMBER = '923000000000';          // https://wa.me/923000000000
const FALLBACK_EMAIL = 'contact@example.com';        // placeholder until the real address is configured in JSON
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;    // lowercase letters, digits and hyphens only
const CURRENCIES = ['PKR', 'USD'];
const SILHOUETTES = ['sofa', 'chair', 'table', 'bed', 'box'];
const MODEL_VIEWER_URL = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Pinned Meshopt decoder. model-viewer 3.5 does not decode EXT_meshopt_compression unless this is set. It is only
// downloaded when a Meshopt-compressed GLB (designer-sofa, egg-lounge-chair) is actually loaded.
const MESHOPT_DECODER_URL = 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.20.0/meshopt_decoder.js';

/**
 * Loads <model-viewer> once, on demand: on the first sign of engagement or when a product card nears the
 * viewport. It is ~935 KB of JavaScript (it bundles three.js), so it never loads during the initial page load.
 * Resolves true when the custom element is ready, false if the script could not load.
 */
let viewerPromise = null;
function ensureModelViewer() {
  if (!viewerPromise) {
    viewerPromise = import(MODEL_VIEWER_URL)
      .then(() => {
        const El = customElements.get('model-viewer');
        if (El) El.meshoptDecoderLocation = MESHOPT_DECODER_URL; // must happen before any viewer starts loading
        return !!El;
      })
      .catch((err) => { console.warn('model-viewer failed to load', err); return false; });
  }
  return viewerPromise;
}

/** Runs fn once, on the first sign of engagement (pointer, touch, key, scroll), when the main thread is idle. */
function whenEngaged(fn) {
  const events = ['pointermove', 'pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    events.forEach((e) => window.removeEventListener(e, go));
    if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1200 }); else setTimeout(fn, 150);
  };
  events.forEach((e) => window.addEventListener(e, go, { passive: true }));
}

const idleTask = (fn, ms) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 60));
/** Idle flourishes have a cost: auto-rotate and the looping "drag me" prompt keep model-viewer re-rendering every
 *  frame, which measured as a constant stream of long tasks even with nobody touching the page. Show them for a few
 *  seconds after the model appears, then let the viewer go fully idle. Dragging, zooming and AR are unaffected. */
const IDLE_FLOURISH_MS = 9000;
function limitIdleFlourishes(viewer) {
  viewer.addEventListener('load', () => setTimeout(() => {
    viewer.setAttribute('interaction-prompt', 'none'); // auto-rotate keeps going; only the looping hint stops
  }, IDLE_FLOURISH_MS), { once: true });
}

const timeout = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

const $ = (sel, root = document) => root.querySelector(sel);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = () => !!(navigator.connection && navigator.connection.saveData);

/* ------------------------------------------------------------------ */
/* Small DOM helpers. All config text goes through textContent, never innerHTML. */
/* ------------------------------------------------------------------ */
function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') node.append(kid);
  return node;
}

function svg(markup, size = 18) {
  // markup is developer-authored (never config data)
  const wrap = document.createElementNS(SVG_NS, 'svg');
  wrap.setAttribute('viewBox', '0 0 24 24');
  wrap.setAttribute('width', size);
  wrap.setAttribute('height', size);
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = markup;
  return wrap;
}

const ICON_CHECK = '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ICON_AR = '<path d="M12 2.5l8 4.3v8.4l-8 4.3-8-4.3V6.8z M12 11l8-4.2M12 11L4 6.8M12 11v8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>';

/* ------------------------------------------------------------------ */
/* 4.1 Client detection and slug validation                            */
/* ------------------------------------------------------------------ */

/**
 * Returns a safe slug from ?client=, or null.
 * URLSearchParams already percent-decodes, so "%2e%2e%2f" arrives as "../" and fails the pattern.
 * A double-encoded value ("%252e") keeps its "%" and also fails. Nothing else reaches fetch().
 */
function getClientSlug() {
  const raw = new URLSearchParams(window.location.search).get('client');
  if (raw == null) return null;
  const slug = raw.trim().toLowerCase();
  return SLUG_PATTERN.test(slug) ? slug : null;
}

/** Fetch and validate one pitch file. Re-validates the slug so the path can never be built from unchecked input. */
async function loadPitch(slug) {
  if (!SLUG_PATTERN.test(slug)) throw new Error('Invalid slug');
  const res = await fetch(`${PITCH_DIR}${slug}.json`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Pitch "${slug}" returned HTTP ${res.status}`);
  const raw = await res.json(); // throws if a dev server answered with an HTML fallback page
  if (!raw || typeof raw !== 'object' || !raw.hero || !Array.isArray(raw.models)) {
    throw new Error(`Pitch "${slug}" has an unexpected shape`);
  }
  return normalizeConfig(raw);
}

/* ---------- Config normalization: never trust JSON shape ---------- */
const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function normalizeColors(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((c) => {
    const rgba = c && Array.isArray(c.rgba) ? c.rgba.map(Number) : [];
    if (rgba.length === 3) rgba.push(1);
    const valid = rgba.length === 4 && rgba.every((n) => Number.isFinite(n) && n >= 0 && n <= 1);
    // Optional display color (#rrggbb) for textured materials, where the factor multiplies a texture and the swatch
    // should show the resulting look rather than the raw factor.
    const swatch = /^#[0-9a-f]{6}$/i.test(str(c.swatch)) ? str(c.swatch) : '';
    return valid && str(c.name) ? [{ name: str(c.name), rgba, swatch }] : [];
  });
}

function normalizeMaterialIndices(v) {
  const list = (Array.isArray(v) ? v : [v]).filter((n) => Number.isInteger(n) && n >= 0);
  return list.length ? [...new Set(list)] : [0];
}

function normalizeModel(m, i) {
  const d = m.dimensions || {};
  const dims = ['width', 'depth', 'height'].map((k) => num(d[k]));
  return {
    id: str(m.id, `product-${i + 1}`).replace(/[^a-z0-9-]/gi, '-'),
    title: str(m.title, `Product ${i + 1}`),
    description: str(m.description),
    src: str(m.src),
    alt: str(m.alt, `${str(m.title, 'Furniture')} 3D model`),
    silhouette: SILHOUETTES.includes(m.silhouette) ? m.silhouette : 'box',
    dimensions: dims.every((v) => v !== null) ? { w: dims[0], d: dims[1], h: dims[2], unit: str(d.unit, 'cm') } : null,
    ar: m.ar !== false,
    colors: normalizeColors(m.colors),
    // Which material(s) the swatches recolor: an index or a list of indices (default: first material).
    materialIndices: normalizeMaterialIndices(m.materialIndex),
    colorLabel: str(m.colorLabel, 'Color'),   // what the swatches change, e.g. "Upholstery"
    colorNote: str(m.colorNote),              // shown instead of swatches when a model can't be recolored
  };
}

function normalizePackage(p, i) {
  const prices = {};
  for (const cur of CURRENCIES) {
    const entry = (p.prices && p.prices[cur]) || {};
    prices[cur] = { setup: num(entry.setup) || null, monthly: num(entry.monthly) || null }; // 0 / missing → "no price"
  }
  return {
    id: str(p.id, `plan-${i + 1}`),
    name: str(p.name, `Package ${i + 1}`),
    skuLabel: str(p.skuLabel),
    description: str(p.description),
    featured: p.featured === true,
    badge: str(p.badge, 'Most Popular'),
    features: Array.isArray(p.features) ? p.features.map((f) => str(f)).filter(Boolean) : [],
    prices,
  };
}

function normalizeConfig(raw) {
  const client = raw.client || {};
  const hero = raw.hero || {};
  const pricing = raw.pricing || {};
  const waNumber = String((raw.whatsapp && raw.whatsapp.number) || '').replace(/\D/g, '');
  const email = str(raw.contact && raw.contact.email);
  const heroModel = hero.model && typeof hero.model === 'object' ? hero.model : {};
  return {
    client: {
      slug: str(client.slug, DEFAULT_SLUG),
      brandName: str(client.brandName),
      isCustomPitch: client.isCustomPitch === true,
    },
    hero: {
      badge: str(hero.badge),
      headline: str(hero.headline),
      subheadline: str(hero.subheadline),
      cta: str(hero.cta),
      secondaryCta: str(hero.secondaryCta),
      // Optional GLB for the hero. Without it (or if it fails to load) the CSS-built sofa stays.
      model: str(heroModel.src) ? { src: str(heroModel.src), alt: str(heroModel.alt, 'Featured furniture 3D model') } : null,
    },
    whatsapp: {
      number: waNumber.length >= 8 && waNumber.length <= 15 ? waNumber : FALLBACK_WA_NUMBER,
      message: str(raw.whatsapp && raw.whatsapp.message),
    },
    email: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : FALLBACK_EMAIL,
    models: raw.models.filter((m) => m && typeof m === 'object').map(normalizeModel),
    pricing: {
      currency: CURRENCIES.includes(pricing.currency) ? pricing.currency : 'PKR',
      note: str(pricing.note),
      packages: Array.isArray(pricing.packages) ? pricing.packages.filter(Boolean).map(normalizePackage) : [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* 4.3 WhatsApp                                                         */
/* ------------------------------------------------------------------ */

/** One client-aware message for every CTA; `extra` adds package context. Always URL-encoded. */
function buildWhatsAppUrl(cfg, extra = '') {
  const brand = cfg.client.brandName;
  const base = cfg.whatsapp.message
    ? cfg.whatsapp.message.replace(/\{brand\}/g, brand)
    : cfg.client.isCustomPitch && brand
      ? `Hi MarsevTech! I'm interested in the 3D and AR furniture visualization proposal prepared for ${brand}. I'd like to discuss a free demo.`
      : "Hi MarsevTech! I'm interested in 3D and AR furniture visualization. I'd like to discuss a free demo.";
  return `https://wa.me/${cfg.whatsapp.number}?text=${encodeURIComponent(extra ? `${base} ${extra}` : base)}`;
}

function wireWhatsApp(cfg) {
  const url = buildWhatsAppUrl(cfg);
  document.querySelectorAll('a[data-wa]:not([data-wa-extra])').forEach((a) => { a.href = url; });
}

/* ------------------------------------------------------------------ */
/* Page text                                                            */
/* ------------------------------------------------------------------ */

/** Wraps each word so CSS can reveal the headline word by word. The text stays one readable sentence. */
function splitWords(el, text) {
  el.replaceChildren();
  text.split(/\s+/).forEach((word, i, all) => {
    el.append(h('span', { class: 'w' }, h('span', { class: 'wi', style: `--i:${i}`, text: word })));
    if (i < all.length - 1) el.append(' ');
  });
}

function renderPage(cfg) {
  const { hero, client } = cfg;
  if (hero.badge) $('#hero-badge').textContent = hero.badge;
  // The default headline is already split in the HTML; only rebuild it when the pitch changes the text.
  const titleEl = $('#hero-title');
  if (hero.headline && hero.headline !== titleEl.textContent.trim()) splitWords(titleEl, hero.headline);
  if (hero.subheadline) $('#hero-sub').textContent = hero.subheadline;
  if (hero.cta) $('#hero-cta-wa').textContent = hero.cta;
  if (hero.secondaryCta) $('#hero-cta-scroll').textContent = hero.secondaryCta;

  if (client.isCustomPitch && client.brandName) {
    document.title = `MarsevTech for ${client.brandName} | 3D & AR Furniture Visualization`;
    // Private sales proposals should not be indexed.
    document.head.append(h('meta', { name: 'robots', content: 'noindex, nofollow' }));
    const note = $('#disclaimer');
    note.textContent = `This proposal was prepared by MarsevTech for ${client.brandName}. ${client.brandName} is not affiliated with or endorsing MarsevTech.`;
    note.hidden = false;
  }

  const mail = $('#footer-email');
  mail.href = `mailto:${cfg.email}`;
  mail.textContent = cfg.email;
  $('#year').textContent = new Date().getFullYear();
  if (cfg.pricing.note) $('#pricing-note').textContent = cfg.pricing.note;
}

/* ------------------------------------------------------------------ */
/* CSS-built 3D furniture. Real 3D (preserve-3d + perspective), no WebGL.  */
/* Used as the hero centerpiece and as the polished fallback / loading     */
/* visual while a GLB is missing or still loading.                         */
/* ------------------------------------------------------------------ */

// Each box: [width, height, depth, x, y(up from floor), z, material]; units are px at scale 1.
const OBJECTS = {
  sofa: { fit: 1, boxes: [
    [10, 16, 10, -125, 8, 38, 'wood'], [10, 16, 10, 125, 8, 38, 'wood'], [10, 16, 10, -125, 8, -38, 'wood'], [10, 16, 10, 125, 8, -38, 'wood'],
    [240, 26, 100, 0, 29, 0, 'fabric'],
    [112, 18, 84, -57, 51, 6, 'fabric'], [112, 18, 84, 57, 51, 6, 'fabric'],
    [292, 60, 26, 0, 72, -37, 'fabric'],
    [108, 40, 18, -57, 80, -14, 'fabric'], [108, 40, 18, 57, 80, -14, 'fabric'],
    [26, 50, 100, -133, 41, 0, 'fabric'], [26, 50, 100, 133, 41, 0, 'fabric'],
  ] },
  chair: { fit: 2.3, boxes: [
    [8, 22, 8, -26, 11, 24, 'wood'], [8, 22, 8, 26, 11, 24, 'wood'], [8, 22, 8, -26, 11, -24, 'wood'], [8, 22, 8, 26, 11, -24, 'wood'],
    [66, 12, 66, 0, 28, 0, 'fabric'], [58, 10, 58, 0, 39, 2, 'fabric'],
    [66, 56, 10, 0, 62, -28, 'fabric'],
  ] },
  table: { fit: 1.45, boxes: [
    [10, 40, 10, -80, 20, 38, 'wood'], [10, 40, 10, 80, 20, 38, 'wood'], [10, 40, 10, -80, 20, -38, 'wood'], [10, 40, 10, 80, 20, -38, 'wood'],
    [160, 6, 70, 0, 14, 0, 'wood'],
    [190, 10, 100, 0, 45, 0, 'fabric'],
  ] },
  bed: { fit: 1.25, boxes: [
    [10, 14, 10, -88, 7, 118, 'wood'], [10, 14, 10, 88, 7, 118, 'wood'], [10, 14, 10, -88, 7, -118, 'wood'], [10, 14, 10, 88, 7, -118, 'wood'],
    [190, 16, 250, 0, 22, 0, 'wood'],
    [180, 22, 240, 0, 41, 2, 'fabric'],
    [190, 74, 14, 0, 63, -124, 'fabric'],
    [64, 12, 34, -46, 58, -92, 'fabric'], [64, 12, 34, 46, 58, -92, 'fabric'],
  ] },
  box: { fit: 2, boxes: [[80, 80, 80, 0, 40, 0, 'fabric']] },
};
const FACES = ['front', 'back', 'right', 'left', 'top']; // the camera looks from above, so bottom faces are never seen

/** anim: 'spin' (full slow rotation) or 'sway' (gentle ±28° turn). Colors come from --fabric / --wood on any ancestor. */
function buildObject(type, anim = 'sway') {
  const def = OBJECTS[type] || OBJECTS.box;
  const spin = h('div', { class: `spin spin--${anim}` });
  for (const [w, hh, d, x, y, z, mat] of def.boxes) {
    const box = h('div', { class: `bx bx--${mat}` }, FACES.map((f) => h('i', { class: `f f-${f}` })));
    box.style.cssText = `--w:${w}px;--h:${hh}px;--d:${d}px;transform:translate3d(${x}px,${-y}px,${z}px)`;
    spin.append(box);
  }
  const anchor = h('div', { class: 'anchor', style: `--fit:${def.fit}` },
    h('div', { class: 'bob' }, h('div', { class: 'tilt' }, spin)));
  return anchor;
}

/** glTF base colors are linear; CSS wants sRGB. Convert so a swatch looks like the model will. */
function linearToCss([r, g, b]) {
  const enc = (c) => Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
  return `rgb(${enc(r)} ${enc(g)} ${enc(b)})`;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                 */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 5. Showroom: model cards, model-viewer, color switching              */
/* ------------------------------------------------------------------ */

const mountObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        mountObserver.unobserve(entry.target);
        entry.target.__mount();
      }
    }, { rootMargin: '300px 0px' }) // start fetching a little before the card scrolls into view
  : null;

function renderModels(models) {
  const grid = $('#model-grid');
  if (!models.length) { $('#model-empty').hidden = false; return; }
  const frag = document.createDocumentFragment();
  models.forEach((m, i) => frag.append(createModelCard(m, i)));
  grid.append(frag);
}

function createModelCard(model) {
  // Per-card state keeps every product's colors independent.
  const state = { model, viewer: null, ready: false, selected: -1, unsupported: false };

  const stage = h('div', { class: 'stage live', dataset: { state: 'idle' } });
  const scene = h('div', { class: 'scene' }); // the CSS object is built lazily in __mount, only near the viewport
  const loading = h('div', { class: 'stage__loading' }, h('div', { class: 'boot__spinner' }), h('span', { text: 'Loading 3D model…' }));
  const saver = h('div', { class: 'stage__saver' },
    h('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Load 3D model' }));
  const placeholder = h('div', { class: 'placeholder' },
    h('p', { class: 'placeholder__title', text: model.title }),
    h('p', { class: 'placeholder__msg', text: '3D model preview coming soon. Add the corresponding GLB file to the models folder.' }));
  stage.append(h('div', { class: 'floor' }), scene, loading, saver, placeholder);

  const arStatus = h('span', { class: 'ar-status', text: 'AR on compatible phones' });
  const swatchLabel = h('p', { class: 'swatches__label' }, `${model.colorLabel}: `, h('strong', { text: 'Original' }));
  const swatchWrap = h('div', { class: 'swatches', role: 'group', 'aria-label': `${model.title} colors` }, swatchLabel);

  model.colors.forEach((color, ci) => {
    const btn = h('button', {
      class: 'swatch swatch--dark', type: 'button', title: color.name,
      'aria-label': `${color.name} for ${model.title}`, 'aria-pressed': 'false',
    });
    btn.style.setProperty('--sw', color.swatch || linearToCss(color.rgba));
    btn.addEventListener('click', () => selectColor(ci));
    swatchWrap.append(btn);
  });

  const info = h('div', { class: 'piece__info' },
    h('h3', { class: 'piece__title', text: model.title }),
    model.description && h('p', { class: 'piece__desc', text: model.description }),
    model.dimensions && h('div', { class: 'dimline', role: 'img', 'aria-label': `Dimensions: width ${model.dimensions.w}, depth ${model.dimensions.d}, height ${model.dimensions.h} ${model.dimensions.unit}` },
      h('span', { 'aria-hidden': 'true', text: `W ${model.dimensions.w} × D ${model.dimensions.d} × H ${model.dimensions.h} ${model.dimensions.unit}` })),
    model.colors.length ? swatchWrap : (model.colorNote ? h('p', { class: 'swatches__note', text: model.colorNote }) : null),
    h('div', { class: 'piece__foot' }, model.ar ? arStatus : h('span'), h('span', { class: 'hint', text: 'Drag to rotate • Pinch to zoom • Tap AR icon on your phone' })));

  const card = h('article', { class: 'card piece reveal', 'aria-label': model.title }, stage, info);

  /* ----- Color switching ----- */
  function selectColor(ci) {
    state.selected = ci;
    swatchWrap.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-pressed', String(i === ci)));
    const nameEl = swatchLabel.querySelector('strong');
    if (nameEl) nameEl.textContent = model.colors[ci].name;
    stage.style.setProperty('--fabric', model.colors[ci].swatch || linearToCss(model.colors[ci].rgba)); // recolors the CSS fallback object
    applyColor(); // if the model hasn't loaded yet, this is re-run from the load handler
  }

  /** Writes the base color factor of ONE material. Not a texture swap; textured materials are tinted by multiplication. */
  function applyColor() {
    if (!state.ready || state.selected < 0 || state.unsupported) return;
    try {
      const materials = state.viewer.model && state.viewer.model.materials;
      if (!materials || !materials.length) throw new Error('no materials');
      // Only the configured material(s) change. Indices outside this model's material list are ignored;
      // if none are valid the swatches are disabled rather than recoloring the wrong part.
      const targets = model.materialIndices.filter((i) => i < materials.length);
      if (!targets.length) {
        console.warn(`[${model.id}] materialIndex ${model.materialIndices} is out of range (${materials.length} materials).`);
        throw new Error('no valid material');
      }
      for (const i of targets) materials[i].pbrMetallicRoughness.setBaseColorFactor(model.colors[state.selected].rgba);
    } catch (err) {
      markUnsupported();
    }
  }

  function markUnsupported() {
    state.unsupported = true;
    swatchWrap.dataset.unsupported = '';
    swatchWrap.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-disabled', 'true'));
    swatchLabel.replaceChildren('Color changes are not available for this model.');
  }

  /* ----- Viewer lifecycle ----- */
  function showMissing(reason) {
    if (state.viewer) { state.viewer.remove(); state.viewer = null; }
    state.ready = false;
    stage.dataset.state = 'missing';
    arStatus.textContent = 'AR available once the 3D model is added';
    arStatus.removeAttribute('data-on');
    console.info(`[${model.id}] showing placeholder: ${reason}`);
  }

  async function mountViewer() {
    if (state.viewer || state.mounting || stage.dataset.state === 'missing') return;
    if (!model.src) { showMissing('no src configured'); return; }
    state.mounting = true;
    stage.dataset.state = 'loading';
    // Wait for the custom element (and its Meshopt setting) before creating the viewer; if the script cannot
    // load (offline, blocked CDN) show the friendly placeholder instead of a stuck loader.
    const available = await Promise.race([ensureModelViewer(), timeout(10000, false)]);
    state.mounting = false;
    if (!available) { showMissing('model-viewer unavailable'); return; }

    const viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', model.src);          // fetched only now, when the card is near the viewport
    viewer.setAttribute('alt', model.alt);
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('touch-action', 'pan-y');   // lets mobile users scroll past the model
    if (!reducedMotion()) { viewer.setAttribute('auto-rotate', ''); viewer.setAttribute('rotation-per-second', '24deg'); viewer.setAttribute('auto-rotate-delay', '1500'); }
    if (model.ar) {
      viewer.setAttribute('ar', '');
      viewer.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
    }
    viewer.setAttribute('loading', 'lazy');
    viewer.setAttribute('reveal', 'auto');
    viewer.setAttribute('environment-image', 'neutral'); // built-in studio lighting, no extra download
    viewer.setAttribute('shadow-intensity', '1.2');
    viewer.setAttribute('shadow-softness', '0.9');
    viewer.setAttribute('exposure', '1');
    viewer.setAttribute('interaction-prompt', 'auto');
    viewer.setAttribute('crossorigin', 'anonymous');
    limitIdleFlourishes(viewer);
    if (model.ar) {
      const arBtn = h('button', { class: 'ar-btn', slot: 'ar-button', type: 'button' }, svg(ICON_AR, 18), 'View in your room');
      viewer.append(arBtn);
    }

    viewer.addEventListener('load', () => {
      state.ready = true;
      stage.dataset.state = 'ready'; // CSS crossfades the CSS object out and the viewer in
      const mats = viewer.model && viewer.model.materials;
      if (model.colors.length && (!mats || !mats.length)) markUnsupported();
      applyColor();                                  // apply a color chosen before the model finished loading
      updateAr();
    });
    viewer.addEventListener('ar-status', updateAr);
    viewer.addEventListener('error', () => { if (!state.ready) showMissing('model failed to load'); });

    state.viewer = viewer;
    stage.prepend(viewer);
  }

  function updateAr() {
    if (!model.ar || !state.viewer) return;
    const on = state.viewer.canActivateAR === true;
    arStatus.textContent = on ? 'AR ready on this device' : 'AR on compatible phones';
    if (on) arStatus.setAttribute('data-on', ''); else arStatus.removeAttribute('data-on');
  }

  // Data-saver users get a tap-to-load button instead of an automatic download.
  stage.__mount = () => {
    scene.append(buildObject(model.silhouette, 'sway'));
    if (saveData()) {
      stage.dataset.state = 'saver';
      saver.firstChild.addEventListener('click', mountViewer, { once: true });
    } else {
      mountViewer();
    }
  };
  if (mountObserver) mountObserver.observe(stage); else stage.__mount();

  return card;
}

/* ------------------------------------------------------------------ */
/* 6. Pricing and currency switching                                    */
/* ------------------------------------------------------------------ */
let activeCurrency = 'PKR';
const priceSlots = []; // { slot, pkg }

const formatMoney = (amount, cur) => `${cur} ${Math.round(amount).toLocaleString('en-US')}`;

/** Returns the content of one price block. No prices configured for the currency → "Request a Custom Quote". */
function priceNodes(pkg, cur) {
  const p = pkg.prices[cur];
  const rows = [];
  if (p.setup) rows.push(h('div', { class: 'price__row' }, h('span', { class: 'price__amount', text: formatMoney(p.setup, cur) }), h('span', { class: 'price__unit', text: 'one-time setup' })));
  if (p.monthly) rows.push(h('div', { class: 'price__row' }, h('span', { class: 'price__amount', text: formatMoney(p.monthly, cur) }), h('span', { class: 'price__unit', text: 'per month' })));
  return rows.length ? rows : [h('p', { class: 'price__quote', text: 'Request a Custom Quote' })];
}

function updatePrices() {
  for (const { slot, pkg } of priceSlots) slot.replaceChildren(...priceNodes(pkg, activeCurrency));
  document.querySelectorAll('.toggle__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.currency === activeCurrency)));
}

function renderPricing(cfg) {
  activeCurrency = cfg.pricing.currency;
  const plans = $('#plans');
  const frag = document.createDocumentFragment();

  for (const pkg of cfg.pricing.packages) {
    const slot = h('div', { class: 'price', 'aria-live': 'polite' });
    priceSlots.push({ slot, pkg });
    const cta = h('a', {
      class: `btn btn--block ${pkg.featured ? 'btn--amber' : 'btn--outline'}`,
      href: buildWhatsAppUrl(cfg, `I'm interested in the ${pkg.name} package${pkg.skuLabel ? ` (${pkg.skuLabel})` : ''}.`),
      target: '_blank', rel: 'noopener', 'data-wa': '', 'data-wa-extra': '',
      text: `Get a quote for ${pkg.name}`,
    });
    frag.append(h('article', { class: `plan reveal${pkg.featured ? ' plan--featured' : ''}` },
      pkg.featured && h('span', { class: 'plan__tag', text: pkg.badge }),
      h('div', {}, h('h3', { class: 'plan__name', text: pkg.name }), pkg.skuLabel && h('p', { class: 'plan__sku', text: pkg.skuLabel })),
      pkg.description && h('p', { class: 'plan__desc', text: pkg.description }),
      slot,
      h('ul', { class: 'plan__features' }, pkg.features.map((f) => h('li', {}, svg(ICON_CHECK, 18), h('span', { text: f })))),
      cta));
  }
  plans.append(frag);

  $('#currency-toggle').addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle__btn');
    if (!btn || btn.dataset.currency === activeCurrency) return;
    activeCurrency = btn.dataset.currency;
    updatePrices(); // swaps only the price blocks; no reload, no re-render of cards
  });
  updatePrices();
}

/* ------------------------------------------------------------------ */
/* Motion: reveals, live-only animation, parallax, nav                   */
/* ------------------------------------------------------------------ */
function initMotion() {
  const still = reducedMotion();

  // Scroll reveals: a class flip, animated by CSS transitions. Siblings stagger via --d.
  const revealTargets = document.querySelectorAll('.reveal, .steps, .layers');
  revealTargets.forEach((el, i) => {
    if (el.classList.contains('reveal')) el.style.setProperty('--d', `${(i % 3) * 90}ms`);
  });
  if ('IntersectionObserver' in window && !still) {
    const revealObs = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); revealObs.unobserve(e.target); }
    }, { threshold: 0.15, rootMargin: '0px 0px -6% 0px' });
    revealTargets.forEach((el) => revealObs.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add('is-in'));
  }

  // Continuous CSS animations only run while their scene is on screen.
  if ('IntersectionObserver' in window) {
    const liveObs = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.classList.toggle('is-visible', e.isIntersecting);
    }, { rootMargin: '80px 0px' });
    document.querySelectorAll('.live').forEach((el) => liveObs.observe(el));
  } else {
    document.querySelectorAll('.live').forEach((el) => el.classList.add('is-visible'));
  }

  // One passive scroll listener (rAF-throttled) drives nav state and light parallax.
  const nav = $('#nav');
  const par = [...document.querySelectorAll('[data-par]')];
  let queued = false;
  const frame = () => {
    queued = false;
    nav.classList.toggle('nav--solid', window.scrollY > 24);
    if (still || document.documentElement.classList.contains('gsap')) return; // GSAP ScrollTrigger drives parallax when loaded
    const mid = window.innerHeight / 2;
    for (const el of par) {
      const r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > window.innerHeight + 200) continue;
      el.style.setProperty('--py', `${((r.top + r.height / 2 - mid) * Number(el.dataset.par)).toFixed(1)}px`);
    }
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(frame); } }, { passive: true });
  frame();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                 */
/* ------------------------------------------------------------------ */
async function init() {
  const html = document.documentElement;
  html.classList.add('js');
  $('#reload-btn').addEventListener('click', () => window.location.reload());

  let cfg = null;
  const slug = getClientSlug();
  if (slug && slug !== DEFAULT_SLUG) {
    try { cfg = await loadPitch(slug); }
    catch (err) { console.warn(`Pitch "${slug}" unavailable, using default.`, err); }
  }
  if (!cfg) {
    try { cfg = await loadPitch(DEFAULT_SLUG); }
    catch (err) {
      console.error('Default pitch failed to load.', err);
      html.dataset.state = 'error';
      $('#boot').hidden = true;
      $('#boot-error').hidden = false;
      return;
    }
  }

  // Hydrate in two tasks so the browser can paint and respond between them.
  renderPage(cfg);
  await new Promise((resolve) => setTimeout(resolve, 0));
  renderModels(cfg.models);
  renderPricing(cfg);
  wireWhatsApp(cfg);
  html.dataset.state = 'ready';
  // A shared link like /#pricing was resolved against the static page, before the showroom was hydrated.
  // Re-resolve it once, unless the visitor has already started scrolling away.
  if (location.hash.length > 1 && window.scrollY < 4000) {
    let target = null;
    try { target = document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { /* malformed hash */ }
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: 'instant' })); // instant: a link should land, not glide
  }
  // The closing scene is built only when it nears the viewport.
  const finalStage = $('.final__stage');
  finalStage.__mount = () => $('#final-scene').append(buildObject('chair', 'spin'));
  if (mountObserver) mountObserver.observe(finalStage); else finalStage.__mount();
  initMotion();

  // model-viewer is warmed on first engagement (the hero GLB, if configured, loads with it). Product cards also
  // trigger it themselves when they approach the viewport, so nothing heavy runs during the initial load.
  if (cfg.models.length) whenEngaged(ensureModelViewer);

  startEnhancements();
}

/** Optional layers that must never block first paint: GSAP motion and Web Vitals monitoring. */
// Hero background video. index.html starts it immediately; this only keeps it well behaved: it pauses while the hero is
// off-screen or the tab is hidden, retries if the browser blocked the first autoplay, and drops back to the poster on failure.
function initHeroVideo() {
  const v = document.querySelector('.hero__video');
  if (!v) return;
  const play = () => { if (v.src && v.paused && !document.hidden && heroVisible) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } };
  let heroVisible = true;
  new IntersectionObserver((es) => { heroVisible = es[es.length - 1].isIntersecting; if (heroVisible) play(); else v.pause(); }).observe(v.closest('.hero'));
  document.addEventListener('visibilitychange', () => (document.hidden ? v.pause() : play()));
  v.addEventListener('canplay', play);
  v.addEventListener('error', () => { v.removeAttribute('src'); v.load(); });
  ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach((t) => addEventListener(t, play, { once: true, passive: true }));
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mq.addEventListener) mq.addEventListener('change', () => { if (mq.matches) v.pause(); else play(); });
}

function startEnhancements() {
  initHeroVideo();
  const idle = (fn, ms) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, ms));
  // GSAP + ScrollTrigger (~46 KB gzipped) load on first engagement (move, touch, key, scroll), because nothing they do
  // is needed before the visitor interacts: the hero entrance is pure CSS. Skipped for reduced motion and data-saver
  // users, who keep the CSS-only reveals. If the CDN fails, the CSS/IntersectionObserver reveals stay in charge.
  if (!reducedMotion() && !saveData()) {
    whenEngaged(() => import('./motion.js').then((m) => m.initGsapMotion()).catch((err) => console.warn('GSAP motion unavailable', err)));
  }
  const slowLink = navigator.connection && /(^|-)2g$/.test(navigator.connection.effectiveType || '');
  if (!saveData() && !slowLink && document.querySelector('.piece')) {
    idle(() => {
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = MODEL_VIEWER_URL;
      document.head.append(link);
    }, 4000);
  }
  // Web Vitals: off by default. Enabled with ?vitals, localStorage marsevtechVitals=1, or a configured endpoint.
  const meta = (n) => (document.querySelector(`meta[name="marsevtech-vitals-${n}"]`) || {}).content || '';
  let stored = false;
  try { stored = localStorage.getItem('marsevtechVitals') === '1'; } catch (e) { /* storage blocked */ }
  const endpoint = meta('endpoint');
  if (/[?&]vitals(=|&|$)/.test(location.search) || stored || endpoint) {
    idle(() => import('./vitals.js').then((m) => m.startVitals({ endpoint, sample: Number(meta('sample')) || 1 })).catch((err) => console.warn('Web Vitals unavailable', err)), 2000);
  }
}

init();
