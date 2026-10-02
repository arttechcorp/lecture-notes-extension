// 강의 미디어 디먹스의 순수 로직. 메모리 안의 바이트만 다루고 네트워크·저장소·DOM에 닿지 않는다(AGENTS §2: 원본 미디어는 메모리에서만).
// 흐름: 세그먼트 바이트 → (TS면 vendor mux.js로 fMP4 변환) → fMP4 샘플표 읽기 → 키프레임 목록 / m4a 청크.
// 먼저 lib/vendor/mux/mux-mp4.min.js(전역 muxjs)를 로드해야 한다. mux.js는 TS 변환에만 쓰고, fMP4 샘플표 읽기와 m4a 쓰기는 여기서 직접 한다.
//
// 시각: 모든 t는 강의 타임라인 기준 초. t = 세그먼트 start(parseM3U8의 EXTINF 누적) + (샘플 PTS − 그 트랙의 세그먼트 안 최소 PTS).
//   트랙·세그먼트마다 따로 기준을 잡으므로 DISCONTINUITY·PTS 리셋과 무관하다(원래 PTS는 track.mediaStart). 편집 목록(elst)은 읽지 않는다 —
//   오차는 EXTINF 반올림과 A/V 인코더 지연 수준(수십~수백 ms)이다. 오디오 청크의 길이는 t가 아니라 담긴 샘플 길이의 합이다.
//
// 메모리(호출자 책임):
//  - demuxSegment가 돌려준 track.buf·키프레임 data·description은 복사하지 않은 뷰다. fMP4 입력이면 입력 바이트 자체를,
//    TS 입력이면 mux.js가 만든 새 버퍼를 가리킨다(TS 원본은 반환 직후 버려도 된다). 쓰고 나면 track과 키프레임 참조를 모두 버려야 버퍼가 풀린다.
//  - 키프레임 하나만 붙들고 있어도 세그먼트 전체(수 MB)가 안 풀린다. 오래 들고 있어야 하면 data.slice()로 복사한다.
//  - audioChunks는 새 버퍼에 복사해 돌려준다(입력과 독립). 전송이 끝나면 bytes를 버린다.
(() => {
  // server/index.js의 STT_MAX_SEC·STT_MAX_BYTES와 같아야 한다(테스트가 대조)
  const MAX_CHUNK_SEC = 330, MAX_CHUNK_BYTES = 8 * 1024 * 1024;
  const coded = (code, msg, cause) => Object.assign(new Error(msg, cause && { cause }), { code });
  const view = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const cc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const u64 = (dv, o) => dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);

  // ---- ISO-BMFF 읽기 ----
  // [s,e) 안의 박스를 {type,s,h(헤더 길이),e}로 나열한다. 깨진 크기에서는 멈추고, 버퍼보다 긴 박스는 끝까지로 자른다(잘림은 샘플 범위 검사가 잡는다).
  function boxes(dv, s, e) {
    const out = [];
    while (s + 8 <= e) {
      let size = dv.getUint32(s), h = 8;
      if (size === 1) { if (s + 16 > e) break; size = u64(dv, s + 8); h = 16; } else if (size === 0) size = e - s;
      if (size < h) break;
      out.push({ type: cc(dv, s + 4), s, h, e: Math.min(s + size, e) });
      s += size;
    }
    return out;
  }
  const kid = (dv, b, type) => boxes(dv, b.s + b.h, b.e).find(x => x.type === type);
  const dig = (dv, b, ...path) => path.reduce((p, t) => p && kid(dv, p, t), b);

  // esds의 ES_Descriptor(3) → DecoderConfig(4) → DecoderSpecificInfo(5, AudioSpecificConfig)
  function parseEsds(u8) {
    let o = 0, n;
    const tag = () => { const t = u8[o++]; n = 0; for (let i = 0, b; i < 4; i++) { b = u8[o++]; n = n * 128 + (b & 127); if (!(b & 128)) break; } return t; };
    if (tag() !== 3) return null;
    o += 2; const fl = u8[o++]; if (fl & 128) o += 2; if (fl & 64) o += 1 + u8[o]; if (fl & 32) o += 2;
    if (tag() !== 4) return null;
    const oti = u8[o]; o += 13;
    return { oti, asc: tag() === 5 ? u8.subarray(o, o + n) : null };
  }

  // moov → 트랙별 {id,type,timescale,codec,description,…}과 trex 기본값. 보호된 샘플 엔트리(encv/enca)는 거절한다.
  function parseInit(init) {
    const dv = view(init), moov = kid(dv, { s: 0, h: 0, e: init.length }, "moov");
    if (!moov) throw coded("DEMUX_NO_INIT", "초기화 구간(moov)이 없습니다.");
    const trex = new Map(), tracks = new Map();
    const mvex = kid(dv, moov, "mvex");
    for (const b of mvex ? boxes(dv, mvex.s + mvex.h, mvex.e) : []) if (b.type === "trex") { const o = b.s + b.h; trex.set(dv.getUint32(o + 4), { dur: dv.getUint32(o + 12), size: dv.getUint32(o + 16), flags: dv.getUint32(o + 20) }); }
    // tkhd의 track_ID와 mdhd의 timescale은 version 0/1에서 각각 12/20바이트 뒤에 있다
    const word = b => dv.getUint32(b.s + b.h + (dv.getUint8(b.s + b.h) === 1 ? 20 : 12));
    for (const trak of boxes(dv, moov.s + moov.h, moov.e)) {
      if (trak.type !== "trak") continue;
      const tkhd = kid(dv, trak, "tkhd"), mdhd = dig(dv, trak, "mdia", "mdhd"), hdlr = dig(dv, trak, "mdia", "hdlr"), stsd = dig(dv, trak, "mdia", "minf", "stbl", "stsd");
      if (!tkhd || !mdhd || !hdlr || !stsd) continue;
      const type = { vide: "video", soun: "audio" }[cc(dv, hdlr.s + hdlr.h + 8)];
      const entry = boxes(dv, stsd.s + stsd.h + 8, stsd.e)[0];
      if (!type || !entry) continue;
      if (/^enc[a-z]$/.test(entry.type)) throw coded("DEMUX_PROTECTED", "암호화된 트랙입니다. 보호조치는 우회하지 않습니다.");
      const id = word(tkhd), t = { id, type, timescale: word(mdhd), trex: trex.get(id) ?? { dur: 0, size: 0, flags: 0 }, codec: null, description: null };
      if (type === "video") {
        t.width = dv.getUint16(entry.s + 32); t.height = dv.getUint16(entry.s + 34);
        const cfg = boxes(dv, entry.s + 86, entry.e).find(b => b.type === "avcC");
        // VideoDecoder용: description = AVCDecoderConfigurationRecord, codec = avc1.PPCCLL. H.264 외에는 codec이 null이다.
        if (cfg && /^avc[13]$/.test(entry.type)) { t.description = init.subarray(cfg.s + cfg.h, cfg.e); t.codec = entry.type + "." + Array.from(t.description.subarray(1, 4), x => x.toString(16).padStart(2, "0")).join(""); }
      } else {
        t.channels = dv.getUint16(entry.s + 24); t.sampleRate = dv.getUint16(entry.s + 32);
        t.stsd = init.subarray(stsd.s, stsd.e); // m4a 청크의 샘플 엔트리로 그대로 쓴다
        const es = boxes(dv, entry.s + 36, entry.e).find(b => b.type === "esds"), cfg = es && parseEsds(init.subarray(es.s + es.h + 4, es.e));
        t.description = cfg?.asc ?? null;
        t.codec = cfg?.oti === 0x40 && cfg.asc ? "mp4a.40." + (cfg.asc[0] >> 3) : cfg ? "mp4a." + cfg.oti.toString(16) : entry.type;
      }
      tracks.set(id, t);
    }
    return tracks;
  }

  // moof/traf/trun → 트랙별 샘플표 {dts,cts,d(틱),off,size,sync}. off는 buf 안 위치. 데이터 위치는 moof 시작 기준(HLS fMP4의 일반형)이다.
  function parseFragments(buf, tracks) {
    const dv = view(buf), got = new Map();
    for (const moof of boxes(dv, 0, buf.length)) {
      if (moof.type !== "moof") continue;
      for (const traf of boxes(dv, moof.s + moof.h, moof.e)) {
        const tfhd = traf.type === "traf" ? kid(dv, traf, "tfhd") : null;
        if (!tfhd) continue;
        let o = tfhd.s + tfhd.h; const tf = dv.getUint32(o) & 0xffffff, tr = tracks.get(dv.getUint32(o + 4)); o += 8;
        if (!tr) continue;
        let base = moof.s; if (tf & 1) { base = u64(dv, o); o += 8; }
        if (tf & 2) o += 4;
        const d = { ...tr.trex };
        if (tf & 8) { d.dur = dv.getUint32(o); o += 4; }
        if (tf & 0x10) { d.size = dv.getUint32(o); o += 4; }
        if (tf & 0x20) { d.flags = dv.getUint32(o); o += 4; }
        const tfdt = kid(dv, traf, "tfdt"); let dts = 0;
        if (tfdt) { const p = tfdt.s + tfdt.h; dts = dv.getUint8(p) === 1 ? u64(dv, p + 4) : dv.getUint32(p + 4); }
        const list = got.get(tr.id) ?? got.set(tr.id, []).get(tr.id); let next = base;
        for (const trun of boxes(dv, traf.s + traf.h, traf.e)) {
          if (trun.type !== "trun") continue;
          let p = trun.s + trun.h; const ver = dv.getUint8(p), fl = dv.getUint32(p) & 0xffffff, n = dv.getUint32(p + 4); p += 8;
          if (n > 2e5) throw coded("DEMUX_BAD_MEDIA", "샘플 수가 비정상입니다.");
          if (fl & 1) { next = base + dv.getInt32(p); p += 4; }
          let first = null; if (fl & 4) { first = dv.getUint32(p); p += 4; }
          const rd = (bit, def, signed) => { if (!(fl & bit)) return def; const v = signed ? dv.getInt32(p) : dv.getUint32(p); p += 4; return v; };
          for (let i = 0; i < n; i++) {
            const dur = rd(0x100, d.dur), size = rd(0x200, d.size), sf = rd(0x400, i === 0 && first !== null ? first : d.flags), cts = rd(0x800, 0, ver === 1);
            if (next < 0 || next + size > buf.length) throw coded("DEMUX_TRUNCATED", "세그먼트가 잘렸습니다.");
            list.push({ dts, cts, d: dur, off: next, size, sync: !(sf & 0x10000) }); // sample_is_non_sync_sample 비트가 0이면 동기 샘플
            dts += dur; next += size;
          }
        }
      }
    }
    return got;
  }

  // ---- 공개 ----
  // TS(또는 ADTS) 세그먼트 → [{type:"video"|"audio", init, data}] fMP4 조각. 오디오와 비디오는 따로 나온다.
  function transmuxTs(bytes) {
    const mux = globalThis.muxjs;
    if (!mux?.Transmuxer) throw coded("DEMUX_NO_MUXJS", "mux.js가 로드되지 않았습니다.");
    // keepOriginalTimestamps: 오디오·비디오의 원래 PTS 관계를 보존한다(false면 트랙마다 0으로 되감긴다)
    const tx = new mux.Transmuxer({ remux: false, keepOriginalTimestamps: true }), parts = [];
    tx.on("data", s => parts.push({ type: s.type, init: s.initSegment, data: s.data }));
    try { tx.push(bytes); tx.flush(); } catch (e) { throw coded("DEMUX_BAD_MEDIA", "TS 세그먼트를 해석하지 못했습니다.", e); }
    return parts;
  }

  // 세그먼트 하나 → {video, audio} (없으면 null). track = {type,id,timescale,codec,description,buf,mediaStart,samples[{t,dur,d,off,size,sync}], 비디오 width·height, 오디오 channels·sampleRate·stsd}
  // bytes: TS 또는 fMP4 미디어 세그먼트. init: fMP4일 때 EXT-X-MAP 바이트(세그먼트가 moov를 품고 있으면 생략). start: 이 세그먼트의 EXTINF 누적 시각.
  function demuxSegment(bytes, { init = null, start = 0 } = {}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("세그먼트는 Uint8Array여야 합니다.");
    const iso = bytes.length >= 8 && /^(?:ftyp|styp|moof|moov|sidx|emsg)$/.test(cc(view(bytes), 4));
    const found = [];
    try {
      for (const p of iso ? [{ init: init || bytes, data: bytes }] : transmuxTs(bytes)) {
        const meta = parseInit(p.init);
        for (const [id, samples] of parseFragments(p.data, meta)) if (samples.length) found.push({ ...meta.get(id), buf: p.data, samples });
      }
    } catch (e) { throw e.code ? e : coded("DEMUX_BAD_MEDIA", "미디어 구조가 올바르지 않습니다.", e); } // 잘린 헤더의 DataView RangeError 등
    if (!found.length) {
      const progressive = iso && !init && kid(view(bytes), { s: 0, h: 0, e: bytes.length }, "moov"); // moov만 있고 moof가 없는 일반 MP4
      throw coded(progressive ? "DEMUX_UNSUPPORTED" : "DEMUX_BAD_MEDIA", progressive ? "조각화되지 않은 MP4는 아직 지원하지 않습니다." : "세그먼트에서 미디어 샘플을 찾지 못했습니다.");
    }
    const pick = type => {
      const tr = found.find(x => x.type === type);
      if (!tr) return null;
      let base = Infinity;
      for (const s of tr.samples) base = Math.min(base, s.dts + s.cts);
      for (const s of tr.samples) { s.t = start + (s.dts + s.cts - base) / tr.timescale; s.dur = s.d / tr.timescale; }
      tr.mediaStart = base / tr.timescale; delete tr.trex;
      return tr;
    };
    return { video: pick("video"), audio: pick("audio") };
  }

  // 동기(키) 샘플만 {t,data,codec,description}로. interval: 직전에 낸 키프레임보다 이만큼(초) 이상 뒤의 것만(0이면 전부).
  // after: 이전 세그먼트에서 마지막으로 낸 키프레임의 t를 넘기면 세그먼트 경계를 넘어 간격이 이어진다.
  function keyframes(track, { interval = 0, after = -Infinity } = {}) {
    if (!track || track.type !== "video") return [];
    if (!track.codec) throw coded("DEMUX_UNSUPPORTED", "지원하지 않는 영상 코덱입니다(H.264만 지원).");
    const out = []; let last = after;
    for (const s of track.samples) {
      if (!s.sync || s.t - last < interval - 1e-6) continue;
      out.push({ t: s.t, data: track.buf.subarray(s.off, s.off + s.size), codec: track.codec, description: track.description });
      last = s.t;
    }
    return out;
  }

  // ---- m4a 쓰기: ftyp + moov + mdat (비조각, moov 앞) ----
  const box = (type, ...parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 8)), dv = view(out);
    dv.setUint32(0, out.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    let o = 8; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const words = (...v) => { const out = new Uint8Array(v.length * 4), dv = view(out); v.forEach((x, i) => dv.setUint32(i * 4, x)); return out; };
  const MATRIX = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000];

  // stsd: 원본 샘플 엔트리(box 전체), items: [{buf,off,size,d}]
  function writeM4a(stsd, timescale, items) {
    const n = items.length, total = items.reduce((a, x) => a + x.d, 0), dataLen = items.reduce((a, x) => a + x.size, 0);
    const runs = []; for (const x of items) { const r = runs[runs.length - 1]; if (r && r[1] === x.d) r[0]++; else runs.push([1, x.d]); }
    const stsz = new Uint8Array(12 + 4 * n), sv = view(stsz); sv.setUint32(8, n); items.forEach((x, i) => sv.setUint32(12 + 4 * i, x.size));
    const stbl = box("stbl", stsd, box("stts", words(0, runs.length, ...runs.flat())), box("stsc", words(0, 1, 1, n, 1)), box("stsz", stsz), box("stco", words(0, 1, 0)));
    const dinf = box("dinf", box("dref", words(0, 1), box("url ", words(1))));
    const moov = box("moov",
      box("mvhd", words(0, 0, 0, timescale, total, 0x10000, 0x01000000, 0, 0, ...MATRIX, 0, 0, 0, 0, 0, 0, 2)),
      box("trak", box("tkhd", words(3, 0, 0, 1, 0, total, 0, 0, 0, 0x01000000, ...MATRIX, 0, 0)),
        box("mdia", box("mdhd", words(0, 0, 0, timescale, total, 0x55c40000)),
          box("hdlr", words(0, 0), new TextEncoder().encode("soun"), new Uint8Array(12), new TextEncoder().encode("SoundHandler\0")),
          box("minf", box("smhd", words(0, 0)), dinf, stbl))));
    const ftyp = box("ftyp", new TextEncoder().encode("M4A "), words(0), new TextEncoder().encode("M4A mp42isom"));
    const out = new Uint8Array(ftyp.length + moov.length + 8 + dataLen);
    out.set(ftyp); out.set(moov, ftyp.length);
    // stco는 moov의 맨 끝 박스이므로 마지막 4바이트가 청크 오프셋(= mdat 본문 위치)이다
    view(out).setUint32(ftyp.length + moov.length - 4, ftyp.length + moov.length + 8);
    const mdat = ftyp.length + moov.length; view(out).setUint32(mdat, 8 + dataLen); out.set(new TextEncoder().encode("mdat"), mdat + 4);
    let o = mdat + 8; for (const x of items) { out.set(x.buf.subarray(x.off, x.off + x.size), o); o += x.size; }
    return out;
  }

  const sameBytes = (a, b) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));
  const sameConfig = (a, b) => a === b || (a.timescale === b.timescale && sameBytes(a.stsd, b.stsd));

  // 오디오 트랙들(시간순, demuxSegment 결과)에서 시간 범위 [{t0,t1}]마다 m4a 청크를 만든다.
  // 범위 안에서 시작하는 샘플을 모으되, 설정(샘플 엔트리)이 바뀌거나 maxGap초 넘게 끊기거나 maxSec·maxBytes를 넘기면 거기서 나눈다 — 한 m4a는 한 설정·연속 시간만 담는다.
  // 반환: [{t0,t1,durationSec,mime:"audio/mp4",bytes,sampleCount}]. t0 = 첫 샘플의 t, t1 = t0 + 담긴 샘플 길이의 합 — STT 결과의 청크 안 시각 r은 t0 + r로 강의 시각이 된다.
  function audioChunks(tracks, ranges, { maxSec = MAX_CHUNK_SEC, maxBytes = MAX_CHUNK_BYTES, maxGap = 1 } = {}) {
    const flat = [];
    for (const tr of [].concat(tracks)) if (tr?.type === "audio") for (const s of tr.samples) flat.push([tr, s]);
    const out = [];
    for (const r of ranges) {
      let part = [], size = 0, dur = 0;
      const emit = () => {
        if (!part.length) return;
        const tr = part[0][0], t0 = part[0][1].t;
        const bytes = writeM4a(tr.stsd, tr.timescale, part.map(([t, s]) => ({ buf: t.buf, off: s.off, size: s.size, d: s.d })));
        if (bytes.length > maxBytes) throw coded("DEMUX_CHUNK_TOO_BIG", "m4a 청크가 크기 한도를 넘었습니다.");
        out.push({ t0, t1: t0 + dur, durationSec: dur, mime: "audio/mp4", bytes, sampleCount: part.length });
        part = []; size = 0; dur = 0;
      };
      for (const [tr, s] of flat) {
        if (s.t < r.t0 || s.t >= r.t1) continue;
        const prev = part[part.length - 1];
        // 크기 계산은 보수적이다: 헤더 1KiB + 샘플당 stsz 4바이트·stts 최악 8바이트
        if (prev && (!sameConfig(prev[0], tr) || s.t - (prev[1].t + prev[1].dur) > maxGap || dur + s.dur > maxSec || size + s.size + 12 + 1024 > maxBytes)) emit();
        part.push([tr, s]); size += s.size + 12; dur += s.dur;
      }
      emit();
    }
    return out;
  }

  const api = { MAX_CHUNK_SEC, MAX_CHUNK_BYTES, transmuxTs, demuxSegment, keyframes, audioChunks };
  globalThis.LectureDemux = api; if (typeof module !== "undefined") module.exports = api;
})();
