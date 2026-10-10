// landing/index.html 히어로 설치 앵커, account-menu 및 sidepanel 햄버거 메뉴 순서,
// 그리고 welcome.html 일반 가이드 및 스토어 URL을 검증하는 테스트.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const STORE_URL = "https://chromewebstore.google.com/detail/summrizei-%E2%80%94-%EA%B0%95%EC%9D%98-%EB%85%B8%ED%8A%B8/kcogkkdonnpinicnjmbjgpkandbgglpo?authuser=0&hl=ko";

test("landing hero has native install anchor to Chrome Web Store without data-reserve", () => {
  const index = read("landing/index.html");
  const heroMatch = index.match(/<div class="hero-actions offer-hero">([\s\S]*?)<\/div>/);
  assert.ok(heroMatch, "hero-actions offer-hero block must exist");
  const heroHtml = heroMatch[1];

  // 1. 네이티브 앵커 <a> 태그여야 하며 정확한 스토어 URL로 연결되어야 함
  assert.match(heroHtml, new RegExp(`<a [^>]*href="${STORE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`));
  assert.match(heroHtml, /지금 설치하기/);

  // 2. data-reserve 가 제거되어 예약창이 열리지 않아야 함
  assert.doesNotMatch(heroHtml, /data-reserve/);

  // 3. 배지와 모바일 안내가 설치 문맥으로 정리되어야 함
  assert.match(heroHtml, /<span class="cta-badge">Chrome 웹 스토어<\/span>/);
  assert.doesNotMatch(heroHtml, /출시 후 첫 달 무료/);
  assert.match(heroHtml, /데스크톱 Chrome에서 설치할 수 있어요/);
  assert.doesNotMatch(heroHtml, /모바일에서도 사전예약할 수 있어요/);
});

test("account-menu.js and sidepanel.html menus include '사용 방법 익히기' in second-tier order", () => {
  const accountMenu = read("landing/account-menu.js");
  const sidepanel = read("sidepanel.html");

  // account-menu.js: '구독 설정' 다음, footer(고객지원 등) 전 위치에 항상 노출
  assert.match(
    accountMenu,
    /link\("구독 설정",\s*"\/account\/subscription"\),\s*link\("사용 방법 익히기",\s*"\/welcome"\),\s*footer/,
    "account-menu.js must place '사용 방법 익히기' after subscription and before footer"
  );

  // sidepanel.html: '구독 설정' 다음, am-foot(고객지원 등) 전 위치에 항상 노출
  assert.match(
    sidepanel,
    /data-path="\/account\/subscription">구독 설정<\/button>\s*<button role="menuitem" type="button" data-path="\/welcome">사용 방법 익히기<\/button>\s*<div class="am-foot"/,
    "sidepanel.html must place '사용 방법 익히기' after subscription and before am-foot"
  );

  // 로그인/구매 없이 항상 표시되는지 확인 (hidden 속성이 없어야 함)
  const welcomeBtn = sidepanel.match(/<button[^>]*data-path="\/welcome"[^>]*>사용 방법 익히기<\/button>/);
  assert.ok(welcomeBtn, "welcome button must exist in sidepanel");
  assert.doesNotMatch(welcomeBtn[0], /\bhidden\b/, "welcome button must not have hidden attribute");
});

test("welcome.html is updated for general usage while retaining paid billing FAQs and accurate CWS URL", () => {
  const welcome = read("landing/welcome.html");

  // 제목 및 description이 일반 안내로 업데이트됨
  assert.match(welcome, /<title>사용 방법 익히기 — Summrizei<\/title>/);
  assert.match(welcome, /<meta name="description" content="[^"]*무료 사용자를 포함한[^"]*">/);

  // 히어로 문구
  assert.match(welcome, /<h1>설치부터 첫 노트까지,<br>Summrizei 사용 방법을 알아볼까요\?<\/h1>/);

  // Step 1 크롬 웹스토어 URL
  assert.match(welcome, new RegExp(`href="${STORE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.doesNotMatch(welcome, /chromewebstore\.google\.com\/search\/Summrizei/);

  // Step 2 로그인 안내
  assert.match(welcome, /<h3><small>STEP 2<\/small>계정으로 로그인하기<\/h3>/);
  assert.match(welcome, /Free 요금제도 로그인 후 바로 무료로 이용할 수 있어요/);

  // 유료 결제 계정 FAQ 유지
  assert.match(welcome, /결제했는데 Free로 나와요/);
  assert.match(welcome, /해지나 환불은 어떻게 하나요\?/);
});
