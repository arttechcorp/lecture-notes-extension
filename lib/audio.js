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

    this.workerFailure = null;
    this.worker.onerror = (e) => {
      this.workerFailure = new Error(e.message || 'whisper worker failed to load');
      if (this._onWorkerError) this._onWorkerError(this.workerFailure);
    };

    this.worker.onmessage = (e) => {
      const { type, text, id, error, data } = e.data;
      if (type === 'TRANSCRIBED' && text.trim()) {
        const item = { time: id, text: text.trim() };
        this.transcripts.push(item);
        if (this.onTranscript) this.onTranscript(item);
      } else if (type === 'ERROR') {
        console.error("Whisper Error:", error);
      }
    };
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

  async startFromTab(tabId) {
    const { streamId, error } = await chrome.runtime.sendMessage({ type: 'GET_TAB_STREAM_ID', tabId });
    if (!streamId) throw new Error(error || '탭 오디오 스트림을 얻지 못했습니다.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    });
    await this.startCapture(stream);
  }

  async startCapture(stream) {
    this.stream = stream;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.stream);
    
    // 오디오가 스피커로 나가도록 연결
    this.mediaStreamSource.connect(this.audioContext.destination);

    // 16kHz Float32Array 추출용 프로세서
    await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('lib/audio-processor.js'));
    this.processor = new AudioWorkletNode(this.audioContext, 'audio-processor');
    
    this.mediaStreamSource.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    // 청크가 "끝난" 시점에 도착하므로, 직전 도착 때 찍어둔 값이 이 청크의 시작 시각이다.
    let chunkStart = this.getVideoTime ? this.getVideoTime() : 0;

    this.processor.port.onmessage = (e) => {
      const startedAt = chunkStart;
      chunkStart = this.getVideoTime ? this.getVideoTime() : startedAt;
      this.worker.postMessage({ type: 'TRANSCRIBE', audio: e.data.audio, id: startedAt });
    };
  }

  stopCapture() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.mediaStreamSource) {
      this.mediaStreamSource.disconnect();
      this.mediaStreamSource = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.stream = null;
  }
}
