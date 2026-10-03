// tools/landing-copies.test.mjs
// landing/vendor 아래 복사본이 lib/ 원본과 바이트 단위로 같은지 확인한다.
// 다르면 원본에서 다시 복사해야 한다 — 손으로 고치는 파일이 아니다.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const sameBytes = (vendoredRel, libRel) => {
  const vendored = path.join(ROOT, vendoredRel);
  const lib = path.join(ROOT, libRel);
  assert.ok(fs.existsSync(lib), `${libRel} 원본이 없습니다`);
  assert.deepEqual(
    fs.readFileSync(vendored),
    fs.readFileSync(lib),
    `${vendoredRel} 이(가) 원본과 다릅니다. ${libRel} 을(를) ${vendoredRel} 로 다시 복사하세요.`,
  );
};

test("landing/vendor/summrizei/*.js 는 lib/ 의 같은 이름 파일과 동일", () => {
  const dir = path.join(ROOT, "landing/vendor/summrizei");
  const names = fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  assert.ok(names.length > 0, "landing/vendor/summrizei 에 js 파일이 없습니다");
  for (const name of names) sameBytes(`landing/vendor/summrizei/${name}`, `lib/${name}`);
});

test("landing/vendor/katex 는 lib/vendor/katex 와 동일", () => {
  sameBytes("landing/vendor/katex/katex.min.js", "lib/vendor/katex/katex.min.js");
  sameBytes("landing/vendor/katex/katex.min.css", "lib/vendor/katex/katex.min.css");
  const fontsDir = path.join(ROOT, "landing/vendor/katex/fonts");
  for (const name of fs.readdirSync(fontsDir)) {
    if (!fs.statSync(path.join(fontsDir, name)).isFile()) continue;
    sameBytes(`landing/vendor/katex/fonts/${name}`, `lib/vendor/katex/fonts/${name}`);
  }
});

test("landing/library.html 은 외부 스크립트 없이 connect-src 'none' 을 선언", () => {
  const html = fs.readFileSync(path.join(ROOT, "landing/library.html"), "utf8");
  assert.ok(
    !/<script[^>]+src=["']https?:\/\//i.test(html),
    "landing/library.html 에 http(s) 스크립트 src가 있으면 안 됩니다",
  );
  assert.ok(
    html.includes("connect-src 'none'"),
    "landing/library.html CSP에 connect-src 'none' 이 필요합니다",
  );
});
