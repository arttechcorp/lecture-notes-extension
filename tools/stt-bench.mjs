// 골든 폴더의 음성 청크를 /v1/stt 로 돌려 CER·용어 재현율·지연·비용을 잰다.
// 수동 벤치 전용 — 토큰을 들고 직접 실행할 때만 네트워크를 탄다.
// 골든 폴더와 --out 은 저장소 밖이어야 한다: 강의 음성·전사가 repo 에 남으면 안 된다.
// 사용: node tools/stt-bench.mjs <골든폴더> <서비스URL> <토큰> [모델] [--prompt=both|on|off] [--out=<dir>]
//
// 골든 폴더(저장소 밖):
//   <name>.m4a|mp4        오디오 청크
//   <name>.txt            참조 전사 (필수, 없으면 건너뜀)
//   <name>.terms.txt      용어 목록, 줄당 하나 (없으면 폴더의 terms.txt)
//   <name>.json           {t0, durationSec, lang} (선택)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cerNorm, editDistance, koreanCER, mp4Duration, percentile, termHits, termRecall } from "./bench-metrics.mjs";

const USAGE = "사용: node tools/stt-bench.mjs <골든폴더> <서비스URL> <토큰> [모델] [--prompt=both|on|off] [--out=<dir>]";
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter(a => a.startsWith("--")).map(a => {
  const i = a.indexOf("="); // 값에 = 가 들어갈 수 있어 첫 = 에서만 자른다
  return i < 0 ? [a.slice(2), ""] : [a.slice(2, i), a.slice(i + 1)];
}));
const [dir, baseUrl, token, model = "whisper-large-v3-turbo"] = args.filter(a => !a.startsWith("--"));
const promptMode = flags.prompt || "both";
// 인자 검사는 디스크·네트워크 접근보다 먼저 — 잘못된 호출이 파일을 읽지 않게 한다.
if (!dir || !baseUrl || !token || !["both", "on", "off"].includes(promptMode)) { console.error(USAGE); process.exit(1); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."); // tools 의 부모 = repo 루트
const inside = p => p === ROOT || p.startsWith(ROOT + path.sep);
const golden = path.resolve(dir);
if (inside(golden)) { console.error("거절: 골든 폴더가 저장소 안입니다. 강의 음성·전사는 저장소 밖에 두세요."); process.exit(1); }
if (!existsSync(golden)) { console.error("골든 폴더가 없습니다: " + golden); process.exit(1); }
const outDir = path.resolve(flags.out || path.join(golden, "results"));
if (inside(outDir)) { console.error("거절: --out 디렉터리가 저장소 안입니다."); process.exit(1); }

const readText = f => existsSync(f) ? readFileSync(f, "utf8") : null;
const parseTerms = t => (t || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const sharedTerms = parseTerms(readText(path.join(golden, "terms.txt")));

// 청크 목록 — 참조 전사 없는 파일은 경고 후 건너뛰고, 이름순으로 처리한다.
let cursor = 0; // t0 기본값 = 앞 청크들의 durationSec 누적
const chunks = [];
for (const file of readdirSync(golden).filter(f => [".m4a", ".mp4"].includes(path.extname(f).toLowerCase())).sort()) {
  const base = file.slice(0, -path.extname(file).length);
  const ref = readText(path.join(golden, base + ".txt"));
  if (ref == null) { console.warn(`건너뜀: ${file} — 참조 전사 ${base}.txt 없음`); continue; }
  let meta = {};
  const metaRaw = readText(path.join(golden, base + ".json"));
  if (metaRaw != null) { try { meta = JSON.parse(metaRaw); } catch { console.warn(`무시: ${base}.json 파싱 실패`); } }
  const bytes = readFileSync(path.join(golden, file));
  let durationSec = Number.isFinite(meta.durationSec) && meta.durationSec > 0 ? meta.durationSec : mp4Duration(bytes);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    // durationSec 은 서버 과금 상한에 쓰인다 — 못 읽으면 보수적으로 5분30초를 보낸다.
    durationSec = 330;
    console.warn(`경고: ${file} 길이를 읽지 못해 durationSec=330 으로 보냅니다.`);
  }
  const t0 = Number.isFinite(meta.t0) ? meta.t0 : cursor;
  cursor = t0 + durationSec; // 명시한 t0 가 있으면 그 청크 끝에서 이어 간다
  const ownTerms = readText(path.join(golden, base + ".terms.txt"));
  chunks.push({ file, ref, bytes, t0, durationSec, lang: typeof meta.lang === "string" ? meta.lang : "ko", terms: ownTerms != null ? parseTerms(ownTerms) : sharedTerms });
}
if (!chunks.length) { console.error("처리할 청크가 없습니다."); process.exit(1); }

// Whisper 는 프롬프트 끝부분만 읽는다 — 400자가 넘으면 뒤쪽 400자를 용어 경계에서 자른다.
function promptFor(terms) {
  const joined = terms.join(", ");
  if (joined.length <= 400) return joined;
  const cut = joined.indexOf(", ", joined.length - 400); // 400자 안쪽 첫 구분자
  return cut > 0 ? joined.slice(cut + 2) : joined.slice(-400);
}

const variants = promptMode === "both" ? ["on", "off"] : [promptMode];
const rows = [], failures = [];

for (const [ci, chunk] of chunks.entries()) {
  for (const variant of variants) {
    const started = Date.now();
    let body = null, http = 0;
    try {
      const res = await fetch(baseUrl + "/v1/stt", {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({
          model, requestId: `bench-stt-${Date.now()}-${ci}-${variant}`,
          t0: chunk.t0, durationSec: chunk.durationSec, lang: chunk.lang,
          prompt: variant === "on" ? promptFor(chunk.terms) : "",
          audio: "data:audio/mp4;base64," + chunk.bytes.toString("base64"),
        }),
      });
      http = res.status;
      body = await res.json().catch(() => null);
    } catch (e) {
      body = { error: { code: "network", message: String((e && e.message) || e) } };
    }
    const ms = Date.now() - started;
    const err = body && body.error; // {code,...} 이거나 옛 문자열 형태일 수 있다
    if (err || !body || !Array.isArray(body.transcript?.segments)) {
      const code = typeof err === "string" ? err : (err && err.code) || (body ? "no_transcript" : `HTTP ${http}`);
      failures.push({ file: chunk.file, variant, error: code });
      rows.push({ file: chunk.file, variant, error: code, retryable: !!(err && err.retryable), retryAfterMs: err && err.retryAfterMs });
      console.log(`${chunk.file}\t${variant}\t실패\t${code}`);
      continue; // 실패는 세고 나열할 뿐, 실행을 멈추지 않는다
    }
    const hyp = body.transcript.segments.map(s => s.text || "").join(" ").trim();
    const rN = cerNorm(chunk.ref), hN = cerNorm(hyp);
    const dist = editDistance(rN, hN), refLen = [...rN].length;
    const { hit, miss } = termHits(chunk.terms, hyp);
    rows.push({
      file: chunk.file, variant, t0: chunk.t0, durationSec: chunk.durationSec,
      cer: koreanCER(chunk.ref, hyp), termRecall: termRecall(chunk.terms, hyp),
      miss, dist, refLen, hits: hit.length, terms: hit.length + miss.length,
      latencyMs: ms, audioSec: body.usage?.audioSec ?? null, costUsd: body.usage?.costUsd ?? null,
      promptVersion: body.promptVersion ?? null, schemaVersion: body.schemaVersion ?? null,
      ref: chunk.ref.trim(), hyp, segments: body.transcript.segments,
    });
    console.log(`${chunk.file}\t${variant}\tCER ${(100 * (refLen ? dist / refLen : 0)).toFixed(1)}%\t용어 ${hit.length}/${hit.length + miss.length}\t${(ms / 1000).toFixed(1)}s`);
  }
}

// 변형별 집계 — micro 는 편집거리·기준길이를 전부 합산한다.
const aggregates = {};
for (const variant of variants) {
  const ok = rows.filter(r => r.variant === variant && !r.error);
  const dist = ok.reduce((s, r) => s + r.dist, 0), refLen = ok.reduce((s, r) => s + r.refLen, 0);
  const hits = ok.reduce((s, r) => s + r.hits, 0), terms = ok.reduce((s, r) => s + r.terms, 0);
  const audioSec = ok.reduce((s, r) => s + (r.audioSec ?? r.durationSec), 0);
  const costUsd = ok.reduce((s, r) => s + (r.costUsd || 0), 0);
  const lat = ok.map(r => r.latencyMs);
  aggregates[variant] = {
    chunks: ok.length, failed: failures.filter(f => f.variant === variant).length,
    microCER: refLen ? dist / refLen : null,
    meanCER: ok.length ? ok.reduce((s, r) => s + r.cer, 0) / ok.length : null,
    termRecall: terms ? hits / terms : null,
    latencyP50ms: percentile(lat, 50), latencyP90ms: percentile(lat, 90),
    audioSec, costUsd, costPerAudioHour: audioSec ? costUsd / (audioSec / 3600) : null,
  };
}
const delta = variants.length === 2 ? { // on − off
  cer: aggregates.on.microCER != null && aggregates.off.microCER != null ? aggregates.on.microCER - aggregates.off.microCER : null,
  termRecall: aggregates.on.termRecall != null && aggregates.off.termRecall != null ? aggregates.on.termRecall - aggregates.off.termRecall : null,
} : null;

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/:/g, "-"); // 파일명에 : 는 못 쓴다
const jsonPath = path.join(outDir, `stt-bench-${stamp}.json`);
const mdPath = path.join(outDir, `stt-bench-${stamp}.md`);
writeFileSync(jsonPath, JSON.stringify({ model, date: new Date().toISOString(), promptMode, chunks: chunks.length, aggregates, delta, failures, rows }, null, 2));

