/* motion.js: GSAP + ScrollTrigger layer for MarsevTech.
   (Hidden states use opacity only, never visibility:hidden, so unrevealed controls stay keyboard-focusable.)

   Loaded by app.js AFTER first render, on idle, and never for visitors who prefer reduced motion or have data-saver
   on. Everything here is an enhancement on top of CSS that already works:

   - Hero entrance stays pure CSS (it must run before any library loads, and CSS does it with zero JavaScript).
   - Simple hovers/transitions (buttons, swatches, nav) stay in CSS.
   - If this file or the GSAP CDN fails, the CSS + IntersectionObserver reveals in app.js remain in charge and
     all content is visible.

   What GSAP owns once loaded, and why:
   1. Reveals: sequenced, staggered timelines (stage rises and settles, then its text follows). They are triggered by
      an IntersectionObserver, not ScrollTrigger, because they only need "has it entered the viewport", and IO
      does that without measuring layout for every element.
   2. Process timeline: ScrollTrigger scrubs the amber line with scroll position (CSS can only play it on a timer).
   3. Parallax: ScrollTrigger scrub with cached positions, replacing a handler that measured layout on every scroll.
   Only transform and opacity are animated. gsap.matchMedia() reverts everything if the visitor switches on reduced
   motion while the page is open. ScrollTrigger is limited to about 7 triggers; every extra one costs layout reads. */

const GSAP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js';
const GSAP_SRI = 'sha384-g4NTh/Iv5PPU4xPyhEWqPcwtNXOvdaDI8LLnyYfyNZOjKJeYQyjzQ9X5275eBjpt';
const ST_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js';
const ST_SRI = 'sha384-Z3REaz79l2IaAZqJsSABtTbhjgOUYyV3p90XNnAPCSHg3EMTz1fouunq9WZRtj3d';

/** Classic script with Subresource Integrity. async=false keeps execution order (GSAP before ScrollTrigger). */
function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.integrity = integrity;
    s.crossOrigin = 'anonymous';
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

const all = (sel, root = document) => [...root.querySelectorAll(sel)];
const notRevealed = (el) => !el.classList.contains('is-in');

/** Whatever happens, leave every piece of content visible. */
function showEverything() {
  document.querySelectorAll('.reveal, .steps, .layers').forEach((el) => el.classList.add('is-in'));
}

export async function initGsapMotion() {
  await Promise.all([loadScript(GSAP_URL, GSAP_SRI), loadScript(ST_URL, ST_SRI)]);
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true }); // mobile URL-bar show/hide must not trigger a refresh

  const root = document.documentElement;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    let io = null;
    try {
      io = setup(gsap, ScrollTrigger);
      root.classList.add('gsap');
    } catch (err) {
      console.warn('GSAP setup failed; falling back to CSS reveals', err);
      showEverything();
    }
    // Runs when the condition stops matching (reduced motion switched on): GSAP reverts its inline styles.
    return () => {
      if (io) io.disconnect();
      root.classList.remove('gsap');
      document.querySelector('#steps')?.classList.remove('gs-scrub');
      showEverything();
    };
  });

  // Fonts change text metrics. ScrollTrigger refreshes itself on load; only refresh again if fonts are still pending.
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => ScrollTrigger.refresh());
}

