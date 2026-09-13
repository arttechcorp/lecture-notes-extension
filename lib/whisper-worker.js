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
let busy = false;
const MODELS = { tiny: 'Xenova/whisper-tiny', base: 'Xenova/whisper-base' };

async function initTranscriber(modelName = 'Xenova/whisper-tiny', progressCallback) {
  if (transcriber && currentModelName === modelName) return transcriber;
  await transcriber?.dispose?.();
  transcriber = null;
  transcriber = await pipeline('automatic-speech-recognition', modelName, {
    progress_callback: progressCallback,
  });
  currentModelName = modelName;
  return transcriber;
}

self.onmessage = async (e) => {
  const { type, audio, id, language, model: requestedModel = 'tiny' } = e.data || {};
  if (!['INIT', 'TRANSCRIBE'].includes(type)) return;
  if (busy) {
    audio?.fill?.(0);
    self.postMessage({ type: 'ERROR', id, error: '음성 작업이 이미 진행 중입니다.' });
    return;
  }
  busy = true;
  try {
    const targetModel = Object.hasOwn(MODELS, requestedModel) ? MODELS[requestedModel]
      : Object.values(MODELS).includes(requestedModel) ? requestedModel : null;
    if (!targetModel) throw new Error('지원하지 않는 로컬 음성 모델입니다. 모델을 명시적으로 선택하세요.');
    if (type === 'INIT') {
      await initTranscriber(targetModel, data => {
        self.postMessage({ type: 'PROGRESS', data });
      });
      self.postMessage({ type: 'READY' });
    } else {
      if (!(audio instanceof Float32Array) || !audio.length || audio.length > 16000 * 30 || !audio.every(Number.isFinite)) {
        throw new Error('16 kHz mono 음성 입력이 올바르지 않거나 30초 한도를 넘었습니다.');
      }
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
    }
  } catch (err) {
    self.postMessage({ type: 'ERROR', id, error: err.message });
  } finally {
    audio?.fill?.(0);
    busy = false;
  }
};