const pct = v => v == null ? "-" : (v * 100).toFixed(1) + "%";
const sec = v => v == null ? "-" : (v / 1000).toFixed(1) + "s";
const usd = v => v == null ? "-" : "$" + v.toFixed(4);
const md = [`# STT 벤치 — ${model}`, "", `- 날짜: ${new Date().toISOString()}`, `- 청크 ${chunks.length}개 · 실패 ${failures.length}건 · 프롬프트: ${promptMode}`, ""];
for (const variant of variants) {
  const a = aggregates[variant];
  md.push(`## prompt ${variant}`, "", "| 청크 | CER | 용어 | 누락 용어 | 지연 | 비용 |", "|---|---|---|---|---|---|");
  for (const r of rows.filter(r => r.variant === variant)) {
    md.push(r.error
      ? `| ${r.file} | 실패: ${r.error} | | | | |`
      : `| ${r.file} | ${pct(r.cer)} | ${r.hits}/${r.terms} | ${r.miss.join(", ").replace(/\|/g, "/") || "-"} | ${(r.latencyMs / 1000).toFixed(1)}s | ${usd(r.costUsd)} |`);
  }
  md.push("", `- micro CER ${pct(a.microCER)} · 평균 CER ${pct(a.meanCER)} · 용어 재현율 ${pct(a.termRecall)}`,
    `- 지연 p50 ${sec(a.latencyP50ms)} · p90 ${sec(a.latencyP90ms)}`,
    `- 오디오 ${a.audioSec ? (a.audioSec / 60).toFixed(1) : "-"}분 · 비용 ${usd(a.costUsd)} (시간당 ${usd(a.costPerAudioHour)})`, "");
}
if (delta) md.push(`**델타(on−off): CER ${delta.cer == null ? "-" : (delta.cer * 100).toFixed(2) + "pp"} · 용어 재현율 ${delta.termRecall == null ? "-" : (delta.termRecall * 100).toFixed(2) + "pp"}**`, "");
if (failures.length) {
  md.push("## 실패", "");
  for (const f of failures) md.push(`- ${f.file} (${f.variant}): ${f.error}`);
  md.push("");
}
md.push("> 가설 전사문은 JSON 파일에만 있습니다.");
writeFileSync(mdPath, md.join("\n") + "\n");
console.log("보고서: " + mdPath);
