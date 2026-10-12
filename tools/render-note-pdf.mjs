// tools/render-note-pdf.mjs
// 저장 note JSON → lib/note-render + Headless Chromium(--print-to-pdf) → PDF.
// 브라우저 e2e 아님 — PDF 생성은 일회성 headless(:9333 과는 무관한 별 프로세스),
// .srzdata 복호화만 :9333 offscreen 의 읽기 전용 evaluate 를 쓴다.
//
//   사용: node tools/render-note-pdf.mjs [--check] <noteJson|render.srzdata> <out.pdf>
//
// 입력 스키마(어느 하나):
//   { note, crops }                    — 저장 노트 페이로드(note-file FORMAT). crops[F#|G#]="data:…" 또는 raw base64
//   { meta, note, crops, input, … }    — 백업 페이로드(note-file DATA_FORMAT, crops=raw base64). meta·input 은 무시
//   { note, cropMap, crops }           — crops 가 "s6/f1" 같은 슬라이드 키일 때 cropMap{F#:"s6/f1"}으로 등록부 id 를 푼다
//   <note 객체 그 자체>                 — sections·registry 를 갖는 객체. 크롭 없이 렌더(crop/display 유지 결과에 따름)
//   render.srzdata                     — summrizei-data 암호 봉투(AES-256-GCM). :9333 웜 Chrome의 offscreen.html 에
//                                        읽기 전용 Runtime.evaluate를 보내 NoteFile.decryptData로 메모리에서만 복호
//                                        (runner/browser.cjs openDiagnostic 경로). 평문 크롭 파일은 만들지 않는다
// 출력: out.pdf(A4, 헤더·푸터 없음). 진행·경고는 코드만 표준 출력 — 강의 내용·수식 원문을 찍지 않는다.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildStandaloneHtml, findChromium, measureDomGeometry, measurePdfGeometry } from "./print-check.mjs";

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

// 크롭 키는 등록부 id(F# 수식, G# 도표)다 — lib/library.js CROP_RE 와 같다.
const CROP_ID = /^(F|G)\d+$/;
// raw base64 값의 매직으로 이미지 MIME을 고른다(저장소 blob 은 png·jpeg·webp·gif 크롭만 허용).
const MIME_SNIFF = [
  [/^iVBOR/, "image/png"],
  [/^\/9j\//, "image/jpeg"],
  [/^UklGR/, "image/webp"],
  [/^R0lGOD/, "image/gif"],
];

function sniffMime(b64) {
  for (const [re, mime] of MIME_SNIFF) if (re.test(b64)) return mime;
  return "image/png"; // 매직이 없으면 png 로 둔다 — 못 읽는 값은 브라우저가 자연히 깨진 이미지로 표시한다.
}

function toDataUri(v) {
  return v.startsWith("data:") ? v : `data:${sniffMime(v)};base64,${v}`;
}

// doc.crops·doc.cropBytes 등 값 칸에서 등록부 id → data:URI 맵을 만든다.
// 키가 이미 F#/G# 이면 그대로, "s#/f#" 류 슬라이드 키면 cropMap(F#→슬라이드 키)을 뒤집어 푼다.
export function resolveCrops(doc) {
  const out = {};
  if (!doc || typeof doc !== "object") return out;

  const inv = new Map();
  for (const m of [doc.cropMap, doc.note?.cropMap]) {
    if (!m || typeof m !== "object") continue;
    for (const [fid, sk] of Object.entries(m)) {
      if (CROP_ID.test(fid) && typeof sk === "string" && !inv.has(sk)) inv.set(sk, fid);
    }
  }

  for (const s of [doc.crops, doc.cropBytes, doc.note?.crops]) {
    if (!s || typeof s !== "object") continue;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v !== "string" || !v) continue;
      const id = CROP_ID.test(k) ? k : inv.get(k);
      if (id && out[id] === undefined) out[id] = toDataUri(v);
    }
  }
  return out;
}

// note JSON 문자열/객체를 {note, crops}로 정규화한다.
export function parseNoteJson(input) {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("note-json-invalid");
  const note = doc.note && typeof doc.note === "object" ? doc.note
    : (Array.isArray(doc.sections) && Array.isArray(doc.registry) ? doc : null);
  if (!note) throw new Error("note-json-no-note: {note, crops} 형태 또는 노트 객체가 필요합니다");
  return { note, crops: resolveCrops(doc) };
}

