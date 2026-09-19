// 슬라이드의 그림을 노트에 다시 그리기 위한 입력.
//
// PP-OCRv5 는 글자만 읽는다. 회로도든 밴드 다이어그램이든 모델에게는 라벨 몇 개만
// 도착하고, 그림이 있었다는 사실조차 전달되지 않는다. 그런데 검출기는 이미 각 글자
// 상자의 좌표를 알고 있다 — 그걸 버리지 않고 같이 넘기면 모델이 배치를 보고 도식을
// 복원할 수 있다.
//
// ponytail: 그림 검출기를 따로 만들지 않는다. 임계값을 깎는 대신 좌표를 그대로 주고
// 판단은 모델에 맡긴다. 천장 — 라벨이 없는 곡선·파형은 이 방법으로 살릴 수 없다.
// 그건 이미지를 외부로 보내야만 되는 일이고, 저작권 경계상 별개 결정이다.
(() => {
  // 본문 슬라이드는 제목과 글머리가 한두 개의 x 에 줄맞춤된다. 그런 화면에 좌표를
  // 붙여봐야 토큰만 늘고 알려주는 것이 없다. 흩어진 배치일 때만 좌표를 싣는다.
  const COLUMN_TOLERANCE = 0.05, MIN_COLUMNS = 3, MIN_LINES = 3;

  function layoutText(lines, width, height) {
    const spoken = (lines || []).filter(line => line && String(line.text || "").trim());
    const plain = spoken.map(line => String(line.text).trim()).join("\n");
    // 일부만 좌표가 있으면 배치를 반만 아는 셈이라 오히려 틀린 그림을 그리게 한다.
    const placed = spoken.every(line => Number.isFinite(line.box?.x) && Number.isFinite(line.box?.y));
    if (!placed || !(width > 0) || !(height > 0) || spoken.length < MIN_LINES) return plain;

    const columns = new Set(spoken.map(line => Math.round(line.box.x / width / COLUMN_TOLERANCE)));
    if (columns.size < MIN_COLUMNS) return plain;

    const pct = (value, span) => Math.max(0, Math.min(99, Math.round(value / span * 100)));
    return spoken
      .map(line => `(${pct(line.box.x, width)},${pct(line.box.y, height)}) ${String(line.text).trim()}`)
      .join("\n");
  }

  if (typeof module !== "undefined") module.exports = { layoutText };
  if (typeof self !== "undefined") self.layoutText = layoutText;
})();
