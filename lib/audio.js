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

    this.worker.onmessage = (e) => {
      const { type, text, id, error, data } = e.data;
      if (type === 'TRANSCRIBED' && text.trim()) {
        const item = { time: this._formatTime(id), text: text.trim() };
        this.transcripts.push(item);
        if (this.onTranscript) this.onTranscript(item);
      } else if (type === 'ERROR') {
        console.error("Whisper Error:", error);
      }
    };
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  async initModel(onProgress) {
    return new Promise((resolve, reject) => {
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

    let startTime = Date.now();
    
    this.processor.port.onmessage = (e) => {
      // 10초 분량 등 특정 길이의 Float32Array를 받음
      const audioData = e.data.audio;
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      this.worker.postMessage({ type: 'TRANSCRIBE', audio: audioData, id: elapsedSeconds });
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
