// tools/print-check.mjs
// 개발 CI 전용 인쇄 및 조판 검수 도구 (docs/architecture-v2.md §6.3, 제안서 §6, §8 P3)
// 합성 노트 fixture(깨진 참조·파싱 불가 수식·긴 표·가로 넓은 수식·이미지 실패)를 렌더하고
// 로컬 Headless Chromium을 통해 PDF 및 기하 무결성을 검사한다.
// 최소 출시 조건: 합성 fixture의 깨진 참조 0, 파싱 불가 수식 0, 가로 overflow 0.
// 주의: 이 도구는 개발 전용이며 확장 배포 패키지(CWS)에 포함되지 않는다.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, execSync, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import katex from "../lib/vendor/katex/katex.min.js";
import NoteContract from "../lib/note-contract.js";
import NoteSpec from "../lib/note-spec.js";
import NoteRender from "../lib/note-render.js";
import PrintCheck from "../lib/print-check.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

/**
 * 시스템 내 Headless Chromium 또는 Google Chrome 실행 경로를 탐색한다.
 */
export function findChromium() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }

  const standardMacPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ];

  for (const p of standardMacPaths) {
    if (fs.existsSync(p)) return p;
  }

  const binaries = ["google-chrome", "chromium", "chrome", "google-chrome-stable"];
  for (const b of binaries) {
    try {
      const p = execSync(`which ${b}`, { stdio: ["pipe", "pipe", "ignore"], encoding: "utf8" }).trim();
      if (p && fs.existsSync(p)) return p;
    } catch {
      // 계속 탐색
    }
  }

  return null;
}

/**
 * PyMuPDF(fitz) 라이브러리 설치 여부를 확인한다.
 */
