// 슬라이드 이미지 폴더를 /v1/vision 으로 돌려 지연·비용·LaTeX 복원을 잰다.
// 사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const [dir, baseUrl, token, model = "google/gemini-2.5-flash-lite"] = process.argv.slice(2);
if (!dir || !baseUrl || !token) { console.error("사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]"); process.exit(1); }

const files = readdirSync(dir).filter(f => [".jpg", ".jpeg"].includes(extname(f).toLowerCase())).sort();
if (!files.length) { console.error("jpeg 파일이 없습니다."); process.exit(1); }

const hasMath = text => /\$[^$]+\$/.test(text);
let totalCost = 0, totalMs = 0, withMath = 0, empty = 0, failed = 0;
const slides = [];

for (const [index, file] of files.entries()) {
  const image = "data:image/jpeg;base64," + readFileSync(join(dir, file)).toString("base64");
  const started = Date.now();
  const response = await fetch(baseUrl + "/v1/vision", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ model, requestId: "bench-" + Date.now() + "-" + index, image }),
  });
  const elapsed = Date.now() - started;
  if (!response.ok) {
    failed++;
    const err = (await response.json()).error;
    slides.push({ file, error: `HTTP ${response.status}: ${err}` });
    console.log(`${file}\tHTTP ${response.status}\t${err}`);
    continue;
  }
  const { text, usage } = await response.json();
  slides.push({ file, ms: elapsed, chars: text.length, text });
  totalMs += elapsed; totalCost += usage.costUsd || 0;
  if (hasMath(text)) withMath++;
  if (!text.trim()) empty++;
  console.log(`${file}\t${(elapsed / 1000).toFixed(1)}s\t${text.length}자\t${hasMath(text) ? "수식" : "-"}`);
}

const done = files.length - failed;
console.log(`\n슬라이드 ${files.length}장 · 실패 ${failed}장 · 빈 결과 ${empty}장 · 수식 포함 ${withMath}장`);
console.log(`합계 ${(totalMs / 1000).toFixed(1)}초 (장당 ${done ? (totalMs / done / 1000).toFixed(1) : "-"}초) · $${totalCost.toFixed(4)} (약 ${(totalCost * 1400).toFixed(0)}원)`);
if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(slides));