// summrizei-data 봉투(.srzdata: format/iv/ciphertext)인지 판별한다.
export function isSealedSrzdata(doc) {
  return !!doc && typeof doc === "object" && typeof doc.ciphertext === "string"
    && doc.alg === "AES-256-GCM" && typeof doc.format === "string";
}

// .srzdata 복호화 — 웜 Chrome(:9333)의 실제 offscreen.html 에 읽기 전용 Runtime.evaluate를
// 보내 NoteFile.decryptData로 메모리에서만 복호한다(runner/browser.cjs openDiagnostic 과 같은 경로;
// 평문 크롭 파일은 만들지 않는다). 의존성 없이 raw CDP(flatten:false 세션)로 간다.
const OFFSCREEN_URL = "chrome-extension://gllijdanodakjamndimlpgmhokaakpod/offscreen.html";

export async function decryptSrzdata(fileText, { port = 9333, timeoutMs = 60000 } = {}) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const deadline = Date.now() + timeoutMs;
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  try {
    await Promise.race([
      new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("ws-connect-failed")); }),
      sleep(10000).then(() => Promise.reject(new Error("ws-connect-timeout"))),
    ]);

    let seq = 0;
    const pending = new Map(), innerWaiters = [];
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === "Target.receivedMessageFromTarget") {
        for (let i = innerWaiters.length - 1; i >= 0; i--) {
          const w = innerWaiters[i];
          if (w.sessionId === m.params?.sessionId) { innerWaiters.splice(i, 1); w.resolve(m.params); }
        }
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });

    const { targetInfos } = await send("Target.getTargets");
    const off = targetInfos.find(t => t.type === "other" && t.url === OFFSCREEN_URL)
      ?? targetInfos.find(t => t.url === OFFSCREEN_URL);
    if (!off) throw new Error("offscreen_unavailable: :9333 에 확장의 offscreen.html 이 없습니다");
    const { sessionId } = await send("Target.attachToTarget", { targetId: off.targetId, flatten: false });

    const innerId = ++seq;
    const expr = `(async (t) => {
      var store = await storeP, lk = await NoteFile.loadLibraryKey(store.adapter);
      if (!lk || !lk.key) return { ok: false, error: "library_key_missing" };
      try { var d = await NoteFile.decryptData(t, lk.key); var inp = d.input && typeof d.input === "object" ? d.input : {};
        return { ok: true, note: d.note ?? inp.note ?? null, crops: (inp.crops && Object.keys(inp.crops).length ? inp.crops : d.crops) ?? {}, meta: d.meta ?? inp.meta ?? null }; }
      catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 160) }; }
    })(${JSON.stringify(fileText)})`;
    const inner = Promise.race([
      new Promise(res => innerWaiters.push({ sessionId, resolve: res })),
      sleep(Math.max(1000, deadline - Date.now())).then(() => Promise.reject(new Error("cdp_timeout:Runtime.evaluate"))),
    ]);
    await send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id: innerId, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }),
    });
    const innerMsg = await inner;
    const res = innerMsg?.message ? JSON.parse(innerMsg.message) : null;
    const x = res?.result?.exceptionDetails;
    if (x) throw new Error(`offscreen_eval: ${x.text} ${x.exception?.description || ""}`.slice(0, 300));
    const r = res?.result?.result?.value;
    if (!r?.ok) throw new Error(`decrypt_failed: ${r?.error || "unknown"}`);
    return { note: r.note, crops: r.crops, meta: r.meta };
  } finally {
    try { ws.close(); } catch {}
  }
}

// 파일을 읽어 {note, crops}로 준비한다 — .srzdata(암호 봉투)면 offscreen 복호화, 아니면 평문 JSON.
export async function loadNoteInput(noteJsonPath, opts = {}) {
  const text = fs.readFileSync(noteJsonPath, "utf8");
  let doc;
  try { doc = JSON.parse(text); } catch { throw new Error("note-json-parse-failed"); }
  if (isSealedSrzdata(doc)) {
    const d = await decryptSrzdata(text, opts);
    if (!d.note) throw new Error("srzdata-no-note");
    return { note: d.note, crops: resolveCrops({ crops: d.crops }) };
  }
  return parseNoteJson(doc);
}

// 저장 note JSON 파일을 standalone HTML로 렌더한다(테스트·디버그용 재사용 지점).
export function renderNoteHtml(noteJson) {
  const { note, crops } = parseNoteJson(noteJson);
  const { html, warnings } = buildStandaloneHtml(note, crops);
  return { html, warnings, cropCount: Object.keys(crops).length };
}

