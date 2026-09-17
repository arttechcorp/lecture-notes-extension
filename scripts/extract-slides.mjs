// landing/hero-mockup.html 의 .lecture-slide 3개를 video/src/mockup/slides.ts 로 추출한다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("landing/hero-mockup.html", "utf8");
const slides = [];
for (const m of html.matchAll(/<div class="lecture-slide" data-slide="(\d)"[^>]*>([\s\S]*?)\n              <\/div>/g)) {
  const inner = m[2];
  const title = inner.match(/<div class="lecture-title">([\s\S]*?)<\/div>/)[1];
  const subtitle = inner.match(/<p class="lecture-subtitle">([\s\S]*?)<\/p>/)[1];
  const page = inner.match(/<span class="lecture-page">([\s\S]*?)<\/span>/)[1];
  const inkTitle = inner.match(/<title>([\s\S]*?)<\/title>/)[1];
  const ink = [...inner.matchAll(/<path data-ink pathLength="1" d="([^"]+)"\/>/g)].map((p) => p[1]);
  // 제목/부제/페이지/잉크를 뺀 본문(표·수식·정의)만 남긴다.
  const body = inner
    .replace(/<div class="lecture-title">[\s\S]*?<\/div>/, "")
    .replace(/<p class="lecture-subtitle">[\s\S]*?<\/p>/, "")
    .replace(/<span class="lecture-page">[\s\S]*?<\/span>/, "")
    .replace(/<svg class="lecture-ink"[\s\S]*?<\/svg>/, "")
    .trim();
  slides.push({ index: Number(m[1]), title, subtitle, page, inkTitle, body, ink });
}
if (slides.length !== 3) throw new Error(`expected 3 slides, got ${slides.length}`);
if (slides.some((s) => s.ink.length === 0)) throw new Error("slide with no ink paths");

mkdirSync("video/src/mockup", { recursive: true });
writeFileSync(
  "video/src/mockup/slides.ts",
  `// 자동 생성 — landing/hero-mockup.html 에서 추출. 수정하지 말 것.\n` +
    `// 재생성: node scripts/extract-slides.mjs\n\n` +
    `export type Slide = {\n  title: string;\n  subtitle: string;\n  page: string;\n  inkTitle: string;\n  body: string;\n  ink: string[];\n};\n\n` +
    `export const slides: Slide[] = ${JSON.stringify(slides.map(({ index, ...s }) => s), null, 2)};\n`
);
console.log(slides.map((s) => `slide ${s.index}: ${s.ink.length} ink paths, body ${s.body.length} chars`).join("\n"));