function setup(gsap, ScrollTrigger) {
  const EASE = 'power3.out';
  const CLEAR = 'opacity,visibility,transform';

  /* 1. Reveals. Initial hidden states are set once; an IntersectionObserver plays each timeline as it enters. */
  const simple = all('.gallery__head, .why__lead, .reason, .process__head, .pricing__head, .plan').filter(notRevealed);
  const pieces = all('.piece').filter(notRevealed);
  const finalCopy = document.querySelector('.final__copy');
  const finalStage = document.querySelector('.final__stage');
  const hasFinal = finalCopy && notRevealed(finalCopy);

  [...simple, ...pieces, ...(hasFinal ? [finalCopy] : [])].forEach((el) => el.classList.add('gs')); // CSS: GSAP owns it
  gsap.set(simple, { opacity: 0, y: 44 });
  const pieceParts = new Map();
  pieces.forEach((piece) => {
    const stage = piece.querySelector('.stage');
    const copy = [...piece.querySelector('.piece__info').children];
    pieceParts.set(piece, { stage, copy });
    gsap.set(stage, { opacity: 0, scale: 0.94, y: 64 });
    gsap.set(copy, { opacity: 0, y: 28 });
  });
  const finalKids = hasFinal ? [...finalCopy.children] : [];
  if (hasFinal) { gsap.set(finalKids, { opacity: 0, y: 40 }); gsap.set(finalStage, { opacity: 0 }); }

  const play = (el) => {
    if (pieceParts.has(el)) {
      const { stage, copy } = pieceParts.get(el);
      gsap.timeline({ defaults: { ease: EASE } })
        .to(stage, { opacity: 1, scale: 1, y: 0, duration: 1.2, clearProps: CLEAR })
        .to(copy, { opacity: 1, y: 0, duration: 0.9, stagger: 0.09, clearProps: CLEAR }, '-=0.8');
    } else if (el === finalCopy) {
      // Opacity only on the stage so the parallax transform on it is untouched.
      gsap.timeline({ defaults: { ease: EASE } })
        .to(finalKids, { opacity: 1, y: 0, duration: 1, stagger: 0.14, clearProps: CLEAR })
        .to(finalStage, { opacity: 1, duration: 1.6, clearProps: 'opacity,visibility' }, '-=0.9');
    }
  };

  const io = new IntersectionObserver((entries) => {
    const entering = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    if (!entering.length) return;
    entering.forEach((el) => io.unobserve(el));
    const flat = entering.filter((el) => !pieceParts.has(el) && el !== finalCopy);
    if (flat.length) gsap.to(flat, { opacity: 1, y: 0, duration: 1, ease: EASE, stagger: 0.11, overwrite: true, clearProps: CLEAR });
    entering.filter((el) => pieceParts.has(el) || el === finalCopy).forEach(play);
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.01 });
  [...simple, ...pieces, ...(hasFinal ? [finalCopy] : [])].forEach((el) => io.observe(el));

  /* 2. Process timeline: ScrollTrigger scrubs the line; each step lights as the line reaches it. */
  const steps = document.querySelector('#steps');
  if (steps) {
    steps.classList.remove('is-in');
    steps.classList.add('gs-scrub'); // CSS: line length = --p (0..1), nodes light via .is-lit
    gsap.to(steps, { '--p': 1, ease: 'none', scrollTrigger: { trigger: steps, start: 'top 72%', end: 'bottom 58%', scrub: 0.5 } });
    const stepEls = all('.step', steps);
    const bits = stepEls.map((step) => [step.querySelector('.step__no'), step.querySelector('.h3'), step.querySelector('p')]);
    gsap.set(bits.flat(), { opacity: 0, y: 28 });
    const played = new Set();
    ScrollTrigger.create({
      trigger: steps,
      start: 'top 78%',
      end: 'bottom 40%',
      onUpdate: (self) => {
        // The line has "reached" step k when progress passes k/3 of the section; light steps up to that point.
        const reached = Math.min(stepEls.length, Math.ceil(self.progress * stepEls.length + 0.0001));
        stepEls.forEach((step, i) => {
          const lit = i < reached;
          step.classList.toggle('is-lit', lit);
          if (lit && !played.has(i)) {
            played.add(i);
            gsap.to(bits[i], { opacity: 1, y: 0, duration: 0.9, stagger: 0.12, ease: EASE, clearProps: CLEAR });
          }
        });
      },
    });
  }

  /* 3. Parallax via ScrollTrigger scrub (cached positions, no layout reads while scrolling). */
  all('[data-par]').forEach((el) => {
    const factor = Number(el.dataset.par) || 0;
    if (!factor) return;
    if (el.classList.contains('hero__stage')) {
      // Drifts up slowly as the hero scrolls away; stays exactly in place at scroll 0.
      gsap.to(el, { y: () => -factor * window.innerHeight, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
    } else {
      gsap.fromTo(el,
        { y: () => factor * (window.innerHeight / 2 + el.offsetHeight / 2) },
        { y: () => -factor * (window.innerHeight / 2 + el.offsetHeight / 2), ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true } });
    }
  });

  return io; // so the reduced-motion cleanup can disconnect it
}
