const { test } = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");

test("Whisper small worker pins the measured WebGPU dtypes and bounds PCM", async () => {
  const replies = [], calls = [], inference = [], decodes = [];
  let generated = [50258, 1, 2];
  // 파이프라인을 호출 가능한 함수로도 둬서, 예전처럼 _decode_asr 경로를 타면 드러나게 한다.
  const infer = async () => { throw new Error("파이프라인 자체 디코딩(_decode_asr)을 다시 타고 있다"); };
  infer.dispose = async () => {};
  infer.processor = async audio => ({ input_features: { audio } });
  infer.model = { generate: async options => { inference.push(options); return [{ tolist: () => generated }]; } };
  infer.tokenizer = { decode: (ids, options) => {
    // 빈 배열을 넘기면 transformers.js 가 던지는 바로 그 오류. 우리가 그 경로를 안 타는지 본다.
    if (!Array.isArray(ids) || ids.length === 0) throw new Error("token_ids must be a non-empty array of integers");
    decodes.push(options);
    return ids.includes(0) ? "  " : "  합성 결과  ";
  } };
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
  assert.equal(decodes.at(-1).skip_special_tokens, true, "타임스탬프/언어 토큰이 본문에 새어 들어온다");
  assert.equal(replies.at(-1).type, "TRANSCRIBED"); assert.equal(replies.at(-1).text, "합성 결과");

  // 무음 청크: 모델이 특수 토큰만 뱉어도 29초짜리 청크를 통째로 버리면 안 된다.
  generated = [50258, 0];
  await context.self.onmessage({ data: { type: "TRANSCRIBE", audio: new Float32Array([0]), id: 3 } });
  assert.equal(replies.at(-1).type, "TRANSCRIBED", "무음 청크가 오류로 버려진다");
  assert.equal(replies.at(-1).text, "");
  await context.self.onmessage({ data: { type: "TRANSCRIBE", audio: new Float32Array(480001), id: 1 } });
  assert.equal(replies.at(-1).type, "ERROR");
});
