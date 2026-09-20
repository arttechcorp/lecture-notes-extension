// Browser automation verification for the "고화질 화면 인식" (vision) options toggle.
// Tests the 4 main scenarios + 1 fix verification against a local server instance.
// Requires PLAYWRIGHT_MODULE and CHROME_PATH.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const vaultDir = '/tmp/vision-smoke-vault';
const paidToken = 'paidtoken12345678901234567890123456789012';
const freeToken = 'freetoken12345678901234567890123456789012';
const port = 8788;

async function waitForServer(proc, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) {
      throw new Error(`Server exited prematurely with code ${proc.exitCode}`);
    }
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/`, res => {
          res.resume();
          resolve();
        });
        req.on('error', reject);
        req.setTimeout(500, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  throw new Error('Server did not become ready in time');
}

(async () => {
  let context = null;
  let serverProc = null;
  const deadline = setTimeout(() => {
    console.error('Vision options smoke timed out');
    process.exitCode = 1;
    if (serverProc) serverProc.kill('SIGTERM');
    if (context) context.close().catch(() => {});
  }, 90000);

  try {
    context = await chromium.launchPersistentContext('', {
      executablePath: process.env.CHROME_PATH,
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging'],
    });

    if (!context.browser()) {
      const impl = context._connection.toImpl(context);
      context.browser = () => ({
        newBrowserCDPSession: () => impl._browser._clientRootSession(),
      });
    }

    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    assert.match(id, /^[a-p]{32}$/, `Extension id must be a 32-char string matching [a-p]{32}, got: ${id}`);

    const worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`))
      || await context.waitForEvent('serviceworker', { timeout: 15000 });

    fs.mkdirSync(vaultDir, { recursive: true });
    serverProc = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
      env: {
        ...process.env,
        OPENROUTER_API_KEY: 'dummy',
        EXTENSION_ORIGIN: `chrome-extension://${id}`,
        APP_TOKENS_JSON: JSON.stringify({ paid: paidToken, free: freeToken }),
        ALLOWED_MODELS: JSON.stringify(['google/gemini-2.5-flash-lite']),
        OPENROUTER_PROVIDERS_JSON: JSON.stringify({ 'google/gemini-2.5-flash-lite': ['google-vertex'] }),
        ALLOWED_VISION_MODELS: JSON.stringify(['google/gemini-2.5-flash-lite']),
        ACCOUNT_LIMITS_JSON: JSON.stringify({
          paid: {
            models: ['google/gemini-2.5-flash-lite'],
            maxRequests: 10,
            maxCostCents: 100,
            features: ['vision'],
          },
        }),
        VAULT_DIR: vaultDir,
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProc.stderr.on('data', d => console.error(`[server-stderr] ${d}`));
    await waitForServer(serverProc);

    const page = await context.newPage();
    const optionsUrl = `chrome-extension://${id}/options.html`;

    // On MV3 extension pages without 'unsafe-eval' in CSP, Playwright's built-in
    // waitForFunction falls back to globalThis.eval inside requestAnimationFrame,
    // which Chrome blocks with CSP EvalError. We polyfill waitForFunction on the page
    // to poll via page.evaluate (which uses CDP Runtime.callFunctionOn without eval).
    const origWaitForFunction = page.waitForFunction.bind(page);
    page.waitForFunction = async (fn, arg, options) => {
      const timeout = options?.timeout ?? 15000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          const res = await page.evaluate(fn, arg);
          if (res) return res;
        } catch {}
        await new Promise(r => setTimeout(r, 50));
      }
      return await origWaitForFunction(fn, arg, options);
    };

    // -------------------------------------------------------------------------
    // Scenario 1:
    // storage: {consentAccepted:true} with serviceUrl:'', appSessionToken:''
    // -> #visionCb disabled, #visionState text === '서비스 연결을 먼저 설정하세요.'
    // -------------------------------------------------------------------------
    await worker.evaluate(() => chrome.storage.local.clear());
    await worker.evaluate(() => chrome.storage.local.set({
      consentAccepted: true,
      serviceUrl: '',
      appSessionToken: '',
      ocrEngine: 'ppocr-v5-wasm',
      visionConsent: false,
    }));
    await page.goto(optionsUrl);
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      return el && el.textContent.trim() === '서비스 연결을 먼저 설정하세요.';
    });
    const s1BoxDisabled = await page.locator('#visionCb').isDisabled();
    const s1StateText = (await page.locator('#visionState').textContent()).trim();
    assert.equal(s1BoxDisabled, true, '#visionCb must be disabled when service is unconfigured');
    assert.equal(s1StateText, '서비스 연결을 먼저 설정하세요.');
    console.log(`PASS 1 unconfigured service keeps vision toggle disabled with guidance ("${s1StateText}")`);

    // -------------------------------------------------------------------------
    // Scenario 2:
    // storage: serviceUrl:'http://127.0.0.1:8788', appSessionToken:<free token>
    // -> after /v1/me resolves (waitForFunction on the text),
    //    #visionState text === '유료 플랜에서 사용할 수 있습니다.' and #visionCb disabled.
    // -------------------------------------------------------------------------
    await worker.evaluate(token => chrome.storage.local.set({
      serviceUrl: 'http://127.0.0.1:8788',
      appSessionToken: token,
      ocrEngine: 'ppocr-v5-wasm',
      visionConsent: false,
    }), freeToken);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      return el && el.textContent.trim() === '유료 플랜에서 사용할 수 있습니다.';
    });
    const s2BoxDisabled = await page.locator('#visionCb').isDisabled();
    const s2StateText = (await page.locator('#visionState').textContent()).trim();
    assert.equal(s2BoxDisabled, true, '#visionCb must be disabled on free plan');
    assert.equal(s2StateText, '유료 플랜에서 사용할 수 있습니다.');
    console.log(`PASS 2 free plan shows paid requirement and keeps vision toggle disabled ("${s2StateText}")`);

    // -------------------------------------------------------------------------
    // Scenario 3:
    // storage: appSessionToken:<paid token>
    // -> #visionState text === '사용 가능한 플랜입니다.', #visionCb enabled.
    // Click #visionCb -> dialog#visionWarn has open.
    // Click #visionWarnCancel -> dialog closed, #visionCb unchecked, and storage ocrEngine still 'ppocr-v5-wasm'.
    // Click #visionCb again -> click #visionWarnOk -> storage ocrEngine==='vision-cloud' && visionConsent===true.
    // Reload page -> #visionCb checked.
    // -------------------------------------------------------------------------
    await worker.evaluate(token => chrome.storage.local.set({
      serviceUrl: 'http://127.0.0.1:8788',
      appSessionToken: token,
      ocrEngine: 'ppocr-v5-wasm',
      visionConsent: false,
    }), paidToken);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      return el && el.textContent.trim() === '사용 가능한 플랜입니다.';
    });
    const s3StateText = (await page.locator('#visionState').textContent()).trim();
    assert.equal(s3StateText, '사용 가능한 플랜입니다.');
    assert.equal(await page.locator('#visionCb').isEnabled(), true, '#visionCb must be enabled on paid plan');

    // Click #visionCb -> dialog#visionWarn has open
    await page.click('#visionCb');
    await page.waitForFunction(() => {
      const dlg = document.querySelector('dialog#visionWarn');
      return dlg && dlg.hasAttribute('open');
    });
    assert.equal(await page.locator('dialog#visionWarn').evaluate(el => el.hasAttribute('open')), true, 'dialog#visionWarn must have open attribute');

    // Capture screenshot of the options page with the modal open
    await page.screenshot({ path: '/tmp/vision-options-modal.png' });

    // Click #visionWarnCancel -> dialog closed, #visionCb unchecked, storage ocrEngine still 'ppocr-v5-wasm'
    await page.click('#visionWarnCancel');
    await page.waitForFunction(() => {
      const dlg = document.querySelector('dialog#visionWarn');
      return dlg && !dlg.hasAttribute('open');
    });
    assert.equal(await page.locator('#visionCb').isChecked(), false, '#visionCb must be unchecked after cancel');
    const storageAfterCancel = await worker.evaluate(() => chrome.storage.local.get(['ocrEngine', 'visionConsent']));
    assert.equal(storageAfterCancel.ocrEngine, 'ppocr-v5-wasm', 'ocrEngine must remain ppocr-v5-wasm after cancel');
    assert.equal(storageAfterCancel.visionConsent, false);

    // Click #visionCb again -> click #visionWarnOk -> storage ocrEngine==='vision-cloud' && visionConsent===true
    await page.click('#visionCb');
    await page.waitForFunction(() => {
      const dlg = document.querySelector('dialog#visionWarn');
      return dlg && dlg.hasAttribute('open');
    });
    await page.click('#visionWarnOk');
    await page.waitForFunction(() => {
      const dlg = document.querySelector('dialog#visionWarn');
      return dlg && !dlg.hasAttribute('open');
    });
    await worker.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const s = await chrome.storage.local.get(['ocrEngine', 'visionConsent']);
        if (s.ocrEngine === 'vision-cloud' && s.visionConsent === true) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('timeout waiting for storage');
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      return el && el.textContent.trim() === '사용 가능한 플랜입니다.';
    });
    assert.equal(await page.locator('#visionCb').isChecked(), true, '#visionCb must be checked after reload');
    console.log(`PASS 3 paid plan enables vision toggle, modal cancel retains local OCR, confirm enables vision-cloud ("${s3StateText}")`);

    // -------------------------------------------------------------------------
    // Scenario 4:
    // Regression for the plan-revoked path: with storage ocrEngine:'vision-cloud',
    // visionConsent:true but appSessionToken:<free token>
    // -> after load, #visionCb unchecked+disabled and storage ocrEngine==='ppocr-v5-wasm', visionConsent===false.
    // -------------------------------------------------------------------------
    await worker.evaluate(token => chrome.storage.local.set({
      serviceUrl: 'http://127.0.0.1:8788',
      appSessionToken: token,
      ocrEngine: 'vision-cloud',
      visionConsent: true,
    }), freeToken);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      const cb = document.getElementById('visionCb');
      return el && el.textContent.trim() === '유료 플랜에서 사용할 수 있습니다.' && cb && cb.disabled && !cb.checked;
    });
    await worker.evaluate(async () => {
      for (let i = 0; i < 50; i++) {
        const s = await chrome.storage.local.get(['ocrEngine', 'visionConsent']);
        if (s.ocrEngine === 'ppocr-v5-wasm' && s.visionConsent === false) return true;
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('timeout waiting for storage revocation');
    });
    const s4StateText = (await page.locator('#visionState').textContent()).trim();
    assert.equal(await page.locator('#visionCb').isDisabled(), true, '#visionCb must be disabled after plan revocation');
    assert.equal(await page.locator('#visionCb').isChecked(), false, '#visionCb must be unchecked after plan revocation');
    const storageRevoked = await worker.evaluate(() => chrome.storage.local.get(['ocrEngine', 'visionConsent']));
    assert.equal(storageRevoked.ocrEngine, 'ppocr-v5-wasm');
    assert.equal(storageRevoked.visionConsent, false);
    console.log(`PASS 4 revoked plan resets vision-cloud to ppocr-v5-wasm and unchecks/disables toggle ("${s4StateText}")`);

    // -------------------------------------------------------------------------
    // Scenario 5 (fix verification):
    // with paid token and vision enabled, click #testBtn ("연결 테스트")
    // and wait for #saved text to contain '연결됨'
    // -> storage ocrEngine must STILL be 'vision-cloud' (a previous bug reset it).
    // -------------------------------------------------------------------------
    await worker.evaluate(token => chrome.storage.local.set({
      serviceUrl: 'http://127.0.0.1:8788',
      appSessionToken: token,
      ocrEngine: 'vision-cloud',
      visionConsent: true,
    }), paidToken);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('visionState');
      return el && el.textContent.trim() === '사용 가능한 플랜입니다.';
    });
    assert.equal(await page.locator('#visionCb').isChecked(), true, '#visionCb must be checked before testBtn click');

    const detailsOpen = await page.locator('details').evaluate(d => d.open);
    if (!detailsOpen) {
      await page.click('summary.api-summary');
    }
    await page.click('#testBtn');
    await page.waitForFunction(() => {
      const saved = document.getElementById('saved');
      return saved && !saved.hidden && saved.textContent.includes('연결됨');
    });
    const s5SavedText = (await page.locator('#saved').textContent()).trim();
    const storageAfterTest = await worker.evaluate(() => chrome.storage.local.get(['ocrEngine', 'visionConsent']));
    assert.equal(storageAfterTest.ocrEngine, 'vision-cloud', 'storage ocrEngine must STILL be vision-cloud after testBtn click');
    assert.equal(storageAfterTest.visionConsent, true, 'storage visionConsent must STILL be true after testBtn click');
    console.log(`PASS 5 test connection button does not reset vision-cloud ocrEngine ("${s5SavedText}")`);

  } finally {
    clearTimeout(deadline);
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
