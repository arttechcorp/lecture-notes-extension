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

// 평문 노트를 다루는 페이지라 네트워크는 로그인·키 조회용 Supabase 한 곳으로만 열고, 외부 스크립트는 supabase-js(jsDelivr) 하나만 허용한다.
test("landing/library.html 은 Supabase 한 곳으로만 연결하고 외부 스크립트는 supabase-js 뿐", () => {
  const html = fs.readFileSync(path.join(ROOT, "landing/library.html"), "utf8");
  const external = [...html.matchAll(/<script[^>]+src=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1]);
  assert.deepEqual(external, ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"]);
  const csp = /Content-Security-Policy"[^>]*content="([^"]+)"/.exec(html)?.[1] ?? "";
  assert.match(csp, /connect-src https:\/\/[a-z0-9]+\.supabase\.co;/, "connect-src 는 프로젝트 Supabase 주소 하나뿐");
  assert.ok(!/connect-src[^;]*\*/.test(csp) && !/connect-src[^;]*'self'/.test(csp));
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/);
  assert.ok(csp.includes(new URL(JSON.parse(JSON.stringify({ u: /url: "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "landing/supabase-config.js"), "utf8"))[1] })).u).origin), "CSP 의 Supabase 주소가 supabase-config.js 와 같아야 한다");
});
