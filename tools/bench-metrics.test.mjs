import test from "node:test";
import assert from "node:assert/strict";
import { editDistance, cerNorm, koreanCER, termHits, termRecall, formulaMatch, bboxIoU, reliabilityBins, ece, percentile, mp4Duration } from "./bench-metrics.mjs";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("editDistance: 코드 포인트 단위 레벤슈타인", () => {
  assert.equal(editDistance("abc", "abc"), 0);
  assert.equal(editDistance("kitten", "sitting"), 3);
  assert.equal(editDistance("", "abc"), 3);
  assert.equal(editDistance("abc", ""), 3);
  assert.equal(editDistance([1, 2, 3], [1, 3]), 1); // 배열도 받는다
  assert.equal(editDistance("🇰🇷가", "🇰🇷나"), 1); // 국기(서로게이트 쌍 2개)는 1코드 포인트
});

test("cerNorm: NFC + 공백·구두점 제거", () => {
  assert.equal(cerNorm(" 안녕, 하세요! "), "안녕하세요");
  assert.equal(cerNorm("한글".normalize("NFD")), "한글");
  assert.equal(cerNorm(""), "");
});

test("koreanCER", () => {
  assert.equal(koreanCER("안녕하세요", "안녕하세요"), 0);
  assert.equal(koreanCER("안녕 하세요!", "안녕하세요"), 0); // 공백·구두점 무시
  assert.equal(koreanCER("가나다라마바사아자차", "가나다라마바사아자카"), 0.1); // 10음절 중 1개 치환
  assert.ok(near(koreanCER("가나다", "가나다라"), 1 / 3)); // 삽입
  assert.ok(near(koreanCER("가나다", "가나"), 1 / 3)); // 삭제
  assert.equal(koreanCER("한글", "한글".normalize("NFD")), 0); // NFD 입력도 같다
  assert.equal(koreanCER("", ""), 0);
  assert.equal(koreanCER("", "가"), 1);
  assert.equal(koreanCER("가", "나다라마"), 4); // 1 초과 허용
});

test("termHits / termRecall", () => {
  const { hit, miss } = termHits(["Transformer", "어텐션 메커니즘"], "transformer는 어텐션메커니즘을 쓴다");
  assert.deepEqual(hit, ["Transformer", "어텐션 메커니즘"]); // 대소문자·띄어쓰기 무시
  assert.deepEqual(miss, []);
  assert.deepEqual(termHits(["없는용어"], "가나다").miss, ["없는용어"]);
  assert.equal(termRecall(["hello, world"], "hello world"), 1); // 구두점 무시
  assert.ok(near(termRecall(["a", "b", "없음"], "a b"), 2 / 3));
  assert.equal(termRecall([], "아무거나"), 1); // 용어가 없으면 1
  assert.equal(termRecall(["", "  ", "!!!"], "아무거나"), 1); // 빈 용어는 무시
});

test("formulaMatch", () => {
  assert.equal(formulaMatch("\\frac{a}{b}", "\\dfrac{a}{b}"), true);
  assert.equal(formulaMatch("(x)", "\\left( x \\right)"), true);
  assert.equal(formulaMatch("$$ x + y $$", "x+y"), true); // 바깥 $$·공백 무시
  assert.equal(formulaMatch("x+y", "x-y"), false);
  assert.equal(formulaMatch("", "x"), false); // 빈 기준은 매칭 아님
  assert.equal(formulaMatch("x", ""), false);
});

test("bboxIoU", () => {
  assert.equal(bboxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }), 1);
  assert.equal(bboxIoU({ x: 0, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }), 0);
  assert.ok(near(bboxIoU({ x: 0, y: 0, w: 2, h: 2 }, { x: 1, y: 0, w: 2, h: 2 }), 1 / 3)); // 절반 겹침: 2/6
  assert.equal(bboxIoU({ x: 0, y: 0, w: 4, h: 4 }, { x: 1, y: 1, w: 2, h: 2 }), 0.25); // 포함
});

