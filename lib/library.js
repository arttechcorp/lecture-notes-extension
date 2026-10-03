// 끝난 강의 하나의 결과(메타·재생성 입력·노트·크롭)를 암호화 패키지 저장소에 두는 로컬 보관함(docs/architecture-v2.md §12).
// 원본 미디어는 절대 들어오지 않는다 — 파생 산출물만 PackageStore(AES-GCM)에 둔다(AGENTS.md §2).
// 레코드 배치: packages 의 `<pkg>:meta`·`<pkg>:note`·`<pkg>:input`, blobs 의 `<pkg>:crop:<F#|G#>`.
// 같은 `<pkg>:` 접두어 아래 sd:n·tr:n·gaps(background-job)와 s:<hash>(단계 캐시, pipeline.cached)도 있어 remove() 가 패키지째 지운다.
(() => {
  const metaId = pkg => `${pkg}:meta`;
  const noteId = pkg => `${pkg}:note`;
  const inputId = pkg => `${pkg}:input`;
  const recId = pkg => `${pkg}:recognition`;
  const cropId = (pkg, id) => `${pkg}:crop:${id}`;

  const CROP_RE = /^[FG]\d{1,6}$/; // 수식 F#, 도표·그림 G#
  const SOURCES = new Set(["background", "live"]);
  const TIERS = new Set(["free", "paid"]);
  const STATUSES = new Set(["complete", "partial", "recognition-only"]);
  const c = () => globalThis.crypto?.subtle ? globalThis.crypto : require("node:crypto").webcrypto;

  // 알려진 필드만 골라 담고 모르는 키는 버린다. 잘못된 값은 TypeError.
  function cleanMeta(packageId, m, prev, nowIso) {
    const err = label => { throw new TypeError(`메타 ${label}이(가) 올바르지 않습니다.`); };
    if (m === null || typeof m !== "object" || Array.isArray(m)) throw new TypeError("메타가 올바르지 않습니다.");
    if (typeof m.packageId !== "string" || m.packageId !== packageId) err("packageId");
    const str = (v, label, max = Infinity) => {
      if (v == null) return null;
      if (typeof v !== "string" || v.length > max) err(label);
      return v;
    };
    // host는 호스트명만 둔다 — URL이 오면 경로·쿼리·포트를 버린다. 전체 주소는 강의를 특정하는 내용이다.
    let host = null;
    if (m.host != null) {
      if (typeof m.host !== "string") err("host");
      try { host = new URL(m.host).hostname; } catch { /* 스킴 없는 호스트명은 아래서 자른다 */ }
      host ||= m.host.split(/[/?#]/, 1)[0].split(":")[0];
      if (!host || host.length > 253) err("host");
    }
    if (!SOURCES.has(m.source)) err("source");
    if (!TIERS.has(m.tier)) err("tier");
    if (!STATUSES.has(m.status)) err("status");
    if (m.durationSec != null && (typeof m.durationSec !== "number" || !Number.isFinite(m.durationSec) || m.durationSec < 0)) err("durationSec");
    const iso = v => { if (typeof v !== "string" || Number.isNaN(Date.parse(v))) err("createdAt"); return new Date(v).toISOString(); };
    const o = m.options ?? {};
    if (o === null || typeof o !== "object" || Array.isArray(o)) err("options");
    const flag = k => o[k] === undefined ? false : (typeof o[k] === "boolean" ? o[k] : err(`options.${k}`));
    let counts = null;
    if (m.counts != null) {
      if (typeof m.counts !== "object" || !Number.isInteger(m.counts.sections) || m.counts.sections < 0 || !Number.isInteger(m.counts.questions) || m.counts.questions < 0) err("counts");
      counts = { sections: m.counts.sections, questions: m.counts.questions };
    }
    return {
      packageId,
      title: str(m.title, "title", 200),
      host,
      source: m.source, tier: m.tier, status: m.status,
      // 처음 저장한 시각은 다시 저장해도 유지한다. 이전 기록이 없으면 넘어온 값, 그것도 없으면 지금.
      createdAt: prev?.createdAt ?? (m.createdAt == null ? nowIso : iso(m.createdAt)),
      updatedAt: nowIso,
      durationSec: m.durationSec ?? null,
      noteSpecVersion: str(m.noteSpecVersion, "noteSpecVersion"),
      options: { syntheticExamples: flag("syntheticExamples"), externalAugmentation: flag("externalAugmentation"), exam: flag("exam") },
      counts,
    };
  }

  // 완료된 강의를 통째로 저장한다(덮어쓰기). input은 undefined면 이전 입력을 두고, note는 null이면 이전 노트를 지운다(인식만 한 결과).
  // recognition(인식 결과만 남은 기록)도 note와 같은 규칙: undefined면 이전 기록 유지, null이면 지운다.
  async function saveResult(store, { packageId, meta, input, note, crops = {}, recognition } = {}, { now } = {}) {
    const t = now ? now() : Date.now(), nowIso = (t instanceof Date ? t : new Date(t)).toISOString();
    // 쓰기 전에 전부 검증한다 — 도중 실패로 반만 저장된 패키지가 남지 않게.
    const prev = await store.getJson("packages", metaId(packageId)).catch(() => null);
    const clean = cleanMeta(packageId, meta, prev, nowIso);
    for (const id of Object.keys(crops)) if (!CROP_RE.test(id)) throw new TypeError("크롭 식별자가 올바르지 않습니다.");

    await store.putJson("packages", metaId(packageId), clean);
    if (input !== undefined) await store.putJson("packages", inputId(packageId), input);
    if (note == null) await store.delete("packages", noteId(packageId));
    else await store.putJson("packages", noteId(packageId), note);
    if (recognition === null) await store.delete("packages", recId(packageId));
    else if (recognition !== undefined) await store.putJson("packages", recId(packageId), recognition);
    for (const [id, bytes] of Object.entries(crops)) await store.putBytes("blobs", cropId(packageId, id), bytes);
    return clean;
  }

  // updatedAt 최신순. 깨진 메타 하나가 목록 전체를 막지 못하게 건너뛴다.
  async function list(store) {
    const out = [];
    for (const id of await store.ids("packages")) {
      if (!id.endsWith(":meta")) continue;
      try { const m = await store.getJson("packages", id); if (m) out.push(m); } catch { /* 손상 레코드는 건너뛴다 */ }
    }
    return out.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  // 메타가 없거나 깨졌으면 패키지가 없는 것으로 본다. 노트·입력이 깨져도 메타는 돌려준다.
  async function load(store, packageId) {
    const meta = await store.getJson("packages", metaId(packageId)).catch(() => null);
    if (!meta) return null;
    const note = await store.getJson("packages", noteId(packageId)).catch(() => null);
    const input = await store.getJson("packages", inputId(packageId)).catch(() => null);
    const recognition = await store.getJson("packages", recId(packageId)).catch(() => null);
    return { meta, note, input, recognition };
  }

  async function crops(store, packageId) {
    const pre = `${packageId}:crop:`, out = {};
    for (const id of await store.ids("blobs")) {
      if (!id.startsWith(pre)) continue;
      try { const b = await store.getBytes("blobs", id); if (b) out[id.slice(pre.length)] = b; } catch { /* 깨진 크롭은 건너뛴다 */ }
    }
    return out;
  }

  // data URL용 base64 — 청크로 나눠 String.fromCharCode의 인수 한도를 피한다.
  const b64 = b => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  // 이미지 포맷은 매직 바이트로만 판별한다 — 그 밖의 바이트는 화면에 올리지 않는다.
  const imgMime = b => {
    if (!b) return null;
    if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "png";
    if (b.length > 2 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "jpeg";
    if (b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
    return null;
  };

  // 렌더러·패널이 <img> src 로 쓸 수 있게 크롭 바이트를 data URL로 바꾼다. 이미지가 아닌 바이트는 건너뛴다.
  async function cropUrls(store, packageId) {
    const out = {};
    for (const [id, b] of Object.entries(await crops(store, packageId))) {
      const mime = imgMime(b);
      if (mime) out[id] = `data:image/${mime};base64,${b64(b)}`;
    }
    return out;
  }

  // `<pkg>:`로 시작하는 레코드를 packages·blobs 양쪽에서 지운다(파생물·단계 캐시 포함).
  // 끝의 ':'가 "pkg1"이 "pkg10:…"을 지우는 사고를 막는다. 지운 레코드 수를 돌려준다.
  async function remove(store, packageId) {
    const pre = `${packageId}:`;
    let n = 0;
    for (const s of ["packages", "blobs"]) for (const id of await store.ids(s)) {
      if (id.startsWith(pre)) { await store.delete(s, id); n++; }
    }
    return n;
  }

  // 새 패키지 id: "L" + base36 시작 시각 + "-" + 무작위 hex 6자. 호스트·제목 같은 내용은 싣지 않는다.
  function packageIdFor({ startedAt } = {}) {
    const t = startedAt instanceof Date ? startedAt.getTime() : (startedAt ?? Date.now());
    const hex = [...c().getRandomValues(new Uint8Array(3))].map(b => b.toString(16).padStart(2, "0")).join("");
    return `L${Math.floor(t).toString(36)}-${hex}`;
  }

  const api = { metaId, noteId, inputId, recId, cropId, saveResult, list, load, crops, cropUrls, remove, packageIdFor };
  globalThis.NoteLibrary = api;
  if (typeof module !== "undefined") module.exports = api;
})();
