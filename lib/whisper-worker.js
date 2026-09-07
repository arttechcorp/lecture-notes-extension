// MV3는 원격 스크립트를 금지한다(script-src 'self'). transformers.js와 onnxruntime의
// wasm은 lib/vendor/ 에 동봉되어 있고, 모델 가중치만 런타임에 huggingface에서 받는다.
import { pipeline, env } from './vendor/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
// 기본값은 jsdelivr CDN을 가리킨다 — CSP에 막히므로 동봉본으로 돌린다.
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;
// 스레드 빌드는 COOP/COEP가 필요한데 확장 페이지엔 없다. 동봉도 하지 않았다.
env.backends.onnx.wasm.numThreads = 1;
// MV3를 돌리는 크롬은 전부 wasm SIMD를 지원한다. 비-SIMD 폴백은 닿을 일이 없어 동봉하지 않았다.
env.backends.onnx.wasm.simd = true;

let transcriber = null;

async function initTranscriber(progressCallback) {
  if (transcriber) return transcriber;
  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    progress_callback: progressCallback,
  });
  return transcriber;
}

self.onmessage = async (e) => {
  const { type, audio, id } = e.data;

  if (type === 'INIT') {
    try {
      await initTranscriber(data => {
        self.postMessage({ type: 'PROGRESS', data });
      });
      self.postMessage({ type: 'READY' });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  } else if (type === 'TRANSCRIBE') {
    try {
      const model = await initTranscriber();
      // Whisper expects Float32Array at 16kHz
      const output = await model(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'korean',
        task: 'transcribe',
      });
      self.postMessage({ type: 'TRANSCRIBED', id, text: output.text });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
};
