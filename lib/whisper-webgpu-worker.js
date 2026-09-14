// Transformers.js/ORT are local extension code. Only pinned static model weights are fetched.
import { pipeline, env } from "./vendor/transformers4/transformers.min.js";

const runtime = new URL("./vendor/transformers4/", import.meta.url);
env.allowLocalModels = false;
env.useBrowserCache = true;
// MV3 extension CSP rejects the blob: module URL created by this optional cache.
// The packaged WASM files are local already; model weights remain browser-cached.
env.useWasmCache = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("ort-wasm-simd-threaded.asyncify.mjs", runtime).href,
  wasm: new URL("ort-wasm-simd-threaded.asyncify.wasm", runtime).href,
};

const MODEL = "onnx-community/whisper-small";
const REVISION = "36050c4";
const DTYPE = { encoder_model: "q8", decoder_model_merged: "q4" };
let transcriber = null, busy = false;

async function init(progressCallback) {
  if (transcriber) return transcriber;
  if (!navigator.gpu || !await navigator.gpu.requestAdapter({ powerPreference: "high-performance" })) {
    throw new Error("이 기기에서는 WebGPU 음성 인식을 사용할 수 없습니다. 저사양 Base 모드를 선택하세요.");
  }
  transcriber = await pipeline("automatic-speech-recognition", MODEL, {
    device: "webgpu", dtype: DTYPE, revision: REVISION, progress_callback: progressCallback,
  });
  return transcriber;
}

self.onmessage = async ({ data = {} }) => {
  const { type, audio, id, language } = data;
  if (!["INIT", "TRANSCRIBE"].includes(type)) return;
  if (busy) { audio?.fill?.(0); self.postMessage({ type: "ERROR", id, error: "음성 작업이 이미 진행 중입니다." }); return; }
  busy = true;
  try {
    if (type === "INIT") {
      await init(progress => self.postMessage({ type: "PROGRESS", data: progress }));
      self.postMessage({ type: "READY", model: MODEL, revision: REVISION, device: "webgpu", dtype: DTYPE });
    } else {
      if (!(audio instanceof Float32Array) || !audio.length || audio.length > 16000 * 30 || !audio.every(Number.isFinite)) throw new Error("16 kHz mono 음성 입력이 올바르지 않거나 30초 한도를 넘었습니다.");
      const model = await init();
      const output = await model(audio, { ...(language && language !== "auto" ? { language } : {}), task: "transcribe" });
      self.postMessage({ type: "TRANSCRIBED", id, text: output.text });
    }
  } catch (error) {
    self.postMessage({ type: "ERROR", id, error: error.message });
  } finally { audio?.fill?.(0); busy = false; }
};
