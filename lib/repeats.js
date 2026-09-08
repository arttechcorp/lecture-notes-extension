// Whisper의 반복 루프를 걷어낸다.
//
// Whisper는 자기회귀 디코더라 "다음 토큰으로 방금 뱉은 구절이 가장 그럴듯한" 상태에
// 빠지면 스스로 못 빠져나온다. 길이 제한에 걸릴 때까지 같은 말을 반복한다
// ("제가 얘기하면 제가 얘기하면 제가 얘기하면 ..."). 저정보 구간이나 잘린 음절로
// 시작하는 청크에서 잘 생긴다.
//
// 모델을 건드리지 않고 결과만 접는다. 정당한 반복("네 네", "자 자")도 있으므로
// 몇 번까지는 남긴다.

// 같은 단위가 연속으로 반복되면 KEEP개만 남긴다. units는 단어 배열이거나 글자 배열.
function collapseUnits(units, maxPeriod, keep) {
  const out = units.slice();
  for (let n = 1; n <= maxPeriod; n++) {
    let i = 0;
    while (i + 2 * n <= out.length) {
      const unit = out.slice(i, i + n).join("\u0000");
      let reps = 1;
      while (
        i + (reps + 1) * n <= out.length &&
        out.slice(i + reps * n, i + (reps + 1) * n).join("\u0000") === unit
      ) {
        reps++;
      }
      if (reps > keep) {
        out.splice(i + keep * n, (reps - keep) * n);
        i += keep * n;
      } else {
        // n칸씩 건너뛰면 위상이 어긋난 반복을 놓친다. "오늘은 A B A B A B"에서
        // 반복 단위 "A B"는 인덱스 1에서 시작하는데 0,2,4만 보면 영영 못 찾는다.
        i++;
      }
    }
  }
  return out;
}

// 반환값의 removed는 걷어낸 단어 수 — 0보다 크면 그 청크에서 루프가 있었다는 뜻이다.
function collapseRepeats(text, keep = 2) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { text: "", removed: 0 };

  // 1단계: 단어 단위. "제가 얘기하면"처럼 띄어쓰기가 있는 반복을 잡는다.
  let kept = collapseUnits(words, 12, keep);

  // 2단계: 글자 단위. "감사합니다감사합니다"처럼 띄어쓰기 없이 붙은 반복을 잡는다.
  // 한국어는 띄어쓰기가 불안정해서 1단계만으론 새어나간다.
  kept = kept.map((w) => (w.length >= 4 ? collapseUnits(w.split(""), 10, keep).join("") : w));

  return { text: kept.join(" "), removed: words.length - kept.length };
}

if (typeof module !== "undefined") module.exports = { collapseRepeats, collapseUnits };
