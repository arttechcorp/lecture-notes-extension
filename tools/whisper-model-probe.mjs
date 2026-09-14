import { pipeline, env } from "../lib/vendor/transformers4/transformers.min.js";

const runtime = new URL("../lib/vendor/transformers4/", import.meta.url);
env.allowLocalModels = false; env.useBrowserCache = true; env.useWasmCache = true;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("ort-wasm-simd-threaded.asyncify.mjs", runtime).href,
  wasm: new URL("ort-wasm-simd-threaded.asyncify.wasm", runtime).href,
};
const status = document.getElementById("result"), started = performance.now();
try {
  const model = await pipeline("automatic-speech-recognition", "onnx-community/whisper-small", {
    device: "webgpu", revision: "36050c4",
    dtype: { encoder_model: "q8", decoder_model_merged: "q4" },
    progress_callback: progress => {
      const detail = { status: progress.status, file: progress.file, progress: progress.progress };
      globalThis.probeProgress = detail; status.textContent = JSON.stringify(detail, null, 2);
    },
  });
  const loadedMs = performance.now() - started, inferenceStarted = performance.now();
  const output = await model(new Float32Array(16000), { language: "korean", task: "transcribe" });
  const result = { ok: true, loadedMs, inferenceMs: performance.now() - inferenceStarted, text: output.text };
  globalThis.probeResult = result; status.textContent = JSON.stringify(result, null, 2); await model.dispose?.();
} catch (error) {
  globalThis.probeResult = { ok: false, error: error.stack || error.message, progress: globalThis.probeProgress || null };
  status.textContent = JSON.stringify(globalThis.probeResult, null, 2);
}
