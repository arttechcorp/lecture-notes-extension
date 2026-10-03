const test = require('node:test');
const assert = require('node:assert/strict');

// 실제 슬라이드 모양의 fixture — Contracts.SCHEMAS.slideDoc 을 통과해야 클라이언트 재검증이 풀린다.
const fixture = () => ({
  schemaVersion: 1, slideId: 's1', t0: 0, t1: 61.4, engine: 'vision-cloud', model: 'google/gemini-2.5-flash-lite',
  blocks: [
    { id: 'b1', text: ' 4. 전압 분배 회로 ', role: 'title', bbox: { x: 0.05, y: 0.03, w: 0.6, h: 0.08 }, conf: 0.99 },
    { id: 'b2', text: '직렬 회로에서 각 저항의 전압 강하는 저항값에 비례한다.', role: 'body', bbox: null, conf: 0.9 },
    { id: 'b3', text: '전기회로이론 · 12주차', role: 'header', bbox: null, conf: null },
    { id: 'b4', text: '20231234 홍길동', role: 'watermark', bbox: null, conf: null },
    { id: 'b5', text: '무단 배포 금지', role: 'footer', bbox: null, conf: null },
    { id: 'b6', text: '- 37 -', role: 'page_number', bbox: null, conf: null },
    { id: 'b7', text: '그림 1. 분압 회로', role: 'figure_label', bbox: null, conf: null },
  ],
  formulas: [
    { id: 'f1', latex: 'V_1 = V\\frac{R_1}{R_1+R_2}', text: null, bbox: null, conf: 0.97, status: 'verified' },
    { id: 'f2', latex: null, text: 'P = I^2 R', bbox: null, conf: null, status: 'unverified' },
  ],
  figures: [
    { id: 'g1', bbox: { x: 0.05, y: 0.55, w: 0.4, h: 0.3 }, kind: 'table', title: '표 1. 저항별 전압 강하', cells: [['저항', '전압 강하'], ['R1 = 2Ω', '4 V'], ['R2 = 4Ω', '8 V']], chartSummary: null, chartData: null, conf: 0.92 },
    { id: 'g2', bbox: { x: 0.55, y: 0.55, w: 0.4, h: 0.3 }, kind: 'chart', title: null, cells: null, chartSummary: '전류가 저항 합계에 반비례해 감소하는 꺾은선 그래프', chartData: null, conf: null },
    { id: 'g3', bbox: { x: 0.9, y: 0.92, w: 0.06, h: 0.05 }, kind: 'decorative', title: '로고', cells: null, chartSummary: null, chartData: null, conf: null },
  ],
});
const expectedText = [
  '4. 전압 분배 회로',
  '직렬 회로에서 각 저항의 전압 강하는 저항값에 비례한다.',
  '전기회로이론 · 12주차',
  '그림 1. 분압 회로',
  '$$V_1 = V\\frac{R_1}{R_1+R_2}$$',
  'P = I^2 R',
  '표 1. 저항별 전압 강하',
  '| 저항 | 전압 강하 |',
  '| --- | --- |',
  '| R1 = 2Ω | 4 V |',
  '| R2 = 4Ω | 8 V |',
  '전류가 저항 합계에 반비례해 감소하는 꺾은선 그래프',
].join('\n');

global.ServiceClient = { vision: async () => ({ slideDoc: fixture(), usage: {} }) };
const { createVisionEngine, slideDocText } = require('./vision-client.js');

const blob = bytes => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer, type: 'image/jpeg' });
const engineFor = extra => createVisionEngine({ baseUrl: 'https://service.example', token: 'x'.repeat(40), model: 'google/gemini-2.5-flash-lite', ...extra });

test('engine sends a jpeg data url and returns the flattened slide text', async () => {
  const calls = [];
  global.ServiceClient = { vision: async options => { calls.push(options); return { slideDoc: fixture(), usage: {} }; } };
  const result = await engineFor().recognize(blob([255, 216, 255, 224]));
  assert.equal(result.data.text, expectedText);
  assert.equal(result.data.confidence, null, '비전은 줄 단위 신뢰도를 주지 않는다 — 낮은 값을 지어내면 근거가 uncertain 으로 밀린다');
  assert.deepEqual(result.data.slideDoc, fixture());
  assert.match(calls[0].image, /^data:image\/jpeg;base64,/);
  assert.match(calls[0].requestId, /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, '서버의 safePart 를 통과해야 한다');
  assert.equal(calls[0].slideId, 's1');
  assert.equal(calls[0].t0, 0);
  assert.equal(calls[0].t1, 0);
  assert.equal(calls[0].mode, 'full');
});

