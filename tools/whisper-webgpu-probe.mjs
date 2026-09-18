import { env } from "../lib/vendor/transformers4/transformers.min.js";

try {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const device = await adapter.requestDevice();
  const info = adapter.info || {};
  const result = { ok: true, transformers: "4.2.0", webgpu: true, architecture: info.architecture || null,
    vendor: info.vendor || null, maxBufferSize: device.limits.maxBufferSize, wasmBackend: !!env.backends.onnx.wasm };
  device.destroy(); globalThis.probeResult = result;
  document.getElementById("result").textContent = JSON.stringify(result, null, 2);
} catch (error) {
  globalThis.probeResult = { ok: false, error: error.message };
  document.getElementById("result").textContent = JSON.stringify(globalThis.probeResult, null, 2);
}
