// 화면 변화 감지의 보정을 못 박는다.
//
// 기준을 두 번 내렸는데도 실제 슬라이드 전환을 놓쳤다. 원인은 숫자가 아니라
// 지표였다 — 평균 절대차는 안 바뀐 배경이 값을 희석해서, 글자만 바뀌는 슬라이드
// 전환을 잡음 수준까지 끌어내린다. 지금은 "뚜렷하게 바뀐 픽셀의 비율"을 쓴다.
//
// content.js 는 브라우저용 IIFE 라 export 가 없다. 테스트를 위해 구조를 바꾸느니
// 실제로 배포되는 소스에서 함수를 꺼내 그대로 돌린다.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

const delta = Number(/const PIXEL_DELTA = (\d+)/.exec(src)?.[1]);
assert.ok(delta > 0, "content.js 에서 PIXEL_DELTA 를 못 찾았다");

const body = /function diffScore\(a, b\) \{([\s\S]*?)\n  \}/.exec(src)?.[1];
assert.ok(body, "content.js 에서 diffScore 를 못 찾았다");
const diffScore = new Function("PIXEL_DELTA", `return function diffScore(a, b) {${body}\n}`)(delta);

const threshold = Number(/region: \{[^}]*diffThreshold: (\d+)/.exec(src)?.[1]);
assert.ok(threshold > 0, "region 모드의 diffThreshold 를 못 찾았다");

const N = 48 * 27;
const make = (f) => Uint8Array.from({ length: N }, (_, i) => f(i));
const blank = make(() => 200);

// 압축 잡음: 픽셀당 ±2 정도로 흔들린다. 잡히면 안 된다.
const noise = make((i) => 200 + ((i * 37) % 5) - 2);
assert.strictEqual(diffScore(blank, noise), 0, "압축 잡음이 변화로 잡힌다");

// 첫 프레임은 비교 대상이 없다 — 무조건 캡처되어야 한다.
assert.strictEqual(diffScore(null, blank), Infinity);
assert.ok(diffScore(null, blank) > threshold);

// 글자 한두 줄이 바뀐 정도(전체의 3%)는 잡아야 한다. 두 번 놓쳤던 바로 그 경우다.
const smallText = make((i) => (i < Math.round(N * 0.03) ? 30 : 200));
assert.ok(
  diffScore(blank, smallText) >= threshold,
  `3% 글자 변경을 놓친다 (${diffScore(blank, smallText).toFixed(1)}% < 기준 ${threshold}%)`
);

// 실측에서 평균차 17.1 로 나왔던 변화 = 대략 10% 픽셀 변경. 여유 있게 잡혀야 한다.
const realCase = make((i) => (i < Math.round(N * 0.1) ? 30 : 200));
assert.ok(diffScore(blank, realCase) > threshold * 2, "실측 사례가 아슬아슬하게 잡힌다");

// 값이 비율(%)이라는 것 자체를 고정한다. 0~100 을 벗어나면 기준의 의미가 깨진다.
assert.strictEqual(diffScore(blank, blank), 0);
assert.strictEqual(diffScore(blank, make(() => 30)), 100);

console.log(
  `diff: all tests passed (기준 ${threshold}%, 픽셀 델타 ${delta}, ` +
    `3% 변경 → ${diffScore(blank, smallText).toFixed(1)}%, 잡음 → 0%)`
);
