// 가격의 원본은 supabase/schema-v2.sql의 plans 시드다. 계정 페이지는 DB(plan_catalog)를 읽지만
// 랜딩 첫 화면·llms.txt·thanks.html은 검색엔진과 JS 없는 환경을 위해 정적 텍스트라, 시드와 어긋나면 여기서 막는다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const seed = read("supabase/schema-v2.sql").match(/insert into plans \(plan, label, price_krw, edu_price_krw[^)]*\) values([\s\S]*?)on conflict/)[1];
const plans = Object.fromEntries([...seed.matchAll(/\('(\w+)', '([^']*)', (\d+), (null|\d+),/g)].map(([, id, label, price, edu]) => [id, { label, price: +price, edu: edu === "null" ? null : +edu }]));
const won = (n) => n.toLocaleString("ko-KR");

test("plans seed has exactly free, essential, professional", () => {
  assert.deepEqual(Object.keys(plans), ["free", "essential", "professional"]);
});

test("static landing prices match the plans seed", () => {
  const index = read("landing/index.html"), llms = read("landing/llms.txt"), thanks = read("landing/thanks.html");
  const offers = JSON.parse(index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"][0].offers;
  assert.deepEqual(offers.map((o) => [o.name, +o.price]), Object.values(plans).map((p) => [p.label, p.price]));
  const { essential, professional } = plans;
  assert.match(index, new RegExp(`data-price="${essential.price}" data-student="${essential.edu}">${won(essential.price)}원`));
  assert.match(index, new RegExp(`<p class="price">${won(professional.price)}원`));
  for (const text of [index, llms, thanks]) {
    const prices = [...text.matchAll(/(\d{1,3}(?:,\d{3})+)원/g)].map((m) => +m[1].replace(/,/g, ""));
    for (const p of prices) assert.ok([essential.price, essential.edu, professional.price].includes(p), `시드에 없는 가격 ${p}원`);
  }
});
