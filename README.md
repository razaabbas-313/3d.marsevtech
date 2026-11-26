# MarsevTech

The MarsevTech website: an immersive pitch site for 3D and AR furniture visualization. One static site, many personalized client pitches:

- `https://3d.marsevtech.com/` loads the default pitch.
- `https://3d.marsevtech.com/?client=habitt` loads `pitches/habitt.json`.

Vanilla HTML, CSS and JavaScript. No framework, no build step, no backend. It deploys as plain static files.

## Technologies used

| Technology | Role | Loaded |
|---|---|---|
| Google `<model-viewer>` 3.5.0 | Interactive 3D, color switching and AR for the real GLB furniture | On first engagement or when a product card nears the screen (never during page load) |
| GSAP 3.12.5 + ScrollTrigger | Scroll-scrubbed process timeline, staggered reveals, parallax | On first engagement; skipped for reduced motion and data-saver |
| web-vitals 4.2.4 | LCP / INP / CLS monitoring | Only when enabled (see Performance monitoring) |
| Meshopt decoder 0.20.0 | Decodes the two Meshopt-compressed scans | Only when one of those GLBs loads |
| glTF Transform (CLI, offline) | Optimizing GLB files before they are added | Never shipped to visitors |
| Three.js | Not used. See "Why there is no Three.js" | n/a |

All CDN scripts are version-pinned. GSAP and web-vitals are loaded with Subresource Integrity hashes. Fonts are self-hosted.

## Folder structure

```text
3d.marsevtech/
├── index.html          Page structure and SEO metadata
├── style.css           Design tokens, CSS-3D furniture, CSS motion, all styles
├── app.js              Pitch loader, slug validation, WhatsApp, showroom, model-viewer, pricing
├── motion.js           GSAP + ScrollTrigger layer (lazy, optional)
├── vitals.js           Web Vitals monitoring (lazy, off by default)
├── robots.txt
├── sitemap.xml
├── pitches/
│   ├── default.json    Shown with no ?client= or an unknown/invalid one
│   └── habitt.json     Example private pitch
├── models/             Real furniture GLBs + models/README.md
└── assets/
    ├── logo/           Logo mark (SVG)
    ├── fonts/          Self-hosted Instrument Serif + Hanken Grotesk (Latin, SIL OFL)
    ├── images/         og-cover.png social preview
    └── icons/          favicon
```

## How it loads (and why)

The page is built so nothing heavy runs before the visitor can see and use it.

1. **First paint:** HTML, CSS, two preloaded fonts, `app.js` and the pitch JSON (about 100 KB over the wire). The default URL paints its static hero immediately; `?client=` URLs wait for their JSON so the default text never flashes. The hero is the looping AR demo video (poster first, then video; see Hero background video).
2. **Idle:** the model-viewer script is pre-fetched with `modulepreload` (download only; it is not executed).
3. **First engagement** (pointer move, touch, key, scroll): model-viewer is evaluated, and GSAP/ScrollTrigger load.
4. **Per product card:** each GLB is fetched only when its card is within about 300 px of the viewport. Until the model has rendered, the CSS fallback object stays visible. A missing, corrupt or failed model shows a friendly placeholder and nothing else breaks.
5. **Models keep rotating:** visible showroom models auto-rotate continuously (about 24 deg/s) and resume 1.5 s after the visitor lets go; reduced-motion visitors get no auto-rotate. Model-viewer only renders while a model is on screen. Only the looping "drag me" hint stops after about 9 seconds, because it caused constant long tasks. Dragging, zooming and AR are unaffected.

## Model Viewer integration

- Every product viewer is created in `app.js` (`mountViewer`) from the pitch JSON: `camera-controls`, `touch-action="pan-y"` (so phones can scroll past a model), `environment-image="neutral"` (built-in lighting, no download), soft shadows, and `ar ar-modes="webxr scene-viewer quick-look"` for models with `"ar": true`.
- **AR button** appears only when the device can use AR. iOS Quick Look builds its USDZ from the GLB automatically.
- **Color switching** changes the base color of the material(s) named by `materialIndex` (see Configure material swatches).
- **Meshopt:** model-viewer 3.5.0 cannot decode `EXT_meshopt_compression` unless `ModelViewerElement.meshoptDecoderLocation` is set. `ensureModelViewer()` sets it, before any viewer can start loading, to a pinned `meshoptimizer@0.20.0` decoder from jsDelivr. It is downloaded only if a Meshopt GLB loads.
- **No Three.js duplication:** model-viewer already bundles its own copy of three.js.

## GSAP integration (`motion.js`)

GSAP is used only where it does something CSS cannot, and it is loaded after the page is usable.

