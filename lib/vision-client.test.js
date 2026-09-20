const test = require('node:test');
const assert = require('node:assert/strict');

global.ServiceClient = { vision: async () => ({ text: '' }) };
const { createVisionEngine } = require('./vision-client.js');

const blob = bytes => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer, type: 'image/jpeg' });
const engineFor = extra => createVisionEngine({ baseUrl: 'https://service.example', token: 'x'.repeat(40), model: 'google/gemini-2.5-flash-lite', ...extra });

test('engine sends a jpeg data url and returns the slide text', async () => {
  const calls = [];
  global.ServiceClient = { vision: async options => { calls.push(options); return { text: '## 전압 분배\n\n$V_1 = V\\frac{R_1}{R_1+R_2}$' }; } };
  const result = await engineFor().recognize(blob([255, 216, 255, 224]));
  assert.match(result.data.text, /전압 분배/);
  assert.equal(result.data.confidence, null, '비전은 줄 단위 신뢰도를 주지 않는다 — 낮은 값을 지어내면 근거가 uncertain 으로 밀린다');
  assert.match(calls[0].image, /^data:image\/jpeg;base64,/);
  assert.match(calls[0].requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, '서버의 safePart 를 통과해야 한다');
});

test('each call uses a fresh request id so the server never 409s on the next slide', async () => {
  const ids = [];
  global.ServiceClient = { vision: async options => { ids.push(options.requestId); return { text: 'a' }; } };
  const engine = engineFor();
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  assert.notEqual(ids[0], ids[1]);
});

test('an empty slide is not an error', async () => {
  global.ServiceClient = { vision: async () => ({ text: '   ' }) };
  assert.equal((await engineFor().recognize(blob([1]))).data.text, '');
});

test('the session call ceiling stops spending instead of running forever', async () => {
  let calls = 0;
  global.ServiceClient = { vision: async () => { calls++; return { text: 'a' }; } };
  const engine = engineFor({ maxCalls: 2 });
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  await assert.rejects(() => engine.recognize(blob([3])), /한도/);
  assert.equal(calls, 2);
});
