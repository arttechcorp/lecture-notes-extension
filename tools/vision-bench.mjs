// 슬라이드 이미지 폴더를 /v1/vision 으로 돌려 지연·비용·수식 복원을 잰다.
// 요청: {model, requestId, slideId, t0, t1, image, mode:"full"} — 인덱스에서 slideId="s<N>", t0/t1 는 5초 단위.
// 응답: {slideDoc:{blocks,formulas,figures,...}, usage:{promptTokens,completionTokens,costUsd}, promptVersion, schemaVersion}
// 이 스크립트는 인자로 지정한 서비스에만 본인 슬라이드를 보낸다 — 수동 벤치 전용.
// 사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";

const [dir, baseUrl, token, model = "google/gemini-2.5-flash-lite"] = process.argv.slice(2);
if (!dir || !baseUrl || !token) { console.error("사용: node tools/vision-bench.mjs <슬라이드폴더> <서비스URL> <토큰> [모델]"); process.exit(1); }

const files = readdirSync(dir).filter(f => [".jpg", ".jpeg"].includes(extname(f).toLowerCase())).sort();
if (!files.length) { console.error("jpeg 파일이 없습니다."); process.exit(1); }

const cut = s => s.length > 160 ? s.slice(0, 160) + "…" : s;
let totalCost = 0, totalMs = 0, withMath = 0, empty = 0, failed = 0, totalBlocks = 0, totalFormulas = 0, totalFigures = 0;
const slides = [];

for (const [index, file] of files.entries()) {
  const image = "data:image/jpeg;base64," + readFileSync(join(dir, file)).toString("base64");
  const started = Date.now();
  const response = await fetch(baseUrl + "/v1/vision", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ model, requestId: "bench-" + Date.now() + "-" + index, slideId: "s" + (index + 1), t0: index * 5, t1: index * 5 + 5, image, mode: "full" }),
  });
  const elapsed = Date.now() - started;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    failed++;
    const error = body && body.error, code = typeof error === "string" ? error : error && error.code || "unknown";
    slides.push({ file, error: `HTTP ${response.status}: ${code}` });
    console.log(`${file}\tHTTP ${response.status}\t${code}`);
    continue;
  }
  const slideDoc = body && body.slideDoc;
  if (!slideDoc || typeof slideDoc !== "object") {
    failed++;
    slides.push({ file, error: "slideDoc 없음" });
    console.log(`${file}\t실패\tslideDoc 없음`);
    continue;
  }
  const blocks = slideDoc.blocks?.length || 0, figures = slideDoc.figures?.length || 0;
  // latex 가 비었으면 검증 안 된 text 가 전부다 — 어느 쪽에서 왔는지 같이 기억한다.
  const latex = [], kinds = [];
  for (const f of slideDoc.formulas || []) {
    if (typeof f.latex === "string" && f.latex.trim()) { latex.push(f.latex); kinds.push("LaTeX"); }
    else if (typeof f.text === "string" && f.text.trim()) { latex.push(f.text); kinds.push("텍스트"); }
  }
  slides.push({ file, ms: elapsed, blocks, formulas: latex.length, figures, latex, slideDoc });
  totalMs += elapsed; totalCost += body.usage?.costUsd || 0;
  totalBlocks += blocks; totalFormulas += latex.length; totalFigures += figures;
  if (latex.length) withMath++;
  if (!blocks && !latex.length && !figures) empty++;
  console.log(`${file}\t${(elapsed / 1000).toFixed(1)}s\t블록 ${blocks} · 수식 ${latex.length} · 도표 ${figures}`);
  for (const [i, s] of latex.entries()) console.log(`  ${kinds[i]}: ${cut(s)}`);
}

const done = files.length - failed;
console.log(`\n슬라이드 ${files.length}장 · 실패 ${failed}장 · 빈 결과 ${empty}장 · 수식 포함 ${withMath}장`);
console.log(`블록 ${totalBlocks}개 · 수식 ${totalFormulas}개 · 도표 ${totalFigures}개`);
console.log(`합계 ${(totalMs / 1000).toFixed(1)}초 (장당 ${done ? (totalMs / done / 1000).toFixed(1) : "-"}초) · $${totalCost.toFixed(4)} (약 ${(totalCost * 1400).toFixed(0)}원)`);
if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, JSON.stringify(slides));
