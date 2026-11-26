/* vitals.js: Core Web Vitals monitoring (LCP, INP, CLS) with Google's web-vitals library.

   Off by default and never loaded unless one of these is true, so normal visitors pay nothing:
   - the URL has ?vitals            (shows a small on-page panel and logs to the console)
   - ?vitals=console                (console only, no panel)
   - localStorage marsevtechVitals = "1"   (keeps it on across pages while you test)
   - <meta name="marsevtech-vitals-endpoint" content="https://..."> is set in index.html   (production reporting)

   Privacy: nothing identifying is collected. A report contains only the metric (name, value, rating, navigation type,
   a random per-page id), the path without its query string, "default" or "custom" for the pitch type (never the client
   name), a mobile/desktop viewport class and the connection type. No cookies, no user agent, no IP handling here, and
   nothing is sent unless an https endpoint is configured. */

const SRC = 'https://cdn.jsdelivr.net/npm/web-vitals@4.2.4/dist/web-vitals.iife.js';
const SRI = 'sha384-mfknU/5RXdvBJDftA9q3VBj6BImlZ7kqzvO30nq+H3CQLXcV7d+MaWniRPhLaT4h';
const COLORS = { good: '#34c28a', 'needs-improvement': '#f2a65a', poor: '#ef6b5f' };

function loadLibrary() {
  return new Promise((resolve, reject) => {
    if (window.webVitals) return resolve();
    const s = document.createElement('script');
    s.src = SRC;
    s.integrity = SRI;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('web-vitals failed to load'));
    document.head.append(s);
  });
}

const fmt = (m) => (m.name === 'CLS' ? m.value.toFixed(3) : m.value >= 1000 ? `${(m.value / 1000).toFixed(2)} s` : `${Math.round(m.value)} ms`);

function createPanel() {
  const panel = document.createElement('div');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'Web Vitals (development panel)');
  panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;background:rgba(14,13,12,.94);color:#eee9e1;font:12px/1.5 ui-monospace,Consolas,monospace;padding:10px 12px;border:1px solid rgba(238,233,225,.2);border-radius:4px;min-width:190px';
  const rows = {};
  for (const name of ['LCP', 'INP', 'CLS']) {
    const row = document.createElement('div');
    row.textContent = `${name}  waiting…`;
    panel.append(row);
    rows[name] = row;
  }
  const hint = document.createElement('div');
  hint.style.cssText = 'opacity:.6;margin-top:6px';
  hint.textContent = 'INP appears after you interact.';
  panel.append(hint);
  document.body.append(panel);
  return { rows, hint };
}

export async function startVitals({ endpoint = '', sample = 1 } = {}) {
  await loadLibrary();
  const { onLCP, onINP, onCLS } = window.webVitals;
  const consoleOnly = /[?&]vitals=console/.test(location.search);
  const showPanel = /[?&]vitals(=|&|$)/.test(location.search) && !consoleOnly;
  const ui = showPanel ? createPanel() : null;

  // Latest values, readable from the console as window.marsevtechVitals (also used by the automated tests).
  const latest = (window.marsevtechVitals = {});
  const live = (m) => {
    latest[m.name] = { value: m.value, rating: m.rating, id: m.id, navigationType: m.navigationType };
    if (ui) {
      const row = ui.rows[m.name];
      row.textContent = `${m.name}  ${fmt(m)}  ${m.rating}`;
      row.style.color = COLORS[m.rating] || '#eee9e1';
    }
    if (!/[?&]vitals=quiet/.test(location.search)) console.log(`[vitals] ${m.name} ${fmt(m)} (${m.rating})`);
  };
  // reportAllChanges: show values as they evolve while testing. The library still finalises them on page hide.
  [onLCP, onINP, onCLS].forEach((observe) => observe(live, { reportAllChanges: true }));

  // Optional production reporting: final values only, sampled, anonymous, sent with sendBeacon on page hide.
  if (/^https:\/\//.test(endpoint) && Math.random() < sample) {
    const send = (m) => {
      const body = JSON.stringify({
        name: m.name,
        value: Math.round(m.value * 1000) / 1000,
        rating: m.rating,
        navigationType: m.navigationType,
        id: m.id,
        page: location.pathname,
        pitch: new URLSearchParams(location.search).has('client') ? 'custom' : 'default',
        viewport: window.innerWidth < 768 ? 'mobile' : 'desktop',
        connection: (navigator.connection && navigator.connection.effectiveType) || 'unknown',
      });
      if (!(navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' })))) {
        fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
    };
    [onLCP, onINP, onCLS].forEach((observe) => observe(send));
  }
}