// 렌더 → Headless Chromium --print-to-pdf. out.pdf 경로로 쓰고 크기를 돌려준다.
export async function renderNotePdf(noteJsonPath, outPdfPath, { timeoutMs = 60000, check = false } = {}) {
  const chromeBin = findChromium();
  if (!chromeBin) throw new Error("chromium-unavailable: headless Chromium/Chrome 실행 파일을 찾지 못했습니다(CHROME_BIN으로 지정 가능)");

  const { note, crops } = await loadNoteInput(noteJsonPath);
  const { html, warnings } = buildStandaloneHtml(note, crops);
  const cropCount = Object.keys(crops).length;
  if (warnings?.length) console.log(`render-warnings: ${[...new Set(warnings.map(w => w.code))].sort().join(",")}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "srz-render-"));
  try {
    const htmlPath = path.join(tmpDir, "note.html");
    fs.writeFileSync(htmlPath, html, "utf8");

    fs.mkdirSync(path.dirname(path.resolve(outPdfPath)), { recursive: true });
    const outAbs = path.resolve(outPdfPath);
    // print-check와 같은 일회성 경로 — --user-data-dir를 붙이면 Chrome updater가 수십 초 지연된다.
    execFileSync(chromeBin, [
      "--headless",
      "--disable-gpu",
      "--no-pdf-header-footer",
      `--print-to-pdf=${outAbs}`,
      pathToFileURL(htmlPath).href,
    ], { stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });

    if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size < 1000) {
      throw new Error(`pdf-write-failed: ${outAbs}`);
    }
    const out = { pdfPath: outAbs, bytes: fs.statSync(outAbs).size, crops: cropCount, warnings: warnings?.map(w => w.code) ?? [] };

    if (check) {
      // 검증은 숫자만 — 내용 코드·id 만 나가고 강의 텍스트는 출력하지 않는다.
      const dom = await measureDomGeometry(chromeBin, html);
      const pdf = measurePdfGeometry(outAbs);
      out.check = {
        domMeasured: dom.measured, domMedia: dom.media, domReason: dom.reason,
        issues: dom.measured ? dom.check.issues.length : null,
        metrics: dom.measured ? dom.check.metrics : null,
        pdfMeasured: pdf.measured, pdfPages: pdf.pageCount ?? null,
        pdfOverflowXPages: pdf.overflowXPages ?? null, pdfOverflowYPages: pdf.overflowYPages ?? null,
        pdfReason: pdf.reason ?? null,
      };
    }
    return out;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function usage() {
  console.log("사용법: node tools/render-note-pdf.mjs [--check] <noteJson|render.srzdata> <out.pdf>");
  console.log("  입력  : {note, crops} | {meta,note,crops,input,…} | {note,cropMap,crops} | 노트 객체 | .srzdata(암호 봉투)");
  console.log("  --check: 생성 후 DOM 프리플라이트·PDF bbox 요약(숫자만)");
  console.log("  .srzdata는 :9333 offscreen 에서 메모리 복호화한다 — 평문 크롭 파일을 만들지 않는다");
  console.log("  out.pdf : 출력 PDF 경로(A4, 헤더·푸터 없음)");
}

if (isMain) {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const [noteJson, outPdf] = argv.filter(a => a !== "--check");
  if (!noteJson || !outPdf || noteJson === "-h" || noteJson === "--help") {
    usage();
    process.exit(noteJson && outPdf ? 0 : 1);
  }
  renderNotePdf(noteJson, outPdf, { check })
    .then(r => {
      console.log(`pdf: ${r.pdfPath} (${r.bytes} bytes, crops ${r.crops})`);
      if (r.check) {
        const c = r.check;
        console.log(`check.dom: measured=${c.domMeasured} media=${c.domMedia} issues=${c.issues} metrics=${JSON.stringify(c.metrics)}${c.domReason ? ` reason=${c.domReason}` : ""}`);
        console.log(`check.pdf: measured=${c.pdfMeasured} pages=${c.pdfPages} overflowX=${c.pdfOverflowXPages} overflowY=${c.pdfOverflowYPages}${c.pdfReason ? ` reason=${c.pdfReason}` : ""}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error(`render-note-pdf failed: ${err.message}`);
      process.exit(1);
    });
}
