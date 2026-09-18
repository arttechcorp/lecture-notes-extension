// Diagnostic reproduction in an isolated real Chrome profile; synthetic pixels only.
// Requires PLAYWRIGHT_MODULE and CHROME_PATH. It intentionally expects the reported
// summary failure only with --expect-bugs; default mode verifies the fixes.
// --reload is a diagnostic only: this Chrome closes the context during runtime.reload.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const expectBugs = process.argv.includes('--expect-bugs');
const lifecycle = process.argv.includes('--lifecycle');
const reload = process.argv.includes('--reload');
const learnUsLayout = process.argv.includes('--learnus-layout');
const server = http.createServer((_req, res) => {
  const width=learnUsLayout?960:800,height=learnUsLayout?720:450,half=width/2;
  const videoStyle=learnUsLayout?'left:0;top:50px;width:1250px;height:458px':'left:10vw;top:10vh;width:80vw;height:80vh';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Summrizei reported-error fixture</title>
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#777}video{position:absolute;${videoStyle};object-fit:contain;object-position:50% 50%;background:#222}</style>
    <video autoplay muted playsinline></video><script>
      const canvas=document.createElement('canvas');canvas.width=${width};canvas.height=${height};
      const ctx=canvas.getContext('2d');
      function draw(){
        ctx.fillStyle='white';ctx.fillRect(0,0,${half},${height});ctx.fillStyle='#ddd';ctx.fillRect(${half},0,${half},${height});
        ctx.fillStyle='black';ctx.font='bold 50px Arial';ctx.fillText('INSIDE 123456',25,180);ctx.font='bold 40px Arial';ctx.fillText('987654',${width}*.52,300);
      }
      draw();setInterval(draw,200);document.querySelector('video').srcObject=canvas.captureStream(5);
    </script>`);
});

const safeUrl = value => {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
};
const dragLeftRegion = async panel => {
  const image = await panel.locator('#cropImg').boundingBox();
  assert.ok(image && image.width > 20 && image.height > 20, JSON.stringify(image));
  await panel.mouse.move(image.x + 2, image.y + 2);
  await panel.mouse.down();
  await panel.mouse.move(image.x + image.width * .49, image.y + image.height - 2, { steps: 10 });
  await panel.mouse.up();
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROME_PATH,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
  });
  const consoleEvents = [], network = [];
  context.on('page', page => {
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) consoleEvents.push({ source: safeUrl(page.url()), level: message.type(), text: message.text() });
    });
    page.on('pageerror', error => consoleEvents.push({ source: safeUrl(page.url()), level: 'pageerror', text: error.message }));
  });
  context.on('request', request => network.push({ event: 'request', method: request.method(), url: safeUrl(request.url()) }));
  context.on('response', response => network.push({ event: 'response', status: response.status(), url: safeUrl(response.url()) }));
  const deadline = setTimeout(() => { console.error('Reported-error smoke timed out'); process.exitCode = 1; context.close(); }, 120000);
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const workerVersions = [];
    const targetLabels = new Map(), targetReplies = new Map();let targetCommandId = 0;
    cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) => {
      const payload = JSON.parse(message), pending = targetReplies.get(`${sessionId}:${payload.id}`);
      if (pending) { targetReplies.delete(`${sessionId}:${payload.id}`); pending(payload); return; }
      if (payload.method === 'Runtime.exceptionThrown') consoleEvents.push({ source: targetLabels.get(sessionId), level: 'exception', text: payload.params.exceptionDetails.text });
      if (payload.method === 'Log.entryAdded' && ['warning', 'error'].includes(payload.params.entry.level)) consoleEvents.push({ source: targetLabels.get(sessionId), level: payload.params.entry.level, text: payload.params.entry.text });
      if (payload.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(payload.params.type)) consoleEvents.push({ source: targetLabels.get(sessionId), level: payload.params.type, text: payload.params.args.map(arg => arg.value || arg.description || '').join(' ') });
    });
    const targetCommand = (sessionId, method, params = {}) => new Promise(async (resolve, reject) => {
      const id = ++targetCommandId;targetReplies.set(`${sessionId}:${id}`, payload => payload.error ? reject(new Error(payload.error.message)) : resolve(payload));
      try { await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }); } catch (error) { targetReplies.delete(`${sessionId}:${id}`);reject(error); }
    });
    const attachDiagnostics = async (targetId, label) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });targetLabels.set(sessionId, label);
      await targetCommand(sessionId, 'Runtime.enable');await targetCommand(sessionId, 'Log.enable').catch(() => {});return sessionId;
    };
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    let worker = context.serviceWorkers().find(item => item.url().startsWith(`chrome-extension://${id}/`))
      || await context.waitForEvent('serviceworker', { timeout: 15000 });
    if (reload) {
      const oldWorker = worker;
      try { await oldWorker.evaluate(() => chrome.runtime.reload()); }
      catch (error) { if (!/closed|destroyed|Target page/i.test(error.message)) throw error; }
      worker = context.serviceWorkers().find(item => item !== oldWorker && item.url().startsWith(`chrome-extension://${id}/`));
      if (!worker) {
        const reloadedWorker = context.waitForEvent('serviceworker', { predicate: item => item !== oldWorker && item.url().startsWith(`chrome-extension://${id}/`), timeout: 15000 });
        const wake = await context.newPage();await wake.goto(`chrome-extension://${id}/sidepanel.html`);
        worker = await reloadedWorker;await wake.close();
      }
      console.log('DIAGNOSTIC extension reload created a fresh service worker');
    }
    if (lifecycle) {
      const reloadedTargets = await cdp.send('Target.getTargets');
      const workerTarget = reloadedTargets.targetInfos.find(target => target.type === 'service_worker' && target.url === worker.url());
      if (workerTarget) await attachDiagnostics(workerTarget.targetId, 'service-worker-cdp');
    }
    worker.on('console', message => {
      if (['warning', 'error'].includes(message.type())) consoleEvents.push({ source: 'service-worker', level: message.type(), text: message.text() });
    });
    worker.on('close', () => consoleEvents.push({ source: 'service-worker', level: 'state', text: 'closed' }));

    const lecture = await context.newPage();
    if (learnUsLayout) await lecture.setViewportSize({ width: 1250, height: 552 });
    await lecture.goto(`http://127.0.0.1:${server.address().port}/`);
    await lecture.waitForFunction(() => document.querySelector('video').videoWidth > 0);
    const [{ id: tabId }] = await worker.evaluate(() => chrome.tabs.query({ url: 'http://127.0.0.1/*' }));
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const lectureTarget = targetInfos.find(target => target.url === lecture.url());
    assert.ok(lectureTarget, JSON.stringify(targetInfos));
    await worker.evaluate(() => chrome.storage.local.set({ consentAccepted: true, ocrEnabled: true, whisperEnabled: false }));
    await worker.evaluate(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }));
    await lecture.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: lectureTarget.targetId });

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 480, height: 1000 });
    await panel.goto(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
    const panelCdp = await context.newCDPSession(panel);
    if (lifecycle) { panelCdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => workerVersions.push(...versions));await panelCdp.send('ServiceWorker.enable'); }
    await panel.waitForFunction(() => document.getElementById('startBtn')?.disabled === false);
    await panel.click('#startBtn');
    await panel.waitForFunction(() => document.getElementById('readyAlert').textContent.includes('영역을 드래그'));
    assert.equal(await panel.locator('#previewBtn').evaluate(button => button === document.activeElement), true);
    const beforeRegion = await worker.evaluate(() => chrome.runtime.sendMessage({ target: 'session', type: 'GET_STATE' }));
    assert.equal(beforeRegion.state, null);
    await panel.click('#previewBtn');
    await panel.waitForFunction(() => document.getElementById('cropImg')?.naturalWidth > 0);
    await panel.locator('#cropImg').scrollIntoViewIfNeeded();
    const image = await panel.locator('#cropImg').boundingBox();
    assert.ok(image && image.width > 20 && image.height > 20, JSON.stringify(image));
    await dragLeftRegion(panel);
    assert.match(await panel.locator('#cropHint').textContent(), /영역 지정됨/);

    await panel.click('#startBtn');
    await panel.waitForFunction(() => !document.getElementById('stageLive').hidden, null, { timeout: 15000 });
    await panel.waitForFunction(() => Number(document.getElementById('cntSlides').textContent) > 0, null, { timeout: 60000 });
    await panel.click('#stopBtn');
    await panel.waitForFunction(() => !document.getElementById('stageDone').hidden, null, { timeout: 15000 });
    const state = await worker.evaluate(() => chrome.runtime.sendMessage({ target: 'session', type: 'GET_STATE' }));
    const recognized = (state.state?.recent || []).filter(item => item.source === 'ocr').map(item => item.text).join('\n');
    assert.match(recognized, /123456/, recognized);
    assert.doesNotMatch(recognized, /987654/, recognized);
    console.log(`PASS ${learnUsLayout?'LearnUs-like letterboxed ':' '}region UI drag includes 123456 and excludes 987654`);

    const beforeRestart = { sessionId: state.state.sessionId, counts: state.state.counts };
    let runningAgain;
    if (lifecycle) {
      const runningVersion = workerVersions.findLast(version => version.scriptURL === worker.url() && version.runningStatus === 'running');
      assert.ok(runningVersion?.versionId, JSON.stringify(workerVersions.map(version => ({ scriptURL: safeUrl(version.scriptURL), runningStatus: version.runningStatus }))));
      runningAgain = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('service worker did not restart')), 15000);
        const observe = ({ versions }) => { if (versions.some(version => version.scriptURL === worker.url() && version.runningStatus === 'running')) { clearTimeout(timeout);panelCdp.off('ServiceWorker.workerVersionUpdated', observe);resolve(); } };
        panelCdp.on('ServiceWorker.workerVersionUpdated', observe);
      });
      await panelCdp.send('ServiceWorker.stopWorker', { versionId: runningVersion.versionId });
    }
    await panel.click('#notesBtn');
    if (runningAgain) {
      await runningAgain;
      const restartedTargets = await cdp.send('Target.getTargets');
      const restartedTarget = restartedTargets.targetInfos.find(target => target.type === 'service_worker' && target.url === `chrome-extension://${id}/background.js`);
      if (restartedTarget) await attachDiagnostics(restartedTarget.targetId, 'restarted-service-worker-cdp');
    }
    if (expectBugs) {
      await panel.waitForFunction(() => document.getElementById('doneAlert').textContent.length > 0, null, { timeout: 15000 });
      const summaryError = await panel.locator('#doneAlert').textContent();
      assert.match(summaryError, /Cannot read properties of undefined \(reading 'local'\)/);
      console.log(`REPRO summary error: ${summaryError}`);
    } else {
      await panel.waitForFunction(() => document.getElementById('result').value.length > 0, null, { timeout: 15000 });
      assert.equal(await panel.locator('#doneAlert').textContent(), '');
      const summaryState = await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }));
      assert.equal(summaryState.state?.summary?.status, 'recognition-only');
      assert.equal(summaryState.state?.sessionId, beforeRestart.sessionId);
      assert.deepEqual(summaryState.state?.counts, beforeRestart.counts);
      console.log('PASS runtime-only offscreen summarizes from the panel settings payload');
      if (lifecycle) console.log('PASS service worker restart preserves the offscreen session, counts and summary route');
    }

    await panel.click('#againBtn');
    await panel.waitForFunction(() => !document.getElementById('stageReady').hidden);
    await lecture.locator('video').evaluate(video => Object.assign(video.style, { left: '-200px', top: '0', width: '800px', height: '450px' }));
    if (await panel.locator('#settingsDrawer').getAttribute('hidden') !== null) await panel.click('#settingsToggle');
    await panel.click('#previewBtn');
    await panel.waitForFunction(() => document.getElementById('cropImg')?.naturalWidth > 0);
    await panel.locator('#cropImg').scrollIntoViewIfNeeded();
    const clippedImage = await panel.locator('#cropImg').boundingBox();
    assert.ok(clippedImage && clippedImage.width > 20 && clippedImage.height > 20, JSON.stringify(clippedImage));
    await dragLeftRegion(panel);
    await panel.click('#startBtn');
    if (expectBugs) {
      await panel.waitForFunction(() => !document.getElementById('stageLive').hidden, null, { timeout: 15000 });
      await panel.waitForFunction(() => Number(document.getElementById('cntSlides').textContent) > 0, null, { timeout: 60000 });
      await panel.click('#stopBtn');
      await panel.waitForFunction(() => !document.getElementById('stageDone').hidden, null, { timeout: 15000 });
      const clippedState = await panel.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }));
      const clippedText = (clippedState.state?.recent || []).filter(item => item.source === 'ocr').map(item => item.text).join('\n');
      assert.match(clippedText, /987654/, clippedText);
      console.log('REPRO partially clipped video remaps the left ROI onto OUTSIDE 987654');
    } else {
      await panel.waitForFunction(() => document.getElementById('doneAlert').textContent.length > 0, null, { timeout: 15000 });
      assert.match(await panel.locator('#doneAlert').textContent(), /영상 전체가 보이도록/);
      console.log('PASS partially clipped video is rejected before OCR');
    }

    const after = await cdp.send('Target.getTargets');
    if (lifecycle) {
      const offscreenTarget = after.targetInfos.find(target => target.url === `chrome-extension://${id}/offscreen.html`);
      assert.ok(offscreenTarget, JSON.stringify(after.targetInfos.filter(target => target.url.startsWith(`chrome-extension://${id}/`))));
      const offscreenCdp = await attachDiagnostics(offscreenTarget.targetId, 'offscreen-cdp');
      const surface = await targetCommand(offscreenCdp, 'Runtime.evaluate', { expression: 'typeof chrome.storage', returnByValue: true });
      assert.equal(surface.result.result.value, 'undefined');
      console.log('OFFSCREEN_API', JSON.stringify({ chromeStorage: surface.result.result.value }));
    }
    console.log('TARGETS', JSON.stringify(after.targetInfos.filter(target => target.url.startsWith(`chrome-extension://${id}/`)).map(target => ({ type: target.type, url: safeUrl(target.url), attached: target.attached }))));
    assert.doesNotMatch(JSON.stringify(consoleEvents), /Refused to execute inline script/);
    console.log('CONSOLE', JSON.stringify(consoleEvents));
    console.log('NETWORK', JSON.stringify(network));
  } finally {
    clearTimeout(deadline);
    await context.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
