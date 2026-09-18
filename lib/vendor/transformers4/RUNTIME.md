# Whisper WebGPU runtime

- `@huggingface/transformers` 4.2.0, Apache-2.0
- Matching `onnxruntime-web` dependency: `1.26.0-dev.20260416-b7804b056c`, MIT
- WebGPU uses the matching asyncify WASM pair selected by ONNX Runtime Web 1.26. Unused JSEP and regular WASM variants are not bundled.
- WASM factory caching is disabled in the extension worker because Transformers.js otherwise converts the local module to a `blob:` URL, which Manifest V3 extension CSP cannot import. Model-weight browser caching remains enabled.
- Primary model is pinned in `lib/whisper-webgpu-worker.js` to `onnx-community/whisper-small@36050c4`, q8 encoder and q8 merged decoder.

Model weights remain a static browser-cache download. Audio is never sent with those requests or to any external inference endpoint.