| Animation | Tool | Why |
|---|---|---|
| Hero headline and hero content entrance | **CSS** (kept) | Must run before any library loads and protects LCP; CSS does it with zero JS |
| Buttons, swatches, nav, hovers, crossfades | **CSS** (kept) | Simple transitions belong in CSS |
| Section, product and pricing reveals | GSAP timelines, triggered by IntersectionObserver | Sequenced and staggered (stage rises, then its text follows). IO instead of ScrollTrigger avoids measuring layout for every element |
| Process timeline | GSAP + **ScrollTrigger scrub** | The amber line follows scroll position and lights each step as it arrives |
| Parallax (hero and closing scene) | GSAP + ScrollTrigger scrub | Cached positions, no layout reads on every scroll frame |
| Closing CTA reveal | GSAP timeline | Copy sequence, then the scene fades up |

Rules it follows: only `transform` and `opacity`; about 4 ScrollTriggers in total; hidden states use opacity only (never `visibility:hidden`), so unrevealed buttons stay reachable by keyboard; `gsap.matchMedia()` reverts everything if the visitor switches on reduced motion; and if GSAP or the CDN fails, the CSS and IntersectionObserver reveals in `app.js` keep all content visible.

## Why there is no Three.js

Three.js was evaluated and deliberately not added.

- Every furniture model is already rendered by model-viewer, which bundles three.js. A second renderer would duplicate it and add a second WebGL context to every page.
- The one thing a custom scene could add (an ambient 3D hero) is already delivered by the CSS-3D sofa and spotlight, at no download or GPU cost.
- Measured cost of the one WebGL stack we do load: on a 4x-throttled CPU with software WebGL, model-viewer alone was the dominant main-thread cost. Adding another WebGL scene would only make that worse on phones.
- Revisit it only for a feature model-viewer cannot do (for example a fully custom walk-through room), as an isolated, lazily loaded proof of concept with its own performance budget.

## Performance monitoring (Web Vitals)

`vitals.js` measures the three Core Web Vitals with Google's `web-vitals` library. It is **off by default and is not even downloaded** unless you turn it on.

**Turn it on for testing**

- Add `?vitals` to any URL (for example `http://127.0.0.1:5500/?vitals`): a small panel appears bottom-left and values are logged to the console. `?vitals=console` logs only; `?vitals=quiet` shows the panel without logging.
- Or keep it on while you browse: `localStorage.setItem('marsevtechVitals', '1')` in the console.
- Read the latest values any time with `window.marsevtechVitals`.
- INP appears only after you click, tap or press a key.

**Optional production reporting (disabled until configured).** In `index.html`, set `<meta name="marsevtech-vitals-endpoint" content="https://your-collector.example/vitals">` (https only) and `marsevtech-vitals-sample` (0 to 1). Final values are sent once, on page hide, with `sendBeacon`. A report contains only: metric name, value, rating, navigation type, a random per-page id, the path without its query string, `default` or `custom` (never the client name), a mobile/desktop class and the connection type. No cookies, no user agent, no personal data. You must supply the collector; this project has no backend.