test("reliabilityBins: 정확히 보정된 집합", () => {
  const probs = Array.from({ length: 10 }, () => [0.2, 0.8]);
  const labels = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]; // 정답률 0.8
  const bins = reliabilityBins(probs, labels);
  assert.equal(bins.length, 10);
  assert.equal(bins[8].n, 10); // conf 0.8 → [0.8, 0.9)
  assert.equal(bins[8].lo, 0.8);
  assert.equal(bins[8].hi, 0.9);
  assert.ok(near(bins[8].accuracy, 0.8));
  assert.ok(near(bins[8].confidence, 0.8));
  assert.equal(bins[0].n, 0);
  assert.equal(bins[0].accuracy, null); // 빈 bin 은 null
  assert.equal(bins[0].confidence, null);
  assert.ok(near(ece(probs, labels), 0));
});

test("ece: 과신 집합", () => {
  const probs = Array.from({ length: 10 }, () => [0.1, 0.9]); // conf 0.9
  const labels = [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]; // 정답률 0.5
  assert.ok(near(ece(probs, labels), 0.4)); // |0.5 - 0.9|
});

test("reliabilityBins: 단일 숫자 형태 (P=양성)", () => {
  const probs = [0.9, 0.8, 0.2, 0.1];
  const labels = [true, 1, false, 0];
  const bins = reliabilityBins(probs, labels);
  assert.equal(bins[9].n, 2); // conf 0.9 두 개
  assert.equal(bins[8].n, 2); // conf 0.8 두 개
  assert.equal(bins[9].accuracy, 1);
  assert.ok(near(ece(probs, labels), 0.15)); // 0.5·0.1 + 0.5·0.2
});

test("reliabilityBins: 빈 probs 건너뜀, conf 1 은 마지막 bin", () => {
  const bins = reliabilityBins([[], undefined, [0, 1]], [0, 0, 1]);
  assert.equal(bins.reduce((s, b) => s + b.n, 0), 1);
  assert.equal(bins[9].n, 1);
  assert.equal(bins[9].accuracy, 1);
  assert.equal(bins[9].confidence, 1);
  assert.equal(ece([[], undefined], [0, 0]), 0); // 유효 항목 0 → 0
});

test("percentile", () => {
  const xs = [1, 2, 3, 4];
  assert.equal(percentile(xs, 0), 1);
  assert.equal(percentile(xs, 50), 2.5); // 선형 보간
  assert.equal(percentile(xs, 25), 1.75);
  assert.ok(near(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9.1));
  assert.equal(percentile(xs, 100), 4);
  assert.equal(percentile([7], 90), 7);
  assert.equal(percentile([], 50), null);
  const unsorted = [4, 1, 3, 2];
  percentile(unsorted, 50);
  assert.deepEqual(unsorted, [4, 1, 3, 2]); // 입력 불변
});

// 테스트용 mp4 박스 조립: 4바이트 BE 크기 + 4바이트 타입 + 페이로드.
const box = (type, payload = Buffer.alloc(0)) => {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt32BE(8 + payload.length, 0);
  b.write(type, 4, "ascii");
  payload.copy(b, 8);
  return b;
};

test("mp4Duration: mvhd v0", () => {
  const mvhd = Buffer.alloc(20); // version 0 + flags
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(90500, 16); // duration
  const file = Buffer.concat([box("ftyp", Buffer.from("isom")), box("moov", box("mvhd", mvhd))]);
  assert.equal(mp4Duration(file), 90.5);
});

test("mp4Duration: mvhd v1", () => {
  const mvhd = Buffer.alloc(32);
  mvhd[0] = 1; // version 1
  mvhd.writeUInt32BE(44100, 20);
  mvhd.writeBigUInt64BE(88200n, 24);
  const file = Buffer.concat([box("moov", box("mvhd", mvhd))]);
  assert.equal(mp4Duration(file), 2);
});

test("mp4Duration: 잘린 파일·moov 없음·길이 0 → null", () => {
  const mvhd = Buffer.alloc(20);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(90500, 16);
  const good = Buffer.concat([box("ftyp", Buffer.alloc(4)), box("moov", box("mvhd", mvhd))]);
  assert.equal(mp4Duration(good.subarray(0, good.length - 6)), null); // moov 크기가 파일 끝을 넘음
  assert.equal(mp4Duration(box("ftyp", Buffer.alloc(4))), null); // moov 없음
  const zero = Buffer.alloc(20);
  zero.writeUInt32BE(1000, 12); // duration 0
  assert.equal(mp4Duration(box("moov", box("mvhd", zero))), null);
});
