// 오디오 캡처 및 Whisper 변환 핸들러

class AudioCapturer {
  // 20초 청크 기준 40건 = 약 13분 분량. 이보다 밀리면 따라잡을 가망이 없다.
  static MAX_PENDING = 40;

  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.mediaStreamSource = null;
    this.processor = null;
    this.worker = new Worker(chrome.runtime.getURL('lib/whisper-worker.js'), { type: 'module' });
    this.transcripts = [];
    this.onTranscript = null;
    this.getVideoTime = null; // 사이드패널이 주입: 영상 재생 위치(초)를 돌려준다
    this.onLog = null; // 사이드패널이 주입: 디버그 로그로 흘려보낸다
    this.language = "auto"; // 사이드패널이 주입: auto | korean | english
    this.model = "tiny"; // tiny | base

    // 워커로 보냈지만 아직 결과가 안 온 청크 수. 워커의 메시지 큐는 JS 에서
    // 들여다볼 수도, 비울 수도 없다. 직접 세지 않으면 얼마나 밀렸는지 알 방법이
    // 없고, 실제로 강의 대부분이 인식되지 못한 채 버려지고 있었다.
    this.pending = 0;
    this.dropped = 0;

    this.workerFailure = null;
    this.worker.onerror = (e) => {
      this._log(`워커 로드 실패: ${e.message || '(원인 없음 — CSP 확인)'}`);
      this.workerFailure = new Error(e.message || 'whisper worker failed to load');
      if (this._onWorkerError) this._onWorkerError(this.workerFailure);
    };

    this.worker.onmessage = (e) => {
      const { type, text, id, error } = e.data;
      // 결과가 어떤 모양이든 한 건이 끝난 것이다. 빈 결과와 오류에서 빼먹으면
      // pending 이 영영 0 으로 안 내려가고 노트 생성이 상한까지 기다린다.
      if (type === 'TRANSCRIBED' || type === 'ERROR') {
        this.pending = Math.max(0, this.pending - 1);
      }
      if (type === 'TRANSCRIBED') {
        const raw = (text || '').trim();
        // 빈 결과도 로그엔 남긴다. "무음이라 빈 결과"와 "청크가 안 온다"는 전혀 다른 고장이다.
        if (!raw) return this._log(`인식 결과 없음 (${Math.round(id)}초 구간 — 무음이거나 인식 실패)`);
        // 반복 루프를 접는다. 로그에 남기는 건 진단용이다 — 얼마나 자주 터지는지가
        // 청크 길이를 손볼지 말지 판단하는 근거가 된다.
        const { text: clean, removed } = collapseRepeats(raw);
        if (removed) this._log(`${Math.round(id)}초 구간 반복 루프 — 단어 ${removed}개 접음`);
        const item = { time: id, text: clean };
        this.transcripts.push(item);
        if (this.onTranscript) this.onTranscript(item);
      } else if (type === 'ERROR') {
        this._log(`Whisper 오류: ${error}`);
      }
    };
  }

  _log(msg) {
    if (this.onLog) this.onLog(`[음성] ${msg}`);
    else console.log('[음성]', msg);
  }

  async initModel(onProgress, model = this.model) {
    this.model = model;
    if (this.workerFailure) throw this.workerFailure;
    return new Promise((resolve, reject) => {
      this._onWorkerError = reject;
      const handler = (e) => {
        if (e.data.type === 'READY') {
          this.worker.removeEventListener('message', handler);
          resolve();
        } else if (e.data.type === 'PROGRESS' && onProgress) {
          onProgress(e.data.data);
        } else if (e.data.type === 'ERROR') {
          this.worker.removeEventListener('message', handler);
          reject(new Error(e.data.error));
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ type: 'INIT', model: this.model });
    });
  }

  // 오디오는 content script가 <video>에서 직접 떠서 포트로 보낸다(int16 PCM base64).
  // 여기서는 디코드해서 워커로 넘기기만 한다. 탭 캡처도, activeTab도 관여하지 않는다.
  pushAudio({ pcm, t, rms }) {
    if (this.workerFailure) return;
    // 인식이 재생을 못 따라가면 워커 큐가 무한정 자란다. 끝나지 않는 것보다
    // 버리고 알리는 편이 낫다. OCR 큐(MAX_QUEUE_BATCHES)와 같은 방식이다.
    if (this.pending >= AudioCapturer.MAX_PENDING) {
      this.dropped++;
      this._log(
        `인식이 밀려 ${Math.round(t)}초 구간을 건너뜁니다 ` +
          `(대기 ${this.pending}건, 누적 ${this.dropped}건). 더 가벼운 모델이나 1배속을 고려하세요.`
      );
      return;
    }
    const bin = atob(pcm);
    const audio = new Float32Array(bin.length / 2);
    const view = new DataView(new ArrayBuffer(2));
    for (let i = 0; i < audio.length; i++) {
      view.setUint8(0, bin.charCodeAt(i * 2));
      view.setUint8(1, bin.charCodeAt(i * 2 + 1));
      audio[i] = view.getInt16(0, true) / 0x8000;
    }
    // 배속 보정은 fe94d56 에서 제거됐다. "원속도로 복원" 이라고 찍던 옛 문구는
    // 사실이 아니어서 뺐다. 2배속이면 Whisper 가 2배 빠른 오디오를 그대로 받는다.
    this.pending++;
    this._log(`청크 ${audio.length}샘플, RMS ${rms.toFixed(5)} (대기 ${this.pending}건)`);
    this.worker.postMessage({ type: 'TRANSCRIBE', audio, id: t, language: this.language, model: this.model });
  }

  // 노트 생성이 끝난 뒤 호출된다. 그 시점에 워커에 남아 있는 건 쓸 데가 없으므로
  // 워커를 버려 CPU 를 돌려준다 — 예전에는 빈 함수라 계속 갈아내고 있었다.
  stopCapture() {
    if (this.pending > 0) this._log(`남은 인식 ${this.pending}건을 중단합니다.`);
    this.worker.terminate();
    this.workerFailure = new Error('중지됨');
    this.pending = 0;
  }
}

// 브라우저에서는 전역 클래스로 쓰이고, 테스트에서는 require 로 가져간다.
if (typeof module !== "undefined") module.exports = { AudioCapturer };
