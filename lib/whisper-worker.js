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
let currentModelName = null;

async function initTranscriber(modelName = 'Xenova/whisper-tiny', progressCallback) {
  if (transcriber && currentModelName === modelName) return transcriber;
  currentModelName = modelName;
  transcriber = await pipeline('automatic-speech-recognition', modelName, {
    progress_callback: progressCallback,
  });
  return transcriber;
}

self.onmessage = async (e) => {
  const { type, audio, id, language, model: requestedModel } = e.data;

  const targetModel = (requestedModel === 'base' || requestedModel === 'Xenova/whisper-base')
    ? 'Xenova/whisper-base'
    : 'Xenova/whisper-tiny';

  if (type === 'INIT') {
    try {
      await initTranscriber(targetModel, data => {
        self.postMessage({ type: 'PROGRESS', data });
      });
      self.postMessage({ type: 'READY' });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  } else if (type === 'TRANSCRIBE') {
    try {
      const model = await initTranscriber(targetModel);
      // Whisper expects Float32Array at 16kHz
      // language를 넘기지 않으면 Whisper가 청크마다 스스로 언어를 판별한다.
      // 강의 언어를 아는 경우엔 지정하는 쪽이 정확하다 — 짧은 무음/잡음 구간에서
      // 자동 판별이 엉뚱한 언어로 튀는 걸 막는다.
      const output = await model(audio, {
        ...(language && language !== 'auto' ? { language } : {}),
        task: 'transcribe',
      });
      self.postMessage({ type: 'TRANSCRIBED', id, text: output.text });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
};
