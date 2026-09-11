// 병렬 OCR 의 유일한 불변식: 결과는 완료 순서가 아니라 **입력 순서**를 지킨다.
//
// 이게 깨지면 두 가지가 동시에 무너진다. mergeLines 는 직전 항목과만 중복을
// 비교하므로(lib/mergeLines.js) 순서가 뒤바뀌면 중복 제거가 헛돌고, OCR 경로에는
// 시간 기준 정렬이 없어서(sidepanel.js 의 sort 는 음성 전용) 뒤섞인 순서가 그대로
// 화면에 남는다. 눈에 잘 안 띄는 종류의 고장이라 여기서 못을 박는다.
const assert = require("assert");
const { ocrTesseract, tessWorkerCount } = require("./ai.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 뒤 프레임일수록 빨리 끝나는 워커. 완료 순서가 입력 순서의 정반대가 된다 —
// 순서 보존을 안 하면 결과가 뒤집힌다.
function reversingPool(size, total) {
  return Array.from({ length: size }, () => ({
    async recognize(frame) {
      const i = Number(frame.split(":")[1]);
      await sleep((total - i) * 4);
      return { data: { text: `텍스트${i}` } };
    },
  }));
}

(async () => {
  const N = 8;
  const frames = Array.from({ length: N }, (_, i) => `frame:${i}`);

  for (const workers of [1, 3, 8]) {
    const lines = await ocrTesseract(reversingPool(workers, N), frames, null);
    assert.strictEqual(lines.length, N);
    for (let i = 0; i < N; i++) {
      assert.strictEqual(lines[i], `텍스트${i}`, `워커 ${workers}개에서 ${i}번 결과가 어긋났다`);
    }
  }

  // 워커 하나가 계속 실패해도 나머지 결과가 밀리거나 섞이지 않는다.
  // 의도된 실패라 구현이 찍는 경고는 잠시 막는다 — 테스트 출력이 읽히게.
  const warn = console.warn;
  console.warn = () => {};
  const flaky = [
    { async recognize(f) { throw new Error("고장난 워커"); } },
    { async recognize(f) { await sleep(2); return { data: { text: `텍스트${f.split(":")[1]}` } }; } },
  ];
  const mixed = await ocrTesseract(flaky, frames, null);
  assert.strictEqual(mixed.length, N);
  for (let i = 0; i < N; i++) {
    assert.ok(mixed[i] === "" || mixed[i] === `텍스트${i}`, `${i}번 자리에 다른 프레임 결과가 들어갔다`);
  }
  assert.ok(mixed.some((l) => l !== ""), "한 워커가 고장나면 전부 비어버린다");
  console.warn = warn;

  // 진행률은 단조 증가해야 한다. 인덱스로 찍으면 3/8 다음에 1/8 이 나온다.
  const seen = [];
  await ocrTesseract(reversingPool(4, N), frames, (done) => seen.push(done));
  assert.deepStrictEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8], "진행률이 뒤죽박죽이다");

  // 여러 줄은 " / " 로 이어 붙인다 — 순차 구현에서 쓰던 형식 그대로여야 한다.
  const multi = await ocrTesseract(
    [{ async recognize() { return { data: { text: "제목\n  본문  \n\n꼬리" } } } }],
    ["frame:0"],
    null
  );
  assert.strictEqual(multi[0], "제목 / 본문 / 꼬리");

  // 워커 수는 코어를 다 먹지 않고 상한이 있다.
  const n = tessWorkerCount();
  assert.ok(n >= 1 && n <= 4, `워커 수가 범위를 벗어났다: ${n}`);

  console.log(`parallel: all tests passed (워커 ${n}개, 순서 보존 확인)`);
})();
