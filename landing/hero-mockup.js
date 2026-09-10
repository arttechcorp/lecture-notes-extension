/* 히어로 목업의 인식 피드가 계속 쌓이는 것처럼 보이게 한다.
   실제 제품의 '캡처 중' 단계를 흉내 낸 연출일 뿐이며, 값은 전부 예시다. */
(() => {
  if (typeof gsap === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const wrap = document.querySelector('.panel-feed-lines');
  if (!wrap) return;
  const lines = [...wrap.querySelectorAll('.feed-line')];
  if (lines.length < 2) return;

  const script = [
    ['10:02', '회수기간법은 화폐의 시간가치를 반영하지 못합니다.'],
    ['10:18', '그래서 보조 지표로만 사용하는 편이 안전합니다.'],
    ['10:33', '할인율이 높아질수록 NPV는 작아집니다.'],
    ['10:51', '두 투자안의 NPV가 같아지는 지점을 피셔의 수익률이라 합니다.'],
    ['11:07', '규모가 비슷한 대안이라면 두 기준의 결론이 대체로 일치합니다.'],
    ['11:22', '시험에서는 상호배타적 조건을 먼저 확인하세요.'],
  ];

  const voiceCount = document.querySelector('[data-count="voice"]');
  let cursor = 0;

  function shift() {
    for (let i = 0; i < lines.length - 1; i++) {
      lines[i].querySelector('time').textContent = lines[i + 1].querySelector('time').textContent;
      lines[i].querySelector('p').textContent = lines[i + 1].querySelector('p').textContent;
    }
    const [time, text] = script[cursor % script.length];
    cursor += 1;
    const last = lines[lines.length - 1];
    last.querySelector('time').textContent = time;
    last.querySelector('p').textContent = text;
    if (voiceCount) voiceCount.textContent = String(Number(voiceCount.textContent) + 1);
  }

  gsap.timeline({ repeat: -1, repeatDelay: 2.2 })
    .to(wrap, { opacity: .35, duration: .18, ease: 'power1.in' })
    .call(shift)
    .to(wrap, { opacity: 1, duration: .25, ease: 'power1.out' })
    .from(lines[lines.length - 1], { opacity: 0, y: 6, duration: .35, ease: 'power2.out' }, '<');
})();