test('slide meta is forwarded to the service untouched', async () => {
  const calls = [];
  global.ServiceClient = { vision: async options => { calls.push(options); return { slideDoc: fixture() }; } };
  await engineFor().recognize(blob([1]), { slideId: 's-9', t0: 10, t1: 20.5, mode: 'reread' });
  assert.equal(calls[0].slideId, 's-9');
  assert.equal(calls[0].t0, 10);
  assert.equal(calls[0].t1, 20.5);
  assert.equal(calls[0].mode, 'reread');
});

test('each call uses a fresh request id so the server never 409s on the next slide', async () => {
  const ids = [];
  global.ServiceClient = { vision: async options => { ids.push(options.requestId); return { slideDoc: fixture() }; } };
  const engine = engineFor();
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  assert.notEqual(ids[0], ids[1]);
});

test('an empty slide is not an error', async () => {
  global.ServiceClient = { vision: async () => ({ slideDoc: { ...fixture(), blocks: [], formulas: [], figures: [] } }) };
  assert.equal((await engineFor().recognize(blob([1]))).data.text, '');
});

test('table cells escape pipes and newlines, and ragged rows are padded', () => {
  const doc = { blocks: [], formulas: [], figures: [
    { kind: 'table', title: null, cells: [['a|b', 'c\nd', 'e'], ['1']], chartSummary: null },
  ] };
  assert.equal(slideDocText(doc), '| a\\|b | c d | e |\n| --- | --- | --- |\n| 1 |  |  |');
});

test('the session call ceiling stops spending instead of running forever', async () => {
  let calls = 0;
  global.ServiceClient = { vision: async () => { calls++; return { slideDoc: fixture() }; } };
  const engine = engineFor({ maxCalls: 2 });
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  await assert.rejects(() => engine.recognize(blob([3])), /한도/);
  assert.equal(calls, 2);
});

test('a slideDoc that violates the contract is rejected before use', async () => {
  const bad = fixture();
  bad.blocks[0].role = 'noise';
  global.ServiceClient = { vision: async () => ({ slideDoc: bad }) };
  await assert.rejects(() => engineFor().recognize(blob([1])), /형식이 올바르지 않습니다/);
});

test('a response without slideDoc means the service is too old', async () => {
  global.ServiceClient = { vision: async () => ({ text: '4. 전압 분배 회로' }) };
  await assert.rejects(() => engineFor().recognize(blob([1])), /슬라이드 인식 결과가 없습니다/);
});

test('a string token is sent as is, a getter is asked before every call', async () => {
  const tokens = [];
  global.ServiceClient = { vision: async options => { tokens.push(options.token); return { slideDoc: fixture() }; } };
  await engineFor({ token: 'a'.repeat(40) }).recognize(blob([1]));
  assert.deepEqual(tokens, ['a'.repeat(40)], '문자열 토큰은 예전 그대로');

  tokens.length = 0;
  let issued = 0;
  const engine = engineFor({ token: async () => 'login-jwt-' + ++issued });
  await engine.recognize(blob([1]));
  await engine.recognize(blob([2]));
  await engine.recognize(blob([3]));
  assert.deepEqual(tokens, ['login-jwt-1', 'login-jwt-2', 'login-jwt-3'], '1시간짜리 토큰을 세션 내내 쥐고 있지 않는다');

  tokens.length = 0;
  await engineFor({ token: () => 'sync-getter' }).recognize(blob([1]));
  assert.deepEqual(tokens, ['sync-getter'], '동기 함수도 된다');
});

test('a failing token getter stops the call before anything is sent', async () => {
  let sent = 0;
  global.ServiceClient = { vision: async () => { sent++; return { slideDoc: fixture() }; } };
  const engine = engineFor({ token: async () => { throw new Error('로그인이 만료되었거나 취소되었습니다. 설정에서 Google로 다시 로그인하세요.'); } });
  await assert.rejects(() => engine.recognize(blob([1])), /다시 로그인/);
  assert.equal(sent, 0, '정적 토큰이나 옛 토큰으로 몰래 보내지 않는다');
});
