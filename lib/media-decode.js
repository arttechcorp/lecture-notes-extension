// 백그라운드 경로의 브라우저 쪽 디코드: media-demux.js가 꺼낸 H.264 키프레임과 AAC 샘플을 WebCodecs로 풀어
//  - keyframeImages: 키프레임 → {t, sample(256×144 캔버스: VisualGate.inspect 입력), blob(JPEG, 비전 API 입력)}
//  - audioEnergy: 오디오 트랙 → 강의 타임라인의 30ms RMS 배열(stt-client의 vadSegments·planChunks 입력)
// Worker나 offscreen 문서에서 돌린다(DOM 없음). AGENTS §2: 원본 미디어는 메모리에서만 — VideoFrame·AudioData는 콜백 안에서 바로 close()하고,
// PCM은 프레임별 합계로만 접어 버린다(한 시간 분량 PCM을 쥐지 않는다). 아무 데도 쓰지 않는다.
// 오류는 code가 있다: DECODE_UNSUPPORTED(WebCodecs 없음·isConfigSupported 거절), DECODE_TOO_BIG(JPEG 한도 초과), DECODE_FAILED(그 밖). 취소는 signal.reason 그대로.
(() => {
  const MAX_JPEG_BYTES = 1536 * 1024; // server/index.js의 image_too_large 한도(= 1.5MB)
  const BATCH = 4; // 한 배치의 청크 수 = 디코더 큐와 JPEG를 기다리는 이미지의 상한(docs/architecture-v2.md §6.1 메모리 예산: 대기 프레임 ≤ 4)
  const coded = (code, msg, cause) => Object.assign(new Error(msg, cause && { cause }), { code });
  // DOMException도 숫자 code를 갖기 때문에 문자열일 때만 우리 오류로 본다
  const fail = (e, signal) => signal?.aborted ? signal.reason : typeof e?.code === "string" ? e : coded("DECODE_FAILED", "미디어를 디코드하지 못했습니다.", e);
  const sig = (...parts) => parts.map(p => p?.join?.() ?? p).join("|"); // 설정이 같은지 비교하는 키(description은 바이트)
  const need = (...names) => { if (names.some(n => typeof globalThis[n] === "undefined")) throw coded("DECODE_UNSUPPORTED", "이 환경에서는 WebCodecs를 쓸 수 없습니다."); };
  const supported = async (Ctor, cfg) => { if (!(await Ctor.isConfigSupported(cfg)).supported) throw coded("DECODE_UNSUPPORTED", `지원하지 않는 코덱입니다: ${cfg.codec}`); };

  // ---- 순수 계산 (Node 시험 대상) ----
  // 긴 변이 maxSide를 넘을 때만 비율을 지켜 줄인다(키우지 않는다).
  const fit = (w, h, maxSide) => { const r = Math.min(1, maxSide / Math.max(w, h)); return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) }; };

  // t0부터 end(초)까지의 frameMs 프레임별 제곱합·개수 누산기
  const makeAcc = (t0, end, frameMs) => { const n = Math.ceil((end - t0) * 1000 / frameMs - 1e-9); return { t0, frameMs, sum: new Float64Array(n), cnt: new Uint32Array(n) }; };
  // 디코드된 PCM 한 덩어리(planes: 채널별 Float32Array, t: 첫 샘플의 강의 시각)를 모노로 섞어 프레임에 더한다.
  // 프레임 경계는 stt-client energyFrames와 같다: 프레임 i = 샘플 [round(i·step), round((i+1)·step)). 덩어리 경계가 프레임 중간이어도 합계가 이어진다.
  function accumulate(acc, planes, rate, t) {
    const { sum, cnt } = acc, step = rate * acc.frameMs / 1000, n = planes[0].length, C = planes.length;
    let k = Math.round((t - acc.t0) * rate), j = 0; // k: t0 기준 샘플 번호, j: 덩어리 안 위치
    if (k < 0) { j = -k; k = 0; } // t0보다 앞(디코더 프라이밍 등)은 버린다
    let f = Math.floor(k / step);
    while (Math.round(f * step) > k) f--;
    while (Math.round((f + 1) * step) <= k) f++;
    while (j < n && f < sum.length) {
      const len = Math.min(n - j, Math.round((f + 1) * step) - k); // 위 루프 덕에 len ≥ 1
      let s = 0;
      for (const e = j + len; j < e; j++) { let m = 0; for (let c = 0; c < C; c++) m += planes[c][j]; m /= C; s += m * m; }
      sum[f] += s; cnt[f] += len; k += len; f++;
    }
  }
  // 샘플이 하나도 안 닿은 프레임은 0 = 무음이다(빠진 세그먼트). 같은 DISCONTINUITY 구간의 세그먼트 사이는 demux가 이어 붙이므로 이음새에 구멍이 없다.
  const rms = ({ sum, cnt }) => Float32Array.from(sum, (s, i) => cnt[i] ? Math.sqrt(s / cnt[i]) : 0);

  // ---- 클라우드 STT용 모노 PCM(16 kHz)과 WAV ----
  // MAI-Transcribe 2는 WAV·MP3·FLAC만 문서화돼 있어(m4a 미확인) 청크를 WAV로 보낸다. 에너지를 잴 때 이미 디코드하므로 같은 출력을 모노로 섞어 함께 담는다.
  // ponytail: 선형 보간 리샘플이라 저역 통과 필터가 없다(음성 인식에는 충분). 음질 문제가 보이면 여기서 FIR을 건다.
  const makePcm = (t0, end, rate) => ({ t0, rate, data: new Float32Array(Math.max(0, Math.ceil((end - t0) * rate - 1e-9))) });
  function resampleInto(pcm, planes, srcRate, t) {
    const n = planes[0].length, C = planes.length, { rate, data } = pcm;
    const mono = i => { let m = 0; for (let c = 0; c < C; c++) m += planes[c][i]; return m / C; };
    const first = Math.max(0, Math.ceil((t - pcm.t0) * rate - 1e-9)), last = Math.min(data.length, Math.ceil((t + n / srcRate - pcm.t0) * rate - 1e-9));
    for (let o = first; o < last; o++) {
      const x = Math.max(0, ((pcm.t0 + o / rate) - t) * srcRate), i = Math.floor(x), f = x - i; // 경계의 부동소수 오차로 덩어리 앞(-1)을 읽지 않게
      data[o] = i + 1 < n ? mono(i) * (1 - f) + mono(i + 1) * f : mono(Math.min(i, n - 1));
    }
  }
  // [t0, t1) 구간을 16비트 PCM WAV 바이트로. 범위 밖은 무음이다.
  function wavSlice(pcm, t0, t1) {
    const a = Math.max(0, Math.round((t0 - pcm.t0) * pcm.rate)), b = Math.max(a, Math.round((t1 - pcm.t0) * pcm.rate)), n = b - a;
    const out = new Uint8Array(44 + n * 2), v = new DataView(out.buffer), str = (o, x) => { for (let i = 0; i < x.length; i++) out[o + i] = x.charCodeAt(i); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, pcm.rate, true); v.setUint32(28, pcm.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) { const x = a + i < pcm.data.length ? Math.max(-1, Math.min(1, pcm.data[a + i])) : 0; v.setInt16(44 + i * 2, Math.round(x * 32767), true); }
    return out;
  }

  // ---- 키프레임 → 이미지 ----
  // VideoFrame을 콜백 안에서 곧바로 그리고 닫는다(안 닫으면 디코더 프레임 풀이 말라 멈춘다). 큰 캔버스는 JPEG 인코딩 때까지만 쥔다.
  function draw(frame, maxSide) {
    const { w, h } = fit(frame.displayWidth, frame.displayHeight, maxSide);
    const full = new OffscreenCanvas(w, h); full.getContext("2d").drawImage(frame, 0, 0, w, h);
    // VisualGate는 캔버스를 drawImage로 받는다(ImageData는 못 받음). 비율 무시 256×144로 늘여 그리는 것도 게이트의 sample()과 같다.
    const sample = new OffscreenCanvas(256, 144); sample.getContext("2d", { willReadFrequently: true }).drawImage(frame, 0, 0, 256, 144);
    return { t: frame.timestamp / 1e6, sample, full };
  }
  async function jpeg(canvas, quality) {
    let blob;
    for (const q of [quality, quality * 0.6]) { // 한도를 넘으면 품질을 한 번만 낮춘다
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: q });
      if (blob.size <= MAX_JPEG_BYTES) return blob;
    }
    throw coded("DECODE_TOO_BIG", `JPEG가 ${MAX_JPEG_BYTES}바이트 한도를 넘었습니다: ${blob.size}`);
  }

  // keyframes: media-demux keyframes()의 결과(시간순). 한 장씩 내므로 소비자가 느리면 디코드도 멈춘다.
  // ponytail: decodeQueueSize를 재지 않는다 — 배치(BATCH개)마다 flush하므로 큐와 대기 프레임이 배치 크기로 이미 묶여 있다. 배치를 키우면 그때 폴링을 넣는다.
  async function* keyframeImages(keyframes, { signal, maxSide = 1600, quality = 0.8 } = {}) {
    let dec = null, cfg = null, bad = null;
    const ready = [];
    const output = frame => { try { ready.push(draw(frame, maxSide)); } catch (e) { bad ??= e; } finally { frame.close(); } };
    try {
      for (let i = 0; i < keyframes.length;) {
        signal?.throwIfAborted();
        const head = keyframes[i], id = sig(head.codec, head.description);
        let j = i + 1; // 설정이 같은 연속 키프레임만 한 배치로 묶는다
        while (j < keyframes.length && j - i < BATCH && sig(keyframes[j].codec, keyframes[j].description) === id) j++;
        const batch = keyframes.slice(i, j); i = j;
        if (id !== cfg) { // 같은 {codec, description}이면 한 번만 configure, 바뀌면 다시
          const c = { codec: head.codec, description: head.description };
          need("VideoDecoder", "EncodedVideoChunk", "OffscreenCanvas");
          await supported(VideoDecoder, c);
          dec ??= new VideoDecoder({ output, error: e => { bad ??= e; } });
          dec.configure(c); cfg = id;
        }
        for (const k of batch) dec.decode(new EncodedVideoChunk({ type: "key", timestamp: Math.round(k.t * 1e6), data: k.data }));
        await dec.flush();
        if (bad) throw bad;
        if (ready.length !== batch.length) throw coded("DECODE_FAILED", `키프레임 ${batch.length}개 중 ${ready.length}개만 디코드됐습니다.`);
        for (let r; (r = ready.shift());) { signal?.throwIfAborted(); yield { t: r.t, sample: r.sample, blob: await jpeg(r.full, quality) }; } // shift: 낸 이미지의 큰 캔버스는 바로 놓는다
      }
    } catch (e) { throw fail(e, signal); }
    finally { if (dec && dec.state !== "closed") dec.close(); }
  }

  // ---- 오디오 → 프레임 에너지 ----
  // audioTracks: media-demux demuxSegment().audio 트랙들(시간순, null 허용). 반환 energy[i]는 강의 시각 t0 + i·frameMs/1000 구간의 모노 RMS다.
  // t0는 첫 샘플의 t(전체 강의면 0)라서 vadSegments·planChunks가 돌려주는 시각에 t0를 더하면 강의 시각이 된다. 샘플이 없는 구간은 0이다.
  // ponytail: 트랙(= 세그먼트 하나)을 통째로 큐에 넣고 끝에서 flush한다. 수 시간짜리 단일 트랙이 들어오면 N개마다 flush하도록 바꾼다.
  // pcmRate를 주면 같은 디코드에서 모노 PCM도 담아 돌려준다(pcm: {t0, rate, data}). wavSlice로 청크를 자른다.
  async function audioEnergy(audioTracks, { frameMs = 30, signal, pcmRate = 0 } = {}) {
    const trs = [].concat(audioTracks).filter(tr => tr?.type === "audio" && tr.samples?.length);
    if (!trs.length) return { t0: 0, frameMs, energy: new Float32Array(0) };
    const t0 = Math.min(...trs.map(tr => tr.samples[0].t)), end = Math.max(...trs.map(tr => { const s = tr.samples[tr.samples.length - 1]; return s.t + s.dur; }));
    const acc = makeAcc(t0, end, frameMs), pcm = pcmRate > 0 ? makePcm(t0, end, pcmRate) : null;
    let dec = null, cfg = null, bad = null, prime = false;
    const output = ad => {
      try {
        // 트랙마다 flush한 디코더에서 새로 시작해 첫 출력 프레임(AAC 1024샘플)은 앞 프레임과 겹쳐 더해지지 않은 페이드인이다(RMS가 절반 아래로 꺼진다).
        // 버린다. 생기는 21~23ms 구멍은 30ms 프레임보다 짧아 프레임이 통째로 비지 않는다(그 프레임의 RMS는 남은 샘플로 구한다).
        if (prime) { prime = false; return; }
        const planes = Array.from({ length: ad.numberOfChannels }, (_, c) => { const p = new Float32Array(ad.numberOfFrames); ad.copyTo(p, { planeIndex: c, format: "f32-planar" }); return p; });
        accumulate(acc, planes, ad.sampleRate, ad.timestamp / 1e6);
        if (pcm) resampleInto(pcm, planes, ad.sampleRate, ad.timestamp / 1e6);
      } catch (e) { bad ??= e; } finally { ad.close(); }
    };
    try {
      need("AudioDecoder", "EncodedAudioChunk");
      for (const tr of trs) {
        signal?.throwIfAborted();
        const id = sig(tr.codec, tr.sampleRate, tr.channels, tr.description);
        if (id !== cfg) { // 이전 트랙은 아래 flush로 비어 있다
          const c = { codec: tr.codec, sampleRate: tr.sampleRate, numberOfChannels: tr.channels, description: tr.description };
          await supported(AudioDecoder, c);
          dec ??= new AudioDecoder({ output, error: e => { bad ??= e; } });
          dec.configure(c); cfg = id;
        }
        prime = true;
        for (const s of tr.samples) dec.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(s.t * 1e6), data: tr.buf.subarray(s.off, s.off + s.size) }));
        await dec.flush();
        if (bad) throw bad;
      }
      return { t0, frameMs, energy: rms(acc), ...(pcm && { pcm }) };
    } catch (e) { throw fail(e, signal); }
    finally { if (dec && dec.state !== "closed") dec.close(); }
  }

  const api = { MAX_JPEG_BYTES, keyframeImages, audioEnergy, fit, jpeg, makeAcc, accumulate, rms, makePcm, resampleInto, wavSlice }; // fit·jpeg·makeAcc·accumulate·rms는 시험용으로도 내보낸다
  globalThis.LectureDecode = api; if (typeof module !== "undefined") module.exports = api;
})();
