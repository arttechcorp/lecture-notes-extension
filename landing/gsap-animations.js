(() => {
  if (typeof gsap === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  if (typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

  // Hero entrance on load: eyebrow -> h1 -> lead -> hero-actions -> micro, then the browser mockup.
  const heroCopyItems = document.querySelectorAll('.hero-copy > .eyebrow, .hero-copy > h1, .hero-copy > .lead, .hero-copy > .hero-actions, .hero-copy > .micro');
  const heroMock = document.querySelector('.mock');
  if (heroCopyItems.length || heroMock) {
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    if (heroCopyItems.length) tl.from(heroCopyItems, { opacity: 0, y: 20, duration: 0.6, stagger: 0.1, clearProps: 'all' });
    if (heroMock) tl.from(heroMock, { opacity: 0, y: 28, duration: 0.8, clearProps: 'all' }, heroCopyItems.length ? '-=0.4' : 0);
  }

  if (typeof ScrollTrigger === 'undefined') return;

  // Scroll-triggered stagger reveals, each section fires once.
  function revealOnScroll(container, selector, vars) {
    const root = document.querySelector(container);
    if (!root) return;
    const items = root.querySelectorAll(selector);
    if (!items.length) return;
    gsap.from(items, Object.assign({
      opacity: 0,
      y: 20,
      duration: 0.6,
      stagger: 0.08,
      ease: 'power2.out',
      clearProps: 'all',
      scrollTrigger: { trigger: root, start: 'top 85%', once: true },
    }, vars));
  }

  revealOnScroll('.value-strip', 'span', { y: 16 });
  revealOnScroll('.source-panel', '.transcript-line');
  revealOnScroll('.plan-grid', '.plan');
  revealOnScroll('.steps', ':scope > div');
  revealOnScroll('.faq-list', 'details');

  const demoNote = document.querySelector('.demo-note');
  if (demoNote) {
    gsap.from(demoNote, {
      opacity: 0,
      y: 20,
      duration: 0.6,
      ease: 'power2.out',
      clearProps: 'all',
      scrollTrigger: { trigger: demoNote, start: 'top 85%', once: true },
    });
  }
})();
