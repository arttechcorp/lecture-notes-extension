// Real MV3 permission/capture test in an isolated Chrome profile; synthetic video only.
// Requires PLAYWRIGHT_MODULE and CHROME_PATH. Never connects to the user's browser.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><title>Synthetic capture test</title>
    <style>body{margin:0}video{display:block;width:640px;height:360px}</style>
    <video autoplay muted playsinline></video><script>
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
    const ctx=canvas.getContext('2d');
    function draw(){ctx.fillStyle='white';ctx.fillRect(0,0,640,360);ctx.fillStyle='black';ctx.font='bold 42px Arial';ctx.fillText('SYNTHETIC 123456',30,120);}
    draw();setInterval(draw,200);document.querySelector('video').srcObject=canvas.captureStream(5);
    </script>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await chromium.launchPersistentContext('', {
    executablePath: process.env.CHROME_PATH, headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required'],
  });
  const deadline = setTimeout(() => { console.error('Extension smoke timed out'); process.exitCode = 1; context.close(); }, 90000);
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    const worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`))
      || await context.waitForEvent('serviceworker', { timeout: 15000 });
    const lecture = await context.newPage();
    await lecture.goto(`http://127.0.0.1:${server.address().port}/`);
    await lecture.waitForFunction(() => document.querySelector('video').videoWidth > 0);
    const [{ id: tabId }] = await worker.evaluate(() => chrome.tabs.query({ url: 'http://127.0.0.1/*' }));
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const targetInfo = targetInfos.find(t => t.url === lecture.url());
    assert.ok(targetInfo, JSON.stringify(targetInfos));
    await worker.evaluate(() => chrome.storage.local.set({ consentAccepted: true, ocrEnabled: true, whisperEnabled: false }));
    const permission = () => worker.evaluate(async tabId => {
      try { await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }); return { ok: true }; }
      catch (error) { return { ok: false, error: error.message }; }
    }, tabId);
    const before = await permission();
    assert.equal(before.ok, false, 'No invocation must not grant capture permission');
    assert.match(before.error, /Extension has not been invoked/);
    console.log('PASS real Chrome rejects a tab before extension invocation');
    // Reproduce the previous auto-open regression using Chrome's actual action route.
    await worker.evaluate(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
    await lecture.bringToFront();
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
    const oldRoute = await permission();
    assert.equal(oldRoute.ok, false);
    assert.match(oldRoute.error, /Extension has not been invoked/);
    console.log('PASS reproduced old auto-open permission failure after an actual action invocation');
    await worker.evaluate(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }));
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfo.targetId });
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
    await panel.waitForFunction(() => document.getElementById('startBtn')?.disabled === false);
    async function captureAndStop(view) {
      assert.equal(await view.locator('#tabSelect').inputValue(), String(tabId), 'Opening a control window must preserve the invoked lecture tab');
      await view.selectOption('#modeSelect', 'slide');
      await view.click('#startBtn');
      await view.waitForFunction(() => !document.getElementById('readyAlert').hidden || !document.getElementById('stageLive').hidden, null, { timeout: 15000 });
      const start = await view.evaluate(() => ({ error: document.getElementById('readyAlert').textContent, live: !document.getElementById('stageLive').hidden }));
      assert.equal(start.error, '', JSON.stringify(start));
      assert.equal(start.live, true, JSON.stringify(start));
      await view.waitForFunction(() => Number(document.getElementById('cntSlides').textContent) > 0, null, { timeout: 45000 });
      await view.click('#stopBtn');
      await view.waitForFunction(() => !document.getElementById('stageDone').hidden, null, { timeout: 15000 });
      assert.equal(await view.locator('#doneAlert').textContent(), '');
    }
    await captureAndStop(panel);
    console.log('PASS real extension action -> tabCapture -> offscreen -> PP-OCRv5 -> STOP');
    assert.deepEqual(await worker.evaluate(() => chrome.tabCapture.getCapturedTabs().then(tabs => tabs.filter(t => ['active', 'pending'].includes(t.status)))), []);
    await panel.click('#againBtn');
    await panel.waitForFunction(() => !document.getElementById('stageReady').hidden);
    await panel.close();
    // Headless keyboard events do not run Chrome accelerators (even in normal tabs).
    // Preserve a genuine action grant while moving that tab into a toolbarless popup.
    const popup = await worker.evaluate(tabId => chrome.windows.create({ tabId, type: 'popup', width: 900, height: 700 }), tabId);
    assert.equal(popup.type, 'popup');
    const created = context.waitForEvent('page');
    await worker.evaluate(async tabId => openCaptureWindow(await chrome.tabs.get(tabId)), tabId);
    const popupPanel = await created;
    await popupPanel.waitForURL(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
    await popupPanel.waitForFunction(() => document.getElementById('startBtn')?.disabled === false);
    await captureAndStop(popupPanel);
    console.log('PASS toolbarless popup capture with an existing grant, pinned target, OCR and STOP');
    const commands = await worker.evaluate(() => chrome.commands.getAll());
    assert.equal(commands.find(c => c.name === 'open-capture-panel')?.shortcut, 'Alt+Shift+S');
    await popupPanel.click('#againBtn');
    await popupPanel.waitForFunction(() => !document.getElementById('stageReady').hidden);
    await lecture.goto(lecture.url().replace('127.0.0.1', 'localhost'));
    const revoked = await permission();
    assert.equal(revoked.ok, false, 'Cross-origin navigation must revoke the grant');
    console.log('PASS cross-origin navigation revokes capture permission');
  } finally { clearTimeout(deadline); await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
