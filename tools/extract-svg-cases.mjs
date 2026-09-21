// 코퍼스 .md 에 박힌 인라인 SVG 를 뽑아 프로브가 싣는 classic 스크립트로 굽는다.
// 프로브는 file:// 로도 열리도록 모듈을 쓰지 않는다.
import fs from "node:fs";
import path from "node:path";

const SOURCE = "electric_circuits_note_example";
const cases = [];
for (const file of fs.readdirSync(SOURCE).filter(name => /^0[1-7].*\.md$/.test(name))) {
  const text = fs.readFileSync(path.join(SOURCE, file), "utf8");
  for (const [index, svg] of (text.match(/<svg[\s\S]*?<\/svg>/g) || []).entries()) {
    cases.push({ name: `${file.replace(/\.md$/, "")} #${index + 1}`, svg });
  }
}
fs.writeFileSync("tools/svg-figure-cases.js", `window.SVG_FIGURE_CASES = ${JSON.stringify(cases, null, 2)};\n`);
console.log(`${cases.length} cases -> tools/svg-figure-cases.js`);