**How to read the numbers** (Google's thresholds, 75th percentile of real visits)

| Metric | Good | Needs improvement | Poor | Means |
|---|---|---|---|---|
| LCP | 2.5 s or less | up to 4 s | over 4 s | When the main content appeared (here: the hero text) |
| INP | 200 ms or less | up to 500 ms | over 500 ms | Worst delay between a tap/click/key and the next paint |
| CLS | 0.1 or less | up to 0.25 | over 0.25 | How much the layout jumped |

A single local reading is a sample, not a verdict. Real-user data (the beacon, or Chrome's CrUX in PageSpeed Insights once the site has traffic) matters more than any lab score. In the lab, INP is whatever the slowest interaction in that session was, and it is much worse with software WebGL or a throttled CPU than on a real phone.

## Hero background video

`assets/video/hero-ar.mp4` (960x540, 24 fps, H.264, 11 s, ~0.9 MB, no audio) is the hero's only visual: a phone shows a 3D chair, taps "View in your space", and places the chair in a room with AR. It is the owner's own footage (`background video ar.mp4`, seconds 14-25.8, with a short dissolve at the loop seam). `assets/images/hero-poster.webp` (28 KB) is the poster frame; the browser swaps it for the video's own frames as soon as playback starts.

- The `<video autoplay muted loop playsinline>` is in `index.html`; a tiny inline script right after it sets the source immediately so playback starts as early as possible.
- Reduced-motion, data-saver and 2g/3g visitors keep the poster and never download the MP4.
- `initHeroVideo()` in `app.js` pauses it when the hero is off-screen or the tab is hidden, retries play if the browser blocked the first autoplay, and falls back to the poster on error.
- The hero no longer contains a CSS sofa or a hero GLB; the interactive Model Viewer showroom below is unchanged and independent of the video.
- To replace it: about 10 s, muted, 16:9, `ffmpeg -an -c:v libx264 -crf 24 -movflags +faststart`, update the poster, and keep both under `assets/`.

## Run locally

1. Open the folder in VS Code and install the **Live Server** extension.
2. Right-click `index.html` → **Open with Live Server**.
3. Try `http://127.0.0.1:5500/?client=habitt` and `http://127.0.0.1:5500/?vitals`.

Open the site through a server, not by double-clicking the file. Browsers block `fetch()` of JSON and ES modules on `file://`. Any static server works, for example `npx serve .`.

## Add a client pitch

1. Copy `pitches/habitt.json` to `pitches/<slug>.json`. The slug may contain only lowercase letters, numbers and hyphens (for example `urban-living`).
2. Edit `client.brandName`, `hero.*` and `whatsapp.message`. Keep `client.isCustomPitch` as `true`. Custom pitches get a `noindex` tag and a short "not affiliated" note in the footer. (Lighthouse's SEO score reports the `noindex` on these pages. That is intentional for private proposals.)
3. Send `https://3d.marsevtech.com/?client=<slug>`.

In `whatsapp.message`, `{brand}` is replaced with `client.brandName`. This is a private sales proposal, so do not word it as a partnership or endorsement.

## Add new furniture models

1. **Prepare** the GLB (see GLB optimization below and `models/README.md`): real-world scale in metres, origin at floor level, one material per recolorable part.
2. **Save** it as `models/<name>.glb` (lowercase, hyphens).
3. **Find its materials:** `npx @gltf-transform/cli inspect models/<name>.glb`.
4. **Add an entry** to the pitch's `models` list:

```json
{
  "id": "oslo-sofa",
  "title": "Oslo Three-Seater Sofa",
  "description": "A low-profile sofa with deep cushions.",
  "src": "models/oslo-sofa.glb",
  "silhouette": "sofa",
  "dimensions": { "width": 210, "depth": 92, "height": 80, "unit": "cm" },
  "ar": true,
  "alt": "Oslo sofa 3D model",
  "materialIndex": 1,
  "colorLabel": "Upholstery",
  "colors": []
}
```

`silhouette` (`sofa`, `chair`, `table`, `bed` or `box`) picks the CSS object shown while the model loads or is missing. Only set `"ar": true` if the model is at true real-world scale; otherwise set `false` and omit `dimensions`. Only models listed in the active pitch are ever downloaded.

## Configure material swatches

Add `colors` to a product. `rgba` is four numbers from 0 to 1 in **linear** color space (the glTF base-color convention):

```json
"materialIndex": 1,
"colorLabel": "Upholstery",
"colors": [
  { "name": "Ivory",      "rgba": [1, 1, 1, 1] },
  { "name": "Slate blue", "rgba": [0.102, 0.156, 0.262, 1] }
]
```

- `materialIndex` is a number or a list (`[1, 3]`) naming exactly which material(s) change. It is **not** assumed to be 0. Indices that do not exist are ignored; if none exist the swatches are disabled.
- Only recolor materials that genuinely should change (fabric, bedding, a wood top), never metal, glass or small details.
- When the material has a base-color texture, the color is multiplied with it, so a swatch can only darken or tint a light texture. Add `"swatch": "#8a5a3c"` to a color to show the result in the swatch circle instead of the raw factor.
- A model with one baked texture cannot be recolored reliably. Give it no `colors` and add a `colorNote` explaining why.
- This is a color adjustment, not a texture replacement.

## GLB optimization process

Work on copies, never overwrite the originals, and look at the result in model-viewer before adopting it. Inspect first, then optimize only where it pays off:

```bash
npx @gltf-transform/cli inspect model.glb                       # size, triangles, textures, materials
npx @gltf-transform/cli weld in.glb out.glb
npx @gltf-transform/cli simplify in.glb out.glb --ratio 0.12 --error 0.002
npx @gltf-transform/cli quantize in.glb out.glb                 # smaller vertex data, no decoder needed
npx @gltf-transform/cli webp in.glb out.glb --quality 78        # not for models that need AR (see below)
npx @gltf-transform/cli meshopt in.glb out.glb --level high     # needs the decoder set in app.js
```

Audit of the current models (the originals in the downloads folder are untouched):

| Model | Original | Previously | Now | Reduction | Visual quality |
|---|---:|---:|---:|---:|---|
| `designer-sofa.glb` (scan) | 4.74 MB | 891 KB | **426 KB** | 91% vs original (52% this pass) | Indistinguishable from the original at normal and close angles |
| `egg-lounge-chair.glb` (scan) | 7.75 MB | 1.59 MB | **623 KB** | 92% vs original (61% this pass) | Matches at normal angles; a more aggressive variant made the base slightly faceted and was rejected |
| `double-bed.glb` | 752 KB | n/a | 752 KB (unchanged) | 0% | Unchanged. Quantize would save 12% |
| `sectional-sofa.glb` | 195 KB | n/a | unchanged | 0% | Unchanged. Quantize would save 19% |
| `loveseat.glb` | 158 KB | n/a | unchanged | 0% | Unchanged |
| `lounge-armchair.glb` | 112 KB | n/a | unchanged | 0% | Unchanged |
| `coffee-table.glb` | 114 KB | n/a | unchanged | 0% | Unchanged |

Decisions:

- **The five clean models were left alone.** They are 112-752 KB, `prune`/`dedup`/`quantize` saved only 14-86 KB, and they are the AR models, where an extra extension is a risk for no real gain.
- **The two scans use Meshopt** (verified: they load and render identically in model-viewer 3.5.0 once `meshoptDecoderLocation` is set) plus quantization and WebP textures, after `weld` and `simplify` from the original (about 31k and 34k triangles, down from 123k and 179k). Because Meshopt and WebP textures are not guaranteed to work in Android Scene Viewer (not tested on a device), both scans have `"ar": false`.
- **Draco was not used.** Its decoder is far larger than Meshopt's for little extra saving here.
- Material names and indices, dimensions and the camera settings are unchanged for every model.

## Test AR on a real device

AR needs a phone and an `https://` address, so it cannot be checked on `localhost` desktop. It has not been tested on a physical device for this project.

1. Deploy to any https host (a Vercel preview URL is fine) and open it on the phone.
2. **Android (Chrome):** scroll to a model with the AR button and tap **View in your room**. It opens Scene Viewer (or WebXR). Move the phone to find the floor, then place the piece.
3. **iPhone/iPad (Safari):** tap the same button; it opens AR Quick Look.
4. Check that the piece appears at real size (a 270 cm sectional should span about two and a half arm-lengths). If the size is wrong, the model's scale is wrong, not the page.
5. Models with `"ar": false` correctly show no button.

## Run performance audits

- **Lighthouse (lab):** Chrome DevTools → Lighthouse → Mobile, or `npx lighthouse http://127.0.0.1:5500/ --only-categories=performance`. Use a server that gzips (a real host does) and run each URL 3 times: scores swing by 10-20 points between runs on one machine. Audit `/` and `/?client=habitt` separately.
- **Real behavior:** open `/?vitals`, interact with the page and read LCP, INP and CLS.
- **DevTools → Performance:** record a page load and a first scroll. Look for long tasks (red corners) and what script they belong to.
- **Throttling caveat:** Lighthouse and headless Chrome use software WebGL, which makes model-viewer look much slower than it is on a phone GPU. Lab TBT is a warning light, not a measurement of what customers feel.

## Update pricing

Prices live in each pitch under `pricing.packages[].prices`. Nothing is invented: every price ships as `null`, and a package with no price for the selected currency shows **Request a Custom Quote**.

```json
"prices": {
  "PKR": { "setup": 120000, "monthly": 15000 },
  "USD": { "setup": 450,    "monthly": 55 }
}
```

Set any value to a positive number to show it. Leave `null` to hide it. `pricing.currency` (`PKR` or `USD`) sets the default currency. Package names, SKU labels, feature lists and the "Most Popular" badge (`featured: true`) are in the same block.

## Change WhatsApp and email

- WhatsApp number: `whatsapp.number` in each pitch, digits only, with country code (`923000000000`). The same number is used for the nav, hero, package, final and footer buttons. The fallback constant is `FALLBACK_WA_NUMBER` in `app.js`.
- Email: `contact.email` in each pitch. It is currently the placeholder `contact@example.com`. Replace it with your real address in every pitch and in the `FALLBACK_EMAIL` constant in `app.js`.

## Deploy to Vercel

1. Push the folder to a Git repository.
2. In Vercel choose **Add New → Project** and import it.
3. Framework preset: **Other**. Build command: none. Output directory: leave empty. Root directory: the folder that contains `index.html`.
4. After deploying, go to **Settings → Domains**, add `3d.marsevtech.com`, and create the DNS record Vercel shows (usually a CNAME to `cname.vercel-dns.com`).

Query-string pitches work as is. No rewrites or serverless functions are needed.

## Deploy to GitHub Pages

1. Push the folder to a repository.
2. **Settings → Pages**, source: your branch, folder `/ (root)`.
3. For a custom domain, set `3d.marsevtech.com` there and add a CNAME DNS record pointing to `<user>.github.io`.

All internal asset paths (`style.css`, `app.js`, `motion.js`, `pitches/…`, `models/…`) are relative, so the site also works under a project path such as `https://<user>.github.io/marsevtech-3d/`. If you serve it from a project path, the absolute URLs in the `<head>` (canonical, `og:image`) and in `robots.txt` and `sitemap.xml` still point at `3d.marsevtech.com`. Update them if you do not use that domain.

Both hosts compress text assets automatically. GLB files are already compact and are served as-is.
