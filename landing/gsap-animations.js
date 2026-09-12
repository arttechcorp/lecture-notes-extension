/* GSAP을 쓰는 곳은 이 파일뿐이다. 의존성을 유지하는 이유를 남겨둔다.
   1) 히어로 진입 타임라인 - eyebrow → h1 → lead → hero-actions → .mock 순서 연출.
      순서가 있는 stagger라 CSS transition으로는 지연값을 손으로 계산해야 한다.
   2) ScrollTrigger 1회 등장 - .value-strip / .source-panel / .plan-grid / .steps / .faq-list / .demo-note.
      `animation-timeline: view()`는 Safari 미지원이라 아직 대체하지 않는다.
   위 두 가지를 쓰지 않게 되면 index.html의 CDN 두 줄과 함께 통째로 지운다.
   진입 애니메이션의 초기 상태(opacity 0)는 landing.css의 `html.gsap-enter`가 갖고 있다.
   페인트된 뒤 다시 사라지는 깜빡임을 막기 위해서다. 여기서 그 클래스를 걷어낸다. */
(() => {
  const root = document.documentElement;
  if (typeof gsap === 'undefined') { root.classList.remove('gsap-enter'); return; }
  if (window.matchMedia('(prefers-reduced-motion: reduce), (max-width: 760px)').matches) { root.classList.remove('gsap-enter'); return; }

  if (typeof ScrollTrigger !== 'undefined') gsap.registerPlugin(ScrollTrigger);

  // Hero entrance on load: eyebrow -> h1 -> lead -> hero-actions, then the browser mockup.
  const heroCopyItems = document.querySelectorAll('.hero-copy > .eyebrow, .hero-copy > h1, .hero-copy > .lead, .hero-copy > .hero-actions');
  const heroMock = document.querySelector('.mock');
  if (heroCopyItems.length || heroMock) {
    // 시작 상태를 먼저 인라인으로 고정한 뒤 클래스를 걷어야 한 프레임도 깜빡이지 않는다.
    if (heroCopyItems.length) gsap.set(heroCopyItems, { opacity: 0, y: 20 });
    if (heroMock) gsap.set(heroMock, { opacity: 0, y: 28 });
    root.classList.remove('gsap-enter');
    const tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    if (heroCopyItems.length) tl.to(heroCopyItems, { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, clearProps: 'all' });
    if (heroMock) tl.to(heroMock, { opacity: 1, y: 0, duration: 0.8, clearProps: 'all' }, heroCopyItems.length ? '-=0.4' : 0);
  } else {
    root.classList.remove('gsap-enter');
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
