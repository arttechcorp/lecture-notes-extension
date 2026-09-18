const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('ASR worker bounds PCM, rejects unselected models, acknowledges jobs and releases buffers', async () => {
  const replies = [], models = []; let inferOptions;
  let release, disposed = 0;
  const context = vm.createContext({
    Float32Array, URL,
    env: { backends: { onnx: { wasm: {} } } },
    self: { postMessage: message => replies.push(message) },
    pipeline: async (_task, model) => {
      models.push(model);
      const infer = (_audio, options) => { inferOptions = options; return new Promise(resolve => { release = () => resolve({ text: '합성 음성 결과' }); }); };
      infer.dispose = async () => { disposed++; };
      return infer;
    },
  });
  const source = fs.readFileSync(require('node:path').join(__dirname, 'whisper-worker.js'), 'utf8')
    .replace(/^import .*;$/m, '').replaceAll('import.meta.url', '"https://extension.test/lib/whisper-worker.js"');
  vm.runInContext(source, context);
  const send = data => context.self.onmessage({ data });
  await send({ type: 'INIT', model: 'small' });
  assert.equal(replies.at(-1).type, 'ERROR');
  assert.equal(models.length, 0, 'unsupported model must not trigger any download');
  await send({ type: 'INIT', model: 'tiny' });
  assert.equal(replies.at(-1).type, 'READY');
  assert.equal(replies.at(-1).model, 'Xenova/whisper-tiny');
  assert.equal(replies.at(-1).device, 'wasm');
  const audio = new Float32Array([0.1, 0.2]);
  const pending = send({ type: 'TRANSCRIBE', model: 'tiny', audio, id: 42 });
  await Promise.resolve(); await Promise.resolve();
  await send({ type: 'TRANSCRIBE', model: 'tiny', audio: new Float32Array([0.1]), id: 43 });
  assert.equal(replies.at(-1).id, 43);
  assert.equal(replies.at(-1).type, 'ERROR');
  release(); await pending;
  assert.equal(replies.at(-1).id, 42);
  assert.equal(replies.at(-1).type, 'TRANSCRIBED');
  assert.ok(audio.every(n => n === 0));
  const korean = send({ type: 'TRANSCRIBE', model: 'tiny', audio: new Float32Array([0.1]), id: 45, language: 'korean' });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(inferOptions.language, 'korean'); assert.equal(inferOptions.task, 'transcribe');
  release(); await korean;
  await send({ type: 'TRANSCRIBE', model: 'tiny', audio: new Float32Array(480001), id: 44 });
  assert.equal(replies.at(-1).type, 'ERROR');
  await send({ type: 'INIT', model: 'base' });
  assert.equal(replies.at(-1).model, 'Xenova/whisper-base');
  assert.equal(disposed, 1);
  assert.deepEqual(models, ['Xenova/whisper-tiny', 'Xenova/whisper-base']);
});