export function hasPyMuPDF() {
  try {
    execFileSync("python3", ["-c", "import fitz"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 스트레스 테스트용 합성 노트 fixture를 생성한다.
 * 포함 요소:
 * 1. 깨진 참조 (broken reference: 미등록 F999)
 * 2. 파싱 불가 수식 (unparseable KaTeX: 문법 오류)
 * 3. 긴 표 (long table: 다중 페이지 분할)
 * 4. 가로 넓은 수식 (wide formula)
 * 5. 실패 이미지 (failed image)
 */
export function createSyntheticFixture() {
  const tableCells = [["번호", "이름", "분류", "비고"]];
  for (let i = 1; i <= 35; i++) {
    tableCells.push([String(i), `항목_${i}`, `유형_${(i % 3) + 1}`, `데이터_${i * 10}`]);
  }

  return {
    noteSpecVersion: NoteContract.NOTE_SPEC_VERSION,
    status: "complete",
    tier: "paid",
    policy: { externalAugmentation: false, syntheticExamples: false },
    meta: { title: "합성 스트레스 테스트 강의 노트", date: "2026-10-06" },
    concepts: [],
    global: [],
    dropped: [],
    pruned: [],
    notices: [],
    sources: [],
    advisories: [],
    figures: [
      {
        id: "G1",
        evidenceId: "U1.s1",
        kind: "table",
        title: "장문 분할 표",
        cells: tableCells,
        chartData: null,
        t0: 10,
        display: "table",
      },
      {
        id: "G2",
        evidenceId: "U1.s2",
        kind: "diagram",
        title: "실패한 도표 이미지",
        cells: null,
        chartData: null,
        t0: 20,
        display: "crop",
      },
    ],
    registry: [
      {
        id: "F1",
        latex: "E = mc^2",
        display: "latex",
        t0: 5,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F2",
        latex: "\\sum_{i=1}^{100} \\prod_{j=1}^{50} \\left( \\frac{X_{i,j} + Y_{i,j}}{\\sqrt{Z_{i,j}}} \\right) = \\Omega_{total}",
        display: "latex",
        t0: 15,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F3",
        latex: "\\frac{1}{", // 파싱 불가 LaTeX
        display: "latex",
        t0: 25,
        evidenceIds: ["U1.s1"],
      },
    ],
    sections: [
      {
        sectionId: "S1",
        number: 1,
        title: "스트레스 테스트 단원",
        question: null,
        stage: "understand",
        unitIds: ["U1"],
        range: { t0: 0, t1: 100 },
        gist: null,
        blocks: [
          {
            id: "S1_B1",
            type: "B05",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              conceptId: "C1",
              term: "수식 및 참조 검증",
              original: null,
              definition: {
                text: "정상 식 {{F1}}, 넓은 식 {{F2}}, 깨진 식 {{F999}}, 오류 식 {{F3}}을 참조한다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              explanation: null,
              mechanism: null,
              scope: [],
              examples: [],
            },
          },
          {
            id: "S1_B2",
            type: "B10",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              title: "표 및 도표",
              kind: "calc",
              goal: null,
              formulaIds: ["F1", "F2", "F3"],
              figureIds: ["G1", "G2"],
              variables: [],
              assumptions: [],
              inputs: [],
              steps: [],
              derived: [],
              reading: [],
              result: null,
              limits: [],
              withheld: null,
            },
          },
        ],
        checks: [],
      },
    ],
  };
}

/**
 * 최소 출시 조건 검증용 정상 골든 fixture를 생성한다.
 * 깨진 참조 0, 파싱 불가 수식 0, 가로 overflow 0이 보장되어야 한다.
 */
export function createReleaseFixture() {
  return {
    noteSpecVersion: NoteContract.NOTE_SPEC_VERSION,
    status: "complete",
    tier: "paid",
    policy: { externalAugmentation: false, syntheticExamples: false },
    meta: { title: "골든 릴리스 테스트 강의 노트", date: "2026-10-06" },
    concepts: [],
    global: [],
    dropped: [],
    pruned: [],
    notices: [],
    sources: [],
    advisories: [],
    figures: [
      {
        id: "G1",
        evidenceId: "U1.s1",
        kind: "table",
        title: "거래 비용 비교",
        cells: [
          ["기준", "시장 거래", "기업 내부"],
          ["탐색 비용", "높음", "낮음"],
          ["협상 비용", "계약마다 발생", "사내 조정"],
          ["기회주의 위험", "높음", "낮음"],
        ],
        chartData: null,
        t0: 30,
        display: "table",
      },
    ],
    registry: [
      {
        id: "F1",
        latex: "TC = C_{market} + C_{contract}",
        display: "latex",
        t0: 10,
        evidenceIds: ["U1.s1"],
      },
      {
        id: "F2",
        latex: "\\Delta C = C_{internal} - C_{market}",
        display: "latex",
        t0: 20,
        evidenceIds: ["U1.s1"],
      },
    ],
    sections: [
      {
        sectionId: "S1",
        number: 1,
        title: "거래비용이론 핵심",
        question: null,
        stage: "understand",
        unitIds: ["U1"],
        range: { t0: 0, t1: 60 },
        gist: null,
        blocks: [
          {
            id: "S1_B1",
            type: "B05",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              conceptId: "C1",
              term: "거래 비용",
              original: "Transaction Cost",
              definition: {
                text: "시장에서 거래를 수행할 때 발생하는 모든 비용으로 식 {{F1}}과 같이 표현된다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              explanation: {
                text: "내부화 여부는 비용 차이인 식 {{F2}}에 따라 결정된다.",
                evidenceIds: ["U1.s1"],
                basis: "lecture",
              },
              mechanism: null,
              scope: [],
              examples: [],
            },
          },
          {
            id: "S1_B2",
            type: "B10",
            sectionId: "S1",
            status: "supported",
            importance: "core",
            emphasis: [],
            content: {
              title: "거래비용 모형",
              kind: "calc",
              goal: null,
              formulaIds: ["F1", "F2"],
              figureIds: ["G1"],
              variables: [],
              assumptions: [],
              inputs: [],
              steps: [],
              derived: [],
              reading: [],
              result: null,
              limits: [],
              withheld: null,
            },
          },
        ],
        checks: [],
      },
    ],
  };
}

/**
 * 렌더된 노트를 완전한 독립 HTML 문서로 포장한다.
 * <base>는 인라인된 KaTeX CSS가 fonts/ 상대 경로를 실제 벤더 디렉터리에서 찾게 한다.
 */
export function buildStandaloneHtml(note, crops = {}) {
  const { html, warnings } = NoteRender.renderNote(note, {
    katex,
    crops,
    options: { medium: "print" },
  });

  const katexCss = fs.readFileSync(path.join(ROOT, "lib/vendor/katex/katex.min.css"), "utf8");
  const katexBase = pathToFileURL(path.join(ROOT, "lib", "vendor", "katex") + "/").href;

  return {
    warnings,
    html: `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<base href="${katexBase}">
<title>${note.meta?.title || "노트 인쇄 검수"}</title>
<style>
${katexCss}
</style>
<style>
body { margin: 0; padding: 0; background: #fff; }
</style>
</head>
<body>
${html}
</body>
</html>`,
  };
}

/**
 * 기하 검출기 자기 검증용 합성 문서.
 * 고정 높이 spacer로 요소를 쪽 경계(1014px 간격)에 정확히 배치해
 * 각 검수 코드가 실제 DOM 측정으로 유발되는지 확인한다.
 * - pre: 쪽 경계를 걸치지만 한 쪽보다 작음 → 인쇄 시 다음 쪽으로 밀려나므로 세로 넘침이 아님(오탐 방지 확인)
 * - svg: 한 쪽(1014px)보다 큼 → OVERFLOW_Y
 * - table(786px): 가로 넘침 → OVERFLOW_X
 * - h3: 쪽 바닥 48px 이내 → HEADING_ORPHAN
 * - .answer: 헤드와 해설 첫 줄이 다른 쪽 → ANSWER_SPLIT
 * - .note-table tbody tr: 쪽 경계를 가로지르는 행 → TABLE_ROW_CLIPPED
 * - p(10px): FONT_SIZE_VIOLATION, span.katex-error: KATEX_ERROR, img decodeFailed: IMAGE_FAILED
 */
export function buildGeometryProbeHtml() {
  const PH = PrintCheck.A4.CONTENT_HEIGHT_PX; // 1014
  const PW = PrintCheck.A4.CONTENT_WIDTH_PX;  // 686
  const spacer = px => `<div style="height:${Math.round(px)}px"></div>`;
  const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  const parts = [];
  parts.push(spacer(900));                                       // y=900
  parts.push(`<pre style="height:200px">s</pre>`);               // 900~1100, 쪽 경계 걸침(오탐 확인용)
  parts.push(`<svg width="100" height="${PH + 200}" style="display:block"></svg>`); // 1100~2314, 한 쪽 초과
  parts.push(spacer(680));                                       // y≈2994
  parts.push(`<h3 style="font-size:20px;line-height:24px">t</h3>`); // 쪽2 바닥(3042) 근처 → 고아
  parts.push(`<p style="height:20px">n</p>`);
  parts.push(spacer(762));                                       // y≈3800
  parts.push(`<div class="answer"><div class="answer-head" style="height:30px">h</div>${spacer(300)}<div class="answer-body"><p style="height:20px">a</p></div></div>`);
  parts.push(spacer(895));                                       // y≈5045, 쪽5 경계(5070) 근처
  parts.push(`<table class="note-table"><tbody><tr><td style="height:60px">r</td></tr></tbody></table>`); // 행이 5070을 가로지름
  parts.push(`<p style="font-size:10px">x</p>`);
  parts.push(`<span class="katex-error">x</span>`);
  parts.push(`<img src="${gif}" data-decode-failed="true" alt="">`);
  parts.push(`<table class="note-table" style="width:${PW + 100}px"><tbody><tr><td>w</td><td>w</td></tr></tbody></table>`); // 가로 넘침
  parts.push(spacer(840));                                       // 쪽6 경계(6084) 직전으로 배치
  parts.push(`<figure class="note-fig" data-fig="G_SPLIT" id="S1_FIG_SPLIT" style="height:150px"><span class="note-fig-title" style="display:block;height:30px">도표 제목</span><img src="${gif}" style="display:block;height:80px" alt=""><div class="note-fig-explanation" style="display:block;height:40px"><p>도표 해설</p></div></figure>`); // 6084 경계를 걸침 -> FIGURE_UNIT_SPLIT
  parts.push(`<figure class="note-fig" data-fig="G_TALL" data-allow-split="true" style="height:${PH + 100}px"><span class="note-fig-title" style="display:block;height:30px">거대 도표</span><div style="height:${PH}px"></div></figure>`); // 1쪽 초과 + 분할 허용 -> 예외 허용

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>기하 검출 probe</title>
<style>
* { margin: 0; padding: 0; }
body { margin: 0; padding: 0; background: #fff; }
.note { width: ${PW}px; }
</style>
</head>
<body>
<article class="note">
${parts.join("\n")}
</article>
</body>
</html>`;
}

/**
 * 페이지 내에서 폰트·이미지 준비를 기다린 뒤 DOM 기하를 측정하는 드라이버 식.
 * Promise를 반환하며 최종 값은 측정 JSON 문자열이다.
 * 주의: 비페이지 DOM의 top/pageHeight 모델이다 — 실제 PDF 단편화 결과가 아니다.
 */
const CHECK_DRIVER_EXPR = `(async () => {
  var out = { measured: false, reason: null, check: null, representativePages: null };
  try {
    var note = document.querySelector(".note") || document.body;
    var done = (async () => {
      await PrintCheck.waitForPrintReady(note);
      var adapter = PrintCheck.createBrowserDomAdapter(note);
      out.check = PrintCheck.checkPrintLayout(adapter);
      out.representativePages = PrintCheck.getRepresentativePages ? PrintCheck.getRepresentativePages(adapter) : null;
      out.measured = true;
      return out;
    })();
    out = await Promise.race([done, new Promise(r => setTimeout(() => r({ measured: false, reason: "in-page-timeout", check: null, representativePages: null }), 8000))]);
  } catch (e) {
    out.reason = String(e && e.message ? e.message : e);
  }
  return JSON.stringify(out);
})()`;

function printCheckSource() {
  const src = fs.readFileSync(path.join(ROOT, "lib", "print-check.js"), "utf8");
  if (src.includes("</script")) throw new Error("print-check.js에 </script>가 있어 인라인 삽입이 불가합니다.");
  return src;
}

/**
 * 문서 끝에 print-check.js와 측정 드라이버를 삽입한다 (--dump-dom 폴백 경로용).
 * 드라이버는 폰트·이미지 완료를 기다린 뒤 측정 JSON을 #print-check-result에 기록한다.
 */
export function buildInstrumentedHtml(html) {
  if (typeof html !== "string" || !html.length) throw new Error("계측할 HTML이 필요합니다.");
  const src = printCheckSource();
  const driver = `(async () => {
  var json = await (${CHECK_DRIVER_EXPR});
  var pre = document.createElement("pre");
  pre.id = "print-check-result";
  pre.style.display = "none";
  pre.textContent = json;
  document.body.appendChild(pre);
})();`;

  const inject = `<script>\n${src}\n</script>\n<script>\n${driver}\n</script>`;
  const idx = html.lastIndexOf("</body>");
  return idx >= 0 ? html.slice(0, idx) + inject + "\n" + html.slice(idx) : html + inject;
}

/**
 * --dump-dom 출력에서 드라이버가 남긴 측정 JSON을 추출한다.
 * <pre> 본문은 HTML 이스케이프되므로 최소 엔티티를 되돌린다.
 */
export function extractCheckResult(dumpedDom) {
  if (typeof dumpedDom !== "string") return null;
  const m = dumpedDom.match(/<pre id="print-check-result"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) return null;
  const text = m[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Headless Chromium + CDP로 문서를 print media로 열어 DOM 기하를 실측한다.
 * - @media print 규칙이 실제로 적용되고, 뷰포트를 A4 본문 상자(686×1014px)로 맞춘다.
 * - 폰트 완료와 이미지 디코드를 기다린 뒤 측정한다.
 * - 주의: 비페이지 DOM 모델이다. 요소 top/pageHeight로 쪽 판정을 근사하며
 *   실제 PDF 단편화(fragmentation) 결과를 직접 측정하는 것이 아니다.
 */
async function measureDomGeometryCdp(chromeBin, html, { timeoutMs = 45000 } = {}) {
  if (typeof WebSocket !== "function" || typeof fetch !== "function") {
    throw new Error("cdp-unavailable: WebSocket/fetch 미지원 Node");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srz-geom-"));
  const profileDir = path.join(tmpDir, "profile");
  const htmlPath = path.join(tmpDir, "probe.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  const child = spawn(chromeBin, [
    "--headless",
    "--disable-gpu",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "about:blank",
  ], { stdio: "ignore" });

  let ws = null;
  let spawnError = null;
  child.on("error", e => { spawnError = e; });
  try {
    const deadline = Date.now() + timeoutMs;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // DevToolsActivePort에서 실제 디버그 포트를 읽는다
    const portFile = path.join(profileDir, "DevToolsActivePort");
    let port = 0;
    while (Date.now() < deadline && !port) {
      if (spawnError) throw new Error(`chromium-spawn-failed: ${spawnError.message}`);
      if (child.exitCode !== null) throw new Error(`chromium-exited(${child.exitCode})`);
      try {
        if (fs.existsSync(portFile)) {
          port = parseInt(fs.readFileSync(portFile, "utf8").split("\n")[0], 10) || 0;
        }
      } catch { /* 읽기 경합 무시 */ }
      if (!port) await sleep(100);
    }
    if (!port) throw new Error("devtools-port-timeout");

    // 페이지 target의 WebSocket 주소 획득
    let pageWs = null;
    while (Date.now() < deadline && !pageWs) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find(t => t.type === "page");
        if (page) pageWs = page.webSocketDebuggerUrl;
      } catch { /* 아직 준비 안 됨 */ }
      if (!pageWs) await sleep(100);
    }
    if (!pageWs) throw new Error("cdp-target-timeout");

    ws = await Promise.race([
      new Promise((resolve, reject) => {
        const sock = new WebSocket(pageWs);
        sock.onopen = () => resolve(sock);
        sock.onerror = () => reject(new Error("ws-connect-failed"));
      }),
      sleep(10000).then(() => Promise.reject(new Error("ws-connect-timeout"))),
    ]);

    let seq = 0;
    const pending = new Map();
    const eventWaiters = [];
    ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
        return;
      }
      if (msg.method) {
        for (let i = eventWaiters.length - 1; i >= 0; i--) {
          if (eventWaiters[i].method === msg.method) {
            eventWaiters[i].resolve(msg);
            eventWaiters.splice(i, 1);
          }
        }
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const waitEvent = (method, ms) => Promise.race([
      new Promise(resolve => eventWaiters.push({ method, resolve })),
      sleep(ms).then(() => null),
    ]);

    await send("Page.enable");
    await send("Emulation.setEmulatedMedia", { media: "print" });
    // A4 본문 상자를 뷰포트로 둬서 print media 레이아웃 폭이 쪽 폭과 같아지게 한다
    await send("Emulation.setDeviceMetricsOverride", {
      width: PrintCheck.A4.CONTENT_WIDTH_PX,
      height: PrintCheck.A4.CONTENT_HEIGHT_PX,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send("Page.addScriptToEvaluateOnNewDocument", { source: printCheckSource() });

    const loaded = waitEvent("Page.loadEventFired", 15000);
    await send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await loaded;

    const evalRes = await send("Runtime.evaluate", {
      expression: CHECK_DRIVER_EXPR,
      awaitPromise: true,
      returnByValue: true,
    });
    const text = evalRes?.result?.value;
    const out = typeof text === "string" ? JSON.parse(text) : null;
    if (!out || !out.measured) {
      return { measured: false, media: "print", reason: out?.reason || "in-page-check-failed", check: null, representativePages: null };
    }
    return { measured: true, media: "print", reason: null, check: out.check, representativePages: out.representativePages };
  } finally {
    try { ws?.close(); } catch {}
    try { child.kill("SIGKILL"); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * --dump-dom 폴백: screen media + 비페이지 DOM 기하.
 * print media는 적용되지 않으므로 media:"screen"으로 명시한다.
 */
function measureDomGeometryDumpDom(chromeBin, html, { timeoutMs = 45000 } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srz-geom-"));
  try {
    const htmlPath = path.join(tmpDir, "probe.html");
    fs.writeFileSync(htmlPath, buildInstrumentedHtml(html), "utf8");

    const dom = execFileSync(chromeBin, [
      "--headless",
      "--disable-gpu",
      `--user-data-dir=${path.join(tmpDir, "profile")}`,
      `--window-size=${PrintCheck.A4.CONTENT_WIDTH_PX},${PrintCheck.A4.CONTENT_HEIGHT_PX}`,
      "--virtual-time-budget=15000",
      "--dump-dom",
      pathToFileURL(htmlPath).href,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });

    const res = extractCheckResult(dom);
    if (!res) return { measured: false, media: "screen", reason: "result-marker-missing", check: null, representativePages: null };
    if (!res.measured) return { measured: false, media: "screen", reason: res.reason || "in-page-check-failed", check: null, representativePages: null };
    return { measured: true, media: "screen", reason: null, check: res.check, representativePages: res.representativePages };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * DOM 기하 프리플라이트 측정 (비페이지 모델 — 실제 PDF 단편화 측정이 아니다).
 * print media(CDP)를 우선 시도하고, 실패하면 screen media dump-dom으로 내려간다.
 * 둘 다 불가하면 measured:false와 사유를 반환한다 — 0으로 대체하지 않는다.
 */
export async function measureDomGeometry(chromeBin, html, opts = {}) {
  if (!chromeBin) return { measured: false, media: null, reason: "chromium-unavailable", check: null, representativePages: null };

  try {
    return await measureDomGeometryCdp(chromeBin, html, opts);
  } catch (err) {
    try {
      const res = measureDomGeometryDumpDom(chromeBin, html, opts);
      res.cdpError = String(err && err.message ? err.message : err);
      return res;
    } catch (err2) {
      return {
        measured: false,
        media: null,
        reason: `cdp-failed: ${err.message}; dump-dom-failed: ${err2.message}`,
        check: null,
        representativePages: null,
      };
    }
  }
}

/**
 * PyMuPDF로 PDF의 실제 콘텐츠 bbox를 측정한다.
 * @page 14.3mm(≈40.5pt) 여백 밖으로 나간 콘텐츠를 넘침으로 센다.
 * PyMuPDF가 없으면 미측정(measured:false)을 명시한다.
 */
export function measurePdfGeometry(pdfPath) {
  if (!hasPyMuPDF()) return { measured: false, reason: "pymupdf-unavailable", pages: null };

  const script = [
    "import fitz, json, sys",
    "doc = fitz.open(sys.argv[1])",
    "pages = []",
    "for p in doc:",
    "    r = p.rect; x0 = r.width; y0 = r.height; x1 = 0.0; y1 = 0.0; n = 0",
    "    for b in p.get_text('blocks'):",
    "        x0 = min(x0, b[0]); y0 = min(y0, b[1]); x1 = max(x1, b[2]); y1 = max(y1, b[3]); n += 1",
    "    for d in p.get_drawings():",
    "        rr = d.get('rect')",
    "        if rr: x0 = min(x0, rr.x0); y0 = min(y0, rr.y0); x1 = max(x1, rr.x1); y1 = max(y1, rr.y1); n += 1",
    "    for im in p.get_images(full=True):",
    "        try:",
    "            bb = p.get_image_bbox(im)",
    "            x0 = min(x0, bb.x0); y0 = min(y0, bb.y0); x1 = max(x1, bb.x1); y1 = max(y1, bb.y1); n += 1",
    "        except Exception:",
    "            pass",
    "    pages.append({'w': round(r.width,1), 'h': round(r.height,1), 'left': round(x0,1) if n else None, 'top': round(y0,1) if n else None, 'right': round(x1,1), 'bottom': round(y1,1), 'items': n})",
    "print(json.dumps(pages))",
  ].join("\n");

  try {
    const out = execFileSync("python3", ["-c", script, pdfPath], { encoding: "utf8", timeout: 30000 });
    const pages = JSON.parse(out);
    const MARGIN_PT = 14.3 * 72 / 25.4; // ≈ 40.5pt
    let overflowXPages = 0;
    let overflowYPages = 0;
    for (const pg of pages) {
      if (pg.left !== null && (pg.left < MARGIN_PT - 2 || pg.right > pg.w - MARGIN_PT + 2)) overflowXPages++;
      if (pg.top !== null && (pg.top < MARGIN_PT - 2 || pg.bottom > pg.h - MARGIN_PT + 2)) overflowYPages++;
    }
    return { measured: true, reason: null, pages, pageCount: pages.length, overflowXPages, overflowYPages };
  } catch (err) {
    return { measured: false, reason: `pymupdf-failed: ${err.message}`, pages: null };
  }
}

/**
 * PyMuPDF로 전체 페이지 축소 밀착 인화(contact-sheet)를 생성한다 (spec 8.6).
 * PyMuPDF 미설치 시 미검증(status: "미검증", verified: false)을 명시한다.
 * checkType: "print_pagination" (실제 PDF 인쇄 페이지 기준).
 */
export function generatePdfContactSheet(pdfPath, options = {}) {
  if (!hasPyMuPDF()) {
    return {
      generated: false,
      verified: false,
      status: "미검증",
      reason: "pymupdf-unavailable",
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 밀착 인화 (실제 PDF 단편화)",
      contactSheetPath: null,
      pageCount: 0,
    };
  }

  const outputPath = options.outputPath || pdfPath.replace(/\.pdf$/i, "-contact-sheet.pdf");
  const cols = options.cols || 4;

  const script = [
    "import fitz, math, sys",
    "src_path, dst_path = sys.argv[1], sys.argv[2]",
    "cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4",
    "src = fitz.open(src_path)",
    "n = len(src)",
    "if n == 0:",
    "    print('{\"error\":\"empty-pdf\"}')",
    "    sys.exit(0)",
    "rows = math.ceil(n / cols)",
    "sheet = fitz.open()",
    "sheet_w, sheet_h = 842.0, 595.0 # A4 landscape (pt)",
    "page = sheet.new_page(width=sheet_w, height=sheet_h)",
    "pad = 12.0",
    "cell_w = (sheet_w - (cols + 1) * pad) / cols",
    "cell_h = (sheet_h - (rows + 1) * pad) / rows",
    "for i in range(n):",
    "    r = i // cols",
    "    c = i % cols",
    "    x0 = pad + c * (cell_w + pad)",
    "    y0 = pad + r * (cell_h + pad)",
    "    rect = fitz.Rect(x0, y0, x0 + cell_w, y0 + cell_h)",
    "    page.show_pdf_page(rect, src, i)",
    "    page.draw_rect(rect, color=(0.7, 0.7, 0.7), width=0.5)",
    "sheet.save(dst_path)",
    "import json",
    "print(json.dumps({'n': n, 'cols': cols, 'rows': rows, 'dst': dst_path}))",
  ].join("\n");

  try {
    const out = execFileSync("python3", ["-c", script, pdfPath, outputPath, String(cols)], { encoding: "utf8", timeout: 30000 });
    const res = JSON.parse(out.trim());
    return {
      generated: true,
      verified: true,
      status: "완료",
      reason: null,
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 밀착 인화 (실제 PDF 단편화)",
      contactSheetPath: res.dst,
      pageCount: res.n,
      grid: { cols: res.cols, rows: res.rows },
    };
  } catch (err) {
    return {
      generated: false,
      verified: false,
      status: "실패",
      reason: `pymupdf-failed: ${err.message}`,
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 밀착 인화 (실제 PDF 단편화)",
      contactSheetPath: null,
      pageCount: 0,
    };
  }
}

/**
 * PyMuPDF로 PDF의 대표 페이지(표, 수식, 도표, 문항) 확대 목록을 추출한다 (spec 8.6).
 * PyMuPDF 미설치 시 미검증(status: "미검증", verified: false)을 명시한다.
 * checkType: "print_pagination" (실제 PDF 인쇄 페이지 기준).
 */
export function getPdfRepresentativePages(pdfPath, options = {}) {
  if (!hasPyMuPDF()) {
    return {
      verified: false,
      status: "미검증",
      reason: "pymupdf-unavailable",
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 대표 페이지 (실제 PDF 단편화)",
      pageCount: 0,
      zoomList: [],
      pages: null,
    };
  }

  const script = [
    "import fitz, json, sys, re",
    "doc = fitz.open(sys.argv[1])",
    "pages = []",
    "zoom_list = []",
    "math_re = re.compile(r'[∑∏∫√±≠≤≥≈∝∞∂∇]|[a-zA-Z]_[0-9]|\\\\frac|\\\\sum')",
    "q_re = re.compile(r'(문항|Q[0-9]|정답|해설|보기)')",
    "for idx, p in enumerate(doc):",
    "    pno = idx + 1",
    "    text = p.get_text()",
    "    reasons = set()",
    "    try:",
    "        tabs = p.find_tables()",
    "        if tabs and len(tabs.tables) > 0:",
    "            reasons.add('table')",
    "    except Exception:",
    "        pass",
    "    if '|' in text or '표 ' in text:",
    "        reasons.add('table')",
    "    if math_re.search(text) or '식 ' in text or '=' in text:",
    "        reasons.add('formula')",
    "    if len(p.get_images()) > 0 or len(p.get_drawings()) > 5:",
    "        reasons.add('figure')",
    "    if q_re.search(text):",
    "        reasons.add('question')",
    "    p_reasons = sorted(list(reasons))",
    "    pages.append({'pageNumber': pno, 'pageIndex': idx, 'reasons': p_reasons})",
    "    for r in p_reasons:",
    "        zoom_list.append({'pageNumber': pno, 'pageIndex': idx, 'reason': r})",
    "print(json.dumps({'pageCount': len(doc), 'zoomList': zoom_list, 'pages': pages}))",
  ].join("\n");

  try {
    const out = execFileSync("python3", ["-c", script, pdfPath], { encoding: "utf8", timeout: 30000 });
    const res = JSON.parse(out.trim());
    return {
      verified: true,
      status: "완료",
      reason: null,
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 대표 페이지 (실제 PDF 단편화)",
      pageCount: res.pageCount,
      zoomList: res.zoomList,
      pages: res.pages,
    };
  } catch (err) {
    return {
      verified: false,
      status: "실패",
      reason: `pymupdf-failed: ${err.message}`,
      checkType: "print_pagination",
      label: "PDF 인쇄 페이지 대표 페이지 (실제 PDF 단편화)",
      pageCount: 0,
      zoomList: [],
      pages: null,
    };
  }
}

/**
 * DOM 프리플라이트 기반 축소 미리보기 문서(contact-sheet HTML)를 생성한다.
 * 주의: 비페이지 DOM 모델 기반이므로 실제 PDF print pagination 이 아님을 명시한다 (spec 8.6).
 * checkType: "dom_preflight".
 */
export function generateDomContactSheet(html, options = {}) {
  const scale = Number(options.scale) || 0.25;
  const cols = Number(options.cols) || 4;
  const sheetHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>DOM 프리플라이트 축소 미리보기</title>
<style>
body { margin: 16px; font-family: sans-serif; background: #e2e8f0; }
.notice { padding: 12px 16px; background: #fed7aa; color: #9a3412; font-size: 13px; font-weight: bold; border-radius: 6px; margin-bottom: 16px; }
.sheet-grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 16px; }
.sheet-cell { background: #fff; border: 1px solid #cbd5e1; box-shadow: 0 2px 4px rgba(0,0,0,0.1); overflow: hidden; height: ${Math.round(PrintCheck.A4.CONTENT_HEIGHT_PX * scale)}px; }
.sheet-preview { width: ${PrintCheck.A4.CONTENT_WIDTH_PX}px; height: ${PrintCheck.A4.CONTENT_HEIGHT_PX}px; transform: scale(${scale}); transform-origin: top left; pointer-events: none; }
</style>
</head>
<body>
<div class="notice">⚠️ [DOM 프리플라이트 축소 미리보기] 이 화면은 DOM 근사 축소 화면이며, 실제 PDF 인쇄 페이지 단편화 검증(print pagination)이 아닙니다.</div>
<div class="sheet-grid">
  <div class="sheet-cell"><div class="sheet-preview">${html}</div></div>
</div>
</body>
</html>`;

  return {
    generated: true,
    verified: true,
    status: "완료",
    reason: null,
    checkType: "dom_preflight",
    label: "DOM 프리플라이트 축소 미리보기 (비페이지 근사)",
    html: sheetHtml,
    scale,
    cols,
  };
}

/**
 * CI 조판 검수 메인 러너 함수.
 */
export async function runPrintCheckCI() {
  console.log("============================================================");
  console.log("🖨️  Summrizei — 조판 검수 및 인쇄 무결성 CI 도구");
  console.log("============================================================\n");

  const chromeBin = findChromium();
  const pymupdf = hasPyMuPDF();

  console.log(`▶ Chromium 상태: ${chromeBin ? `✅ 발견 (${chromeBin})` : "⚠️ 미발견 (Headless 렌더링 생략)"}`);
  console.log(`▶ PyMuPDF 상태:  ${pymupdf ? "✅ 사용 가능" : "⚠️ 생략 (Python fitz 모듈 미설치 — 선택 사항)"}\n`);

  // 1. 스트레스 fixture 테스트: 검출기 및 복구 동작 검증
  console.log("▶ [1/3] 합성 스트레스 Fixture 검증 (깨진 참조, 오류 수식, 와이드 수식, 긴 표)");
  const stressFixture = createSyntheticFixture();
  const stressRender = buildStandaloneHtml(stressFixture, {
    G2: "data:image/png;base64,INVALID_IMAGE_PAYLOAD",
  });

  const stressWarnings = stressRender.warnings.map(w => w.code);
  console.log(`   - 렌더러 경고 포착: ${stressWarnings.join(", ")}`);
  const caughtBrokenRef = stressWarnings.includes("RENDER_REF_UNKNOWN");
  const caughtFormulaFailed = stressWarnings.includes("RENDER_FORMULA_FAILED");

  console.log(`   - 깨진 참조 포착: ${caughtBrokenRef ? "OK" : "FAILED"}`);
  console.log(`   - 파싱 불가 수식 포착: ${caughtFormulaFailed ? "OK" : "FAILED"}`);

  if (!caughtBrokenRef || !caughtFormulaFailed) {
    throw new Error("치명적 오류: 스트레스 fixture의 깨진 참조 또는 파싱 불가 수식을 감지하지 못했습니다.");
  }

  // 2. 골든 릴리스 Fixture 검증: 최소 출시 조건 (Broken ref 0, Katex error 0, Overflow 0)
  console.log("\n▶ [2/3] 골든 릴리스 Fixture 검증 (최소 출시 조건 확인)");
  const releaseFixture = createReleaseFixture();
  const releaseRender = buildStandaloneHtml(releaseFixture);

  const releaseWarnings = releaseRender.warnings;
  const releaseUnknownRefs = releaseWarnings.filter(w => w.code === "RENDER_REF_UNKNOWN").length;
  const releaseFormulaFails = releaseWarnings.filter(w => w.code === "RENDER_FORMULA_FAILED").length;

  console.log(`   - 깨진 참조 건수: ${releaseUnknownRefs} (기준: 0)`);
  console.log(`   - 파싱 불가 수식 건수: ${releaseFormulaFails} (기준: 0)`);

  if (releaseUnknownRefs !== 0 || releaseFormulaFails !== 0) {
    throw new Error(`최소 출시 조건 위반: 깨진 참조(${releaseUnknownRefs}) 또는 수식 오류(${releaseFormulaFails}) 발생`);
  }

  // 3. Headless Chromium 실측: DOM 기하 프리플라이트(probe 자기 검증 + 골든 fixture)와 PDF bbox
  //    주의: DOM 측정은 비페이지 모델이다 — 실제 PDF 단편화 결과가 아니라
  //    print media(가능 시) 적용 DOM의 top/pageHeight 근사 판정이다.
  console.log("\n▶ [3/3] Headless Chromium 인쇄 기하 실측 (DOM 프리플라이트 + PDF bbox)");

  // 검출기 자기 검증 probe가 유발해야 하는 코드 — 어느 하나라도 빠지면 측정 경로가 고장 난 것
  const EXPECTED_PROBE_CODES = [
    PrintCheck.CODES.OVERFLOW_X,
    PrintCheck.CODES.OVERFLOW_Y,
    PrintCheck.CODES.HEADING_ORPHAN,
    PrintCheck.CODES.ANSWER_SPLIT,
    PrintCheck.CODES.TABLE_ROW_CLIPPED,
    PrintCheck.CODES.FONT_SIZE_VIOLATION,
    PrintCheck.CODES.KATEX_ERROR,
    PrintCheck.CODES.IMAGE_FAILED,
    PrintCheck.CODES.FIGURE_UNIT_SPLIT,
  ];

  let domProbe = { measured: false, media: null, reason: "chromium-unavailable", check: null, representativePages: null };
  let domRelease = { measured: false, media: null, reason: "chromium-unavailable", check: null, representativePages: null };
  let pdfGenerated = false;
  let pdfGeometry = { measured: false, reason: "not-attempted", pages: null };
  let pdfContactSheet = { generated: false, verified: false, status: "미검증", reason: "not-attempted", checkType: "print_pagination", contactSheetPath: null };
  let pdfRepresentativePages = { verified: false, status: "미검증", reason: "not-attempted", checkType: "print_pagination", pageCount: 0, zoomList: [], pages: null };

  if (chromeBin) {
    // 3a. 검출기 자기 검증: 의도된 결함이 모두 실측되는지 확인
    domProbe = await measureDomGeometry(chromeBin, buildGeometryProbeHtml());
    if (domProbe.measured) {
      const got = new Set(domProbe.check.issues.map(i => i.code));
      console.log(`   - probe 실측(${domProbe.media} media): 이슈 ${domProbe.check.issues.length}건, 코드: ${[...got].sort().join(", ")}`);
      const missing = EXPECTED_PROBE_CODES.filter(c => !got.has(c));
      if (missing.length > 0) {
        throw new Error(`기하 검출기 자기 검증 실패: probe 문서에서 감지되지 않은 코드 ${missing.join(", ")}`);
      }
      console.log("   ✅ probe: 의도된 결함 전부 실측 검출");
    } else {
      console.log(`   ⚠️ probe 기하 미측정(미검증): ${domProbe.reason}`);
    }

    // 3b. 골든 fixture 기하 실측 — 측정이 된 경우에만 0을 요구한다
    domRelease = await measureDomGeometry(chromeBin, releaseRender.html);
    if (domRelease.measured) {
      const m = domRelease.check.metrics;
      console.log(`   - 골든 DOM 프리플라이트(${domRelease.media} media, 비페이지 모델): ${m.pageCount}쪽, 가로 넘침 ${m.overflowXCount}, 세로 넘침 ${m.overflowYCount}, 도표 단위 분리 ${m.figureUnitSplitCount || 0}, 제목 고아 ${m.headingOrphanCount}, 답안 분리 ${m.answerSplitCount}, 표 행 잘림 ${m.tableRowClippedCount}, KaTeX 오류 ${m.katexErrorCount}, 이미지 실패 ${m.imageFailedCount}, 글자 크기 위반 ${m.minFontSizeViolationCount}`);
      if (domRelease.representativePages?.zoomList) {
        const zl = domRelease.representativePages.zoomList;
        console.log(`   - 대표 페이지 확대 목록 (DOM 프리플라이트, 비페이지 근사): ${zl.length}건 (${zl.map(z => `${z.pageNumber}쪽:${z.reason}`).join(", ") || "없음"})`);
      }
      if (!domRelease.check.ok) {
        const codes = [...new Set(domRelease.check.issues.map(i => i.code))].join(", ");
        throw new Error(`최소 출시 조건 위반: 골든 fixture 인쇄 기하 결함 실측 ${domRelease.check.issues.length}건 (${codes})`);
      }
      console.log("   ✅ 골든 fixture: DOM 기하 결함 실측 0건");
    } else {
      console.log(`   ⚠️ 골든 fixture 기하 미측정(미검증): ${domRelease.reason}`);
    }

    // 3c. PDF 생성 + 가능하면 PyMuPDF bbox 실측
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srz-print-"));
    const htmlPath = path.join(tmpDir, "note.html");
    const pdfPath = path.join(tmpDir, "output.pdf");

    fs.writeFileSync(htmlPath, releaseRender.html, "utf8");

    try {
      // 일회성 --print-to-pdf는 기본 프로파일을 쓴다 — 새 --user-data-dir를 붙이면
      // Chrome updater가 깨어나 수십 초 지연되는 것을 관측했다 (dump-dom/CDP 경로는 영향 없음).
      execFileSync(chromeBin, [
        "--headless",
        "--disable-gpu",
        "--no-pdf-header-footer",
        `--print-to-pdf=${pdfPath}`,
        htmlPath,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      });

      if (fs.existsSync(pdfPath)) {
        const stats = fs.statSync(pdfPath);
        if (stats.size > 1000) {
          pdfGenerated = true;
          console.log(`   ✅ PDF 생성 성공: ${stats.size} 바이트 (${pdfPath}) — 파일 크기는 생성 확인일 뿐 기하 판정이 아님`);
          pdfGeometry = measurePdfGeometry(pdfPath);
          if (pdfGeometry.measured) {
            console.log(`   - PDF bbox 실측: ${pdfGeometry.pageCount}쪽, 여백 밖 가로 ${pdfGeometry.overflowXPages}쪽, 세로 ${pdfGeometry.overflowYPages}쪽`);
          } else {
            console.log(`   - PDF bbox 미측정(미검증): ${pdfGeometry.reason}`);
          }

          // 전체 페이지 축소 밀착 인화 (contact-sheet) 및 대표 페이지 확대 목록 (spec 8.6)
          pdfContactSheet = generatePdfContactSheet(pdfPath);
          if (pdfContactSheet.generated) {
            console.log(`   - PDF 밀착 인화 (전체 페이지 축소): ✅ 생성 완료 (${pdfContactSheet.contactSheetPath})`);
          } else {
            console.log(`   - PDF 밀착 인화 (전체 페이지 축소): ⚠️ ${pdfContactSheet.status} (${pdfContactSheet.reason})`);
          }

          pdfRepresentativePages = getPdfRepresentativePages(pdfPath);
          if (pdfRepresentativePages.verified) {
            console.log(`   - PDF 대표 페이지 확대 목록: ✅ 검증 완료 (${pdfRepresentativePages.zoomList.map(z => `${z.pageNumber}쪽:${z.reason}`).join(", ") || "없음"})`);
          } else {
            console.log(`   - PDF 대표 페이지 확대 목록: ⚠️ ${pdfRepresentativePages.status} (${pdfRepresentativePages.reason})`);
          }
        }
      }
    } catch (err) {
      console.warn(`   ⚠️ Chromium 실행 실패: ${err.message}`);
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }

    // 실측된 PDF bbox 넘침은 경고가 아니라 출시 조건 위반으로 실패시킨다
    if (pdfGeometry.measured && (pdfGeometry.overflowXPages > 0 || pdfGeometry.overflowYPages > 0)) {
      throw new Error(`최소 출시 조건 위반: PDF bbox 여백 밖 콘텐츠 실측 — 가로 ${pdfGeometry.overflowXPages}쪽, 세로 ${pdfGeometry.overflowYPages}쪽`);
    }
  } else {
    console.log("   ⚠️ 로컬 Chromium 부재 — 인쇄 기하와 PDF는 미검증으로 표시합니다.");
  }

  console.log("\n============================================================");
  if (domRelease.measured) {
    const m = domRelease.check.metrics;
    const pdfPart = pdfGeometry.measured
      ? `, PDF bbox 여백 밖 ${pdfGeometry.overflowXPages + pdfGeometry.overflowYPages}쪽`
      : `, PDF bbox 미검증(${pdfGeometry.reason})`;
    console.log(`✅ [조판 검수 통과] 깨진 참조 0, 파싱 불가 수식 0, DOM 프리플라이트(${domRelease.media} media) 가로 넘침 ${m.overflowXCount}, 세로 넘침 ${m.overflowYCount}${pdfPart}`);
  } else {
    console.log(`⚠️ [조판 검수 부분 통과] 깨진 참조 0, 파싱 불가 수식 0 — 인쇄 기하 미검증(${domRelease.reason})`);
  }
  console.log("============================================================\n");

  return {
    ok: true,
    caughtStressIssues: { brokenRef: caughtBrokenRef, formulaFailed: caughtFormulaFailed },
    releaseMetrics: { unknownRefs: releaseUnknownRefs, formulaFails: releaseFormulaFails },
    domProbe: {
      measured: domProbe.measured,
      media: domProbe.media,
      reason: domProbe.reason,
      detectedCodes: domProbe.measured ? [...new Set(domProbe.check.issues.map(i => i.code))].sort() : null,
      representativePages: domProbe.representativePages || null,
    },
    domRelease: {
      measured: domRelease.measured,
      media: domRelease.media,
      reason: domRelease.reason,
      metrics: domRelease.measured ? domRelease.check.metrics : null,
      representativePages: domRelease.representativePages || null,
    },
    pdfGenerated,
    pdfGeometry,
    pdfContactSheet,
    pdfRepresentativePages,
    hasChromium: !!chromeBin,
    hasPyMuPDF: pymupdf,
  };
}

if (isMain) {
  runPrintCheckCI()
    .then(() => process.exit(0))
    .catch(err => {
      console.error("\n❌ 조판 검수 실패:", err.message);
      process.exit(1);
    });
}
