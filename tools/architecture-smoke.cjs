// Synthetic-only browser verification. Requires PLAYWRIGHT_MODULE and CHROME_PATH.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1);
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !/^(lib\/|landing\/|docs\/|tools\/pricing-model\.js$|sidepanel\.|options\.|offscreen\.|sandbox\.)/.test(name) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('content-type', name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.css') ? 'text/css' : /\.m?js$/.test(name) ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
const init = () => {
  const listeners = [], stored = { consentAccepted: true, ocrEnabled: true, whisperEnabled: false, whisperModel: 'tiny', whisperLang: 'auto' };
  window.mock = { listeners, state: null, calls: [] };
  window.chrome = {
    runtime: { id: 'a'.repeat(32), getURL: p => location.origin + '/' + p, onMessage: { addListener: fn => listeners.push(fn) }, openOptionsPage: async () => { mock.openedSettings = true; }, sendMessage: (m, cb) => {
      mock.calls.push(m.type);
      if (!cb) return Promise.resolve({ ok: true });
      if (m.type === 'GENERATE_NOTES') mock.state.summary = { title: '인식 완료 · AI 요약 연결 필요', status: 'recognition-only', sections: [], reviewQuestions: [], message: '서비스 연결 후 요약할 수 있습니다.' };
      if (m.type === 'START_SESSION') return cb({ ok: false, error: '합성 시작 실패' });
      cb({ ok: true, state: structuredClone(mock.state) });
    } },
    storage: {
      local: { get: (_keys, cb) => cb ? cb(stored) : Promise.resolve(stored), set: async s => Object.assign(stored, s), remove: async () => {} },
      sync: { remove: async () => {} },
      onChanged: { addListener: () => {} }
    },
    tabs: { query: async query => query?.active
      ? [{ id: 3, url: 'https://lecture.example/watch', title: 'Synthetic lecture' }]
      : [{ id: 4, url: 'https://other.example/page', title: 'Other tab' }, { id: 3, url: 'https://lecture.example/watch', title: 'Synthetic lecture' }] }
  };
};
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : (external.push(route.request().url()), route.abort()));
    await page.addInitScript(init);
    page.on('dialog', d => d.accept());
    await page.goto(origin + '/offscreen.html');
    const capture = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      const draw = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#000'; ctx.font = 'bold 64px Arial'; ctx.fillText('SYNTHETIC TEST 123456', 60, 180); ctx.fillText('A = 42', 60, 300); };
      draw(); const painting = setInterval(draw, 200);
      const stream = canvas.captureStream(5), audio = new AudioContext(), destination = audio.createMediaStreamDestination(), osc = audio.createOscillator(), gain = audio.createGain();
      gain.gain.value = 0; osc.connect(gain); gain.connect(destination); osc.start(); stream.addTrack(destination.stream.getAudioTracks()[0]);
      const states = [];
      const s = new CaptureSession({ id: 'synthetic', generation: 1, stream, options: { ocrEnabled: true, whisperEnabled: false, metadata: { box: { x: 0, y: 0, w: 1, h: 1 }, time: 0, rate: 1, paused: false, epoch: 1, videoAspect: 1280 / 720 } }, emit: state => states.push(state.status) });
      try {
        await s.start();
        const until = Date.now() + 45000;
        while (!s.counts.visual && s.status === 'running' && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
        const first = s.stop(); await first;
        const numericPreserved = s.store.items.some(e => e.text.includes('123456'));
        const result = { status: s.status, numericPreserved, texts: s.store.items.map(e => e.text), count: s.counts.visual, bytes: s.imageBytes, tracksStopped: stream.getTracks().every(t => t.readyState === 'ended'), error: s.error || null };
        await s.dispose(); result.disposedEmpty = s.store.items.length === 0; return result;
      } finally { clearInterval(painting); osc.stop(); await audio.close(); await s.dispose(); }
    });
    assert.equal(capture.status, 'completed', JSON.stringify(capture));
    assert.equal(capture.numericPreserved, true, JSON.stringify(capture));
    assert.equal(capture.bytes, 0); assert.equal(capture.tracksStopped, true); assert.equal(capture.disposedEmpty, true);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS bundled PP-OCRv5 on synthetic MediaStream, numeric preservation, STOP drain, track cleanup, no external requests');
    const panel = await browser.newPage({ viewport: { width: 390, height: 844 } }), panelErrors = [];
    panel.on('pageerror', e => panelErrors.push(e.stack || e.message));
    await panel.route('**/*', route => route.request().url().startsWith(origin) || /^(blob:|data:)/.test(route.request().url()) ? route.continue() : route.abort());
    await panel.addInitScript(init); await panel.goto(origin + '/sidepanel.html');
    await panel.waitForFunction(() => document.getElementById('stageReady')?.hidden === false);
    assert.equal(await panel.$eval('#startBtn', button => button.disabled), false);
    assert.equal(await panel.$eval('#tabSelect', select => select.value), '3');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('readyAlert')?.textContent.includes('영역을 드래그'));
    assert.equal(await panel.evaluate(() => mock.calls.includes('START_SESSION')), false);
    assert.equal(await panel.$eval('#previewBtn', button => button === document.activeElement), true);
    await panel.selectOption('#modeSelect', 'slide');
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('readyAlert')?.textContent === '합성 시작 실패');
    assert.equal(await panel.$eval('#readyAlert', alert => alert.hidden), false);
    const rendered = await panel.evaluate(() => {
      const cited = { content: '핵심 조건', importance: 'critical', evidenceIds: ['ev-1'] };
      const summary = { title: '구조화 노트', keyConclusions: [cited], concepts: [], corrections: [], openQuestions: [], sections: [{ heading: '구간', ...cited }], formulas: [{ latex: 'V=IR', variables: 'V, I, R', units: 'V, A, Ω', conditions: '선형 저항', explanation: '옴의 법칙', importance: 'important', evidenceIds: ['ev-1'] }], visuals: [], reviewQuestions: [{ question: '조건은?', evidenceIds: ['ev-1'] }], evidenceIds: ['ev-1'], status: 'complete' };
      mock.listeners[0]({ target: 'panel', type: 'SESSION_STATE', state: { sessionId: 'panel', generation: 1, status: 'completed', counts: { visual: 1, audio: 0 }, summary, gaps: [] } }, { id: chrome.runtime.id, url: chrome.runtime.getURL('offscreen.html') });
      return document.getElementById('result').value;
    });
    assert.match(rendered, /핵심 결론/); assert.match(rendered, /V=IR/); assert.match(rendered, /복습 질문/); assert.deepEqual(panelErrors, []); await panel.close();
    console.log('PASS sidepanel reconnects ready and renders rich note fields');
    const archive = await page.evaluate(async () => {
      const saved=new Map(),settings={serviceUrl:location.origin,appSessionToken:'synthetic-token-'.padEnd(40,'x')};
      const call=message=>new Promise(resolve=>mock.listeners[0]({...message,target:'session'},{id:chrome.runtime.id,url:chrome.runtime.getURL('background.js')},resolve));
      ServiceClient.me=async()=>({accountId:'synthetic-user'});
      ServiceClient.saveEncrypted=async({objectId,envelope})=>{saved.set(objectId,envelope);return {saved:true};};
      ServiceClient.loadEncrypted=async({objectId})=>({envelope:saved.get(objectId)});
      session=new CaptureSession({id:'archive-source',generation:++generation,stream:null,options:{},emit:()=>{}});
      const item=session.store.add({source:'ocr',text:'PRIVATE_SYNTHETIC_MARKER',time:10});
      const noteItem={content:'개념의 적용 조건을 비교한 정리입니다.',importance:'important',evidenceIds:[item.id]};
      session.summary={title:'합성 노트',keyConclusions:[noteItem],concepts:[],corrections:[],openQuestions:[],sections:Array.from({length:90},(_,i)=>({heading:'구간 '+i,...noteItem})),formulas:[],visuals:[],reviewQuestions:Array.from({length:40},(_,i)=>({question:'확인 질문 '+i,evidenceIds:[item.id]})),evidenceIds:[item.id],status:'partial',preprocessing:{decisions:[{id:item.id,selection:'uncertain',selectionReason:'합성 테스트 불확실성',relatedEvidenceIds:[]}]}};
      session.counts.visual=1;session.closed=true;session.status='completed';
      const result=await call({type:'SAVE_VAULT',settings,passphrase:'synthetic-password-123'});
      if(!result.ok)throw new Error(result.error);
      const ciphertextOnly=!JSON.stringify([...saved.values()]).includes('PRIVATE_SYNTHETIC_MARKER');
      await call({type:'DISPOSE_SESSION'});
      const restored=await call({type:'LOAD_VAULT',settings,objectId:result.objectId,passphrase:'synthetic-password-123'});
      if(!restored.ok)throw new Error(restored.error);
      const wrong=await call({type:'LOAD_VAULT',settings,objectId:result.objectId,passphrase:'wrong-password-456'});
      return {ciphertextOnly,sections:restored.state.summary.sections.length,selection:restored.state.summary.evidenceRefs[0].selection,wrongPasswordRejected:!wrong.ok,existingNotePreserved:session.summary.sections.length===90};
    });
    assert.deepEqual(archive,{ciphertextOnly:true,sections:90,selection:'uncertain',wrongPasswordRejected:true,existingNotePreserved:true});
    console.log('PASS offscreen archive save/dispose/load, 90-section note restoration, wrong-password recovery, ciphertext-only payload');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
