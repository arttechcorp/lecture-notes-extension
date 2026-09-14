const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

test("Whisper small worker pins the measured WebGPU dtypes and bounds PCM", async () => {
  const replies = [], calls = [], inference = [];
  const infer = async (_audio, options) => { inference.push(options); return { text: "합성 결과" }; }; infer.dispose = async () => {};
  const context = vm.createContext({ Float32Array, URL,
    navigator: { gpu: { requestAdapter: async () => ({}) } },
    env: { backends: { onnx: { wasm: {} } } },
    pipeline: async (task, model, options) => { calls.push({ task, model, options }); return infer; },
    self: { postMessage: message => replies.push(message) },
  });
  const source = fs.readFileSync(path.join(__dirname, "whisper-webgpu-worker.js"), "utf8")
    .replace(/^import .*;$/m, "").replaceAll("import.meta.url", '"https://extension.test/lib/whisper-webgpu-worker.js"');
  vm.runInContext(source, context);
  assert.equal(context.env.useBrowserCache, true);
  assert.equal(context.env.useWasmCache, false);
  await context.self.onmessage({ data: { type: "INIT" } });
  assert.equal(replies.at(-1).type, "READY");
  assert.equal(calls[0].model, "onnx-community/whisper-small");
  assert.equal(calls[0].options.device, "webgpu");
  assert.equal(calls[0].options.dtype.encoder_model, "q8");
  assert.equal(calls[0].options.dtype.decoder_model_merged, "q4");
  assert.equal(calls[0].options.revision, "36050c4");
  await context.self.onmessage({ data: { type: "TRANSCRIBE", audio: new Float32Array([0.1]), id: 2, language: "korean" } });
  assert.equal(inference.at(-1).language, "korean"); assert.equal(inference.at(-1).task, "transcribe");
  await context.self.onmessage({ data: { type: "TRANSCRIBE", audio: new Float32Array(480001), id: 1 } });
  assert.equal(replies.at(-1).type, "ERROR");
});
