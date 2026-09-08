// 오디오 캡처 및 Whisper 변환 핸들러

class AudioCapturer {
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

    this.workerFailure = null;
    this.worker.onerror = (e) => {
      this._log(`워커 로드 실패: ${e.message || '(원인 없음 — CSP 확인)'}`);
      this.workerFailure = new Error(e.message || 'whisper worker failed to load');
      if (this._onWorkerError) this._onWorkerError(this.workerFailure);
    };

    this.worker.onmessage = (e) => {
      const { type, text, id, error } = e.data;
      if (type === 'TRANSCRIBED') {
        const clean = (text || '').trim();
        // 빈 결과도 로그엔 남긴다. "무음이라 빈 결과"와 "청크가 안 온다"는 전혀 다른 고장이다.
        if (!clean) return this._log(`인식 결과 없음 (${Math.round(id)}초 구간 — 무음이거나 인식 실패)`);
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

  async initModel(onProgress) {
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
      this.worker.postMessage({ type: 'INIT' });
    });
  }

  // 오디오는 content script가 <video>에서 직접 떠서 포트로 보낸다(int16 PCM base64).
  // 여기서는 디코드해서 워커로 넘기기만 한다. 탭 캡처도, activeTab도 관여하지 않는다.
  pushAudio({ pcm, t, rms }) {
    if (this.workerFailure) return;
    const bin = atob(pcm);
    const audio = new Float32Array(bin.length / 2);
    const view = new DataView(new ArrayBuffer(2));
    for (let i = 0; i < audio.length; i++) {
      view.setUint8(0, bin.charCodeAt(i * 2));
      view.setUint8(1, bin.charCodeAt(i * 2 + 1));
      audio[i] = view.getInt16(0, true) / 0x8000;
    }
    // 무음 여부를 여기서 판별한다. 소리가 실제로 들어오는지 아닌지가 갈리는 지점.
    this._log(
      `청크 ${audio.length}샘플, RMS ${rms.toFixed(5)}${rms < 1e-4 ? ' — 무음! 영상 오디오가 안 들어오고 있다' : ''}`
    );
    this.worker.postMessage({ type: 'TRANSCRIBE', audio, id: t });
  }

  // 캡처 중단은 content script 쪽 포트가 끊기면서 일어난다. 여기선 정리할 자원이 없다.
  stopCapture() {}
}
