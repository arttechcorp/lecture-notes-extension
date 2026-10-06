// Headed e2e driver: real Chrome + real extension against a real LMS lecture URL.
// Reuses a dedicated profile (login once with --login), never the user's Chrome.
// Artifacts go OUTSIDE the repo (real lecture content may appear): report.json,
// events.ndjson, console.ndjson, network.ndjson, NN-step.png screenshots.
// Never records tokens, auth codes, emails or request bodies.
//
//   node tools/e2e-flow.cjs --login [--url <lms url>]
//   node tools/e2e-flow.cjs --url <lecture url> [--url <lecture url> ...] [--headless]
//                           [--flow live|bg] [--fresh] [--reload] [--mode slide|region|caption]
//                           [--duration <sec>] [--note-timeout <sec>] [--bg-timeout <min>]
//                           [--regenerate] [--write-model <id>]
//                           [--profile <dir>] [--out <dir>]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function parse(argv) {
  const args = { duration: 60, noteTimeout: 600, bgTimeout: 120, flow: 'live', urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--login') args.login = true;
    else if (a === '--headless') args.headless = true;
    else if (a === '--url') args.urls.push(argv[++i]);
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--flow') args.flow = argv[++i];
    else if (a === '--duration') args.duration = Number(argv[++i]);
    else if (a === '--note-timeout') args.noteTimeout = Number(argv[++i]);
    else if (a === '--bg-timeout') args.bgTimeout = Number(argv[++i]);
    else if (a === '--regenerate') args.regenerate = true;
    else if (a === '--write-model') args.writeModel = argv[++i];
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--reload') args.reload = true;
    else if (a === '--profile') args.profile = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!['live', 'bg'].includes(args.flow)) throw new Error(`--flow must be live|bg`);
  args.profile = args.profile || path.join(os.homedir(), '.lecture-e2e', 'profile');
  args.out = args.out || path.join(os.homedir(), '.lecture-e2e', 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
  return args;
}

const now = () => new Date().toISOString();
// LearnUs credentials live in the macOS Keychain (service learnus-e2e) — read at
// runtime only, never written to any artifact.
const lmsCreds = () => {
  const meta = execFileSync('security', ['find-generic-password', '-s', 'learnus-e2e'], { encoding: 'utf8' });
  const account = meta.match(/"acct"<blob>="([^"]*)"/)?.[1] || '';
  const password = execFileSync('security', ['find-generic-password', '-s', 'learnus-e2e', '-w'], { encoding: 'utf8' }).trim();
  return { account, password };
};
const isLoginPage = u => /login\.php|\/login\/|infra\.yonsei\.ac\.kr|sso/i.test(u);
const stripUrl = u => { try { const x = new URL(u); const origin = x.origin === 'null' ? `${x.protocol}//${x.host}` : x.origin; return origin + x.pathname; } catch { return u.split('?')[0].slice(0, 120); } };
let serviceHost = ''; // read from settings once the SW channel is up (launch/auth)
// network.ndjson privacy: media manifests/segments and any non-service host are
// logged origin-only — playlist/segment paths can identify the lecture.
const MEDIA_PATH = /\.(ts|m3u8|mp4|m4s|aac)$/i;
const netKeep = h => h === serviceHost || h.endsWith('.supabase.co') || h.startsWith('fonts.');
const netUrl = u => { try { const x = new URL(u); return (!netKeep(x.hostname) || MEDIA_PATH.test(x.pathname)) ? (x.origin === 'null' ? `${x.protocol}//${x.host}` : x.origin) : stripUrl(u); } catch { return stripUrl(u); } };

(async () => {
  const args = parse(process.argv.slice(2));
  fs.mkdirSync(args.out, { recursive: true });
  const outFile = name => path.join(args.out, name);
  const events = fs.createWriteStream(outFile('events.ndjson'), { flags: 'a' });
  const consoles = fs.createWriteStream(outFile('console.ndjson'), { flags: 'a' });
  const network = fs.createWriteStream(outFile('network.ndjson'), { flags: 'a' });
  const emit = (stream, obj) => stream.write(JSON.stringify({ ts: now(), ...obj }) + '\n');
  const ev = obj => emit(events, obj);

  const report = { startedAt: now(), urls: args.urls, login: !!args.login, flow: args.flow, headless: !!args.headless, profile: args.profile, steps: [], result: 'running' };
  const writeReport = () => fs.writeFileSync(outFile('report.json'), JSON.stringify(report, null, 2));
  writeReport();

  let context, cdp, id, worker, panel, options, lecture, seq = 0;
  let swSession; // attach mode: CDP session on the extension service worker
  let attachAll = async () => {}; // bound in launchContext
  let hookPageErrors = () => {}; // bound in launchContext
  let teval = async () => null; // bound in launchContext: evaluate in the SW via the CDP tunnel
  // Uniform SW evaluate: Playwright worker in fresh mode, CDP tunnel in attach mode.
  const workerEval = (fn, arg) => (swSession ? teval(`(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`) : worker.evaluate(fn, arg));
  const opened = new Set(); // pages the harness opened (attach mode: never close the user's tabs)
  const newPage = async url => { const p = await context.newPage(); opened.add(p); if (url) await p.goto(url); return p; };
  const snap = async (page, name) => {
    const file = outFile(`${String(++seq).padStart(2, '0')}-${name}.png`);
    try { await page.screenshot({ path: file }); return file; } catch (e) { ev({ kind: 'screenshot-error', name, error: e.message }); return null; }
  };
  const snapAll = async name => {
    const shots = [];
    for (const p of context.pages()) { const s = await snap(p, `${name}-${p.url().slice(0, 40).replace(/[^a-z0-9]+/gi, '_')}`); if (s) shots.push(s); }
    return shots;
  };
  const RANK = { running: -1, ok: 0, skip: 0, warn: 1, blocked: 2, fail: 3 };
  const step = async (name, fn, fatal = false) => {
    const rec = { name, status: 'ok', startedAt: now(), screenshots: [] };
    report.steps.push(rec); ev({ kind: 'step-start', step: name });
    try { Object.assign(rec, await fn(rec) || {}); }
    catch (e) { rec.status = 'fail'; rec.error = e.message; }
    if (['fail', 'blocked'].includes(rec.status)) rec.screenshots.push(...await snapAll(`${name}-fail`));
    rec.ms = Date.now() - new Date(rec.startedAt).getTime();
    if (RANK[rec.status] > RANK[report.result]) report.result = rec.status;
    ev({ kind: 'step-end', step: name, status: rec.status, detail: rec.detail, error: rec.error });
    writeReport();
    if (fatal && ['fail', 'blocked'].includes(rec.status)) { writeReport(); throw Object.assign(new Error(`step ${name} ${rec.status}`), { silent: true }); }
    return rec;
  };

  // ---- launch --------------------------------------------------------------
  let browser;
  async function launchContext(headless) {
    context = await chromium.launchPersistentContext(args.profile, {
      executablePath: CHROME, headless: !!headless,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--enable-unsafe-extension-debugging', '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check'],
    });
    browser = context.browser();
    cdp = await browser.newBrowserCDPSession();
    wirePlumbing();
    await cdp.send('Target.setDiscoverTargets', { discover: true });
  }
  // Attach mode: drive the already-running warm Chrome from --login (detached,
  // --remote-debugging-port=9333). Folder FS grants and LMS cookies live only
  // inside that one Chrome process, so the run must attach to it.
  async function attachContext() {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9333').catch(e => { throw new Error(`warm browser not running: ${e.message.split('\n')[0]} — run node tools/e2e-flow.cjs --login`); });
    context = browser.contexts()[0];
    cdp = await browser.newBrowserCDPSession();
    wirePlumbing();
    await cdp.send('Target.setDiscoverTargets', { discover: true });
  }
  function wirePlumbing() {
  // Console/pageerror via Playwright (covers pages + service workers). Offscreen
  // has no Playwright handle, so it additionally gets Runtime via the CDP tunnel.
  context.on('console', m => {
    const src = m.location()?.url || m.page()?.url() || '';
    if (!src.startsWith('chrome-extension://')) return;
    emit(consoles, { src: stripUrl(src), type: m.type(), text: m.text().slice(0, 500) });
  });
  hookPageErrors = p => p.on('pageerror', e => emit(consoles, { src: stripUrl(p.url()), type: 'pageerror', text: String(e).slice(0, 500) }));
  context.on('workercreated', w => { if (w.url().startsWith('chrome-extension://')) w.on('pageerror', e => emit(consoles, { src: stripUrl(w.url()), type: 'pageerror', text: String(e).slice(0, 500) })); });
  // Non-flatten CDP tunnel: Playwright cannot send commands into child sessions,
  // so use Target.sendMessageToTarget for Network (all ext targets) and Runtime
  // (offscreen, which Playwright never surfaces).
  const sessions = new Map(); // sessionId -> target url
  const pending = new Map(); // `${sessionId}:${msgId}` -> resolve
  let msgId = 0;
  const inflight = new Map(); // `${sessionId}:${requestId}` -> {ts,method,url}
  const extTarget = u => id && u.startsWith(`chrome-extension://${id}/`);
  const tcmd = (sessionId, method, params = {}) => new Promise(res => {
    const mid = ++msgId;
    pending.set(`${sessionId}:${mid}`, res);
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: mid, method, params }) })
      .catch(() => { pending.delete(`${sessionId}:${mid}`); res(null); });
    setTimeout(() => { if (pending.delete(`${sessionId}:${mid}`)) res(null); }, 5000);
  });
  teval = async expr => {
    const r = await tcmd(swSession, 'Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r?.result?.exceptionDetails) throw new Error(`${r.result.exceptionDetails.text} ${r.result.exceptionDetails.exception?.description || ''}`.slice(0, 300));
    return r?.result?.result?.value;
  };
  const cdpEvent = (sessionId, m) => {
    const src = sessions.get(sessionId); if (!src) return;
    if (m.method === 'Runtime.consoleAPICalled')
      emit(consoles, { src: stripUrl(src), type: m.params.type, text: m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 500) });
    else if (m.method === 'Runtime.exceptionThrown')
      emit(consoles, { src: stripUrl(src), type: 'pageerror', text: `${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description || ''}`.slice(0, 500) });
    else if (m.method === 'Network.requestWillBeSent' && !/^chrome-extension:|^blob:|^data:/.test(m.params.request.url))
      inflight.set(`${sessionId}:${m.params.requestId}`, { t: Date.now(), method: m.params.request.method, url: netUrl(m.params.request.url), src: stripUrl(src) });
    else if (m.method === 'Network.responseReceived') { const r = inflight.get(`${sessionId}:${m.params.requestId}`); if (r) r.status = m.params.response.status; }
    else if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') {
      const r = inflight.get(`${sessionId}:${m.params.requestId}`); if (!r) return; inflight.delete(`${sessionId}:${m.params.requestId}`);
      emit(network, { src: r.src, method: r.method, url: r.url, status: r.status ?? null, ms: Date.now() - r.t, ...(m.params.errorText ? { failure: m.params.errorText } : {}) });
    }
  };
  cdp.on('Target.receivedMessageFromTarget', e => {
    let m; try { m = JSON.parse(e.message); } catch { return; }
    if (m.id !== undefined) { const key = `${e.sessionId}:${m.id}`; const res = pending.get(key); if (res) { pending.delete(key); res(m); } }
    else cdpEvent(e.sessionId, m);
  });
  const attachedTargets = new Set();
  const attach = async (targetId, url) => {
    if (attachedTargets.has(targetId)) return;
    attachedTargets.add(targetId);
    try {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
      sessions.set(sessionId, url);
      const isPage = url.includes('/options.html') || url.includes('/sidepanel.html');
      await tcmd(sessionId, 'Network.enable');
      if (!isPage) await tcmd(sessionId, 'Runtime.enable'); // pages covered by Playwright console
      ev({ kind: 'cdp-attach', url });
    } catch (e) { ev({ kind: 'cdp-attach-fail', url, error: e.message }); }
  };
  attachAll = async () => {
    for (const t of (await cdp.send('Target.getTargets')).targetInfos) if (extTarget(t.url)) await attach(t.targetId, t.url);
  };
  cdp.on('Target.targetCreated', e => { if (e.targetInfo?.url && extTarget(e.targetInfo.url)) attach(e.targetInfo.targetId, e.targetInfo.url); });
  cdp.on('Target.targetInfoChanged', e => { if (e.targetInfo?.url && extTarget(e.targetInfo.url)) attach(e.targetInfo.targetId, e.targetInfo.url); });
  }

  try {
    if (args.login) {
      // ---- warm-browser setup: detached PLAIN Chrome, left running ------------
      // Google refuses sign-in inside automation-controlled Chrome, and the
      // folder FS grant / LMS session only live inside a running Chrome process —
      // so the human browser stays up and runs attach to it via :9333.
      // The extension id in the URL is path-derived and stable for this repo.
      const extId = 'gllijdanodakjamndimlpgmhokaakpod';
      try { await fetch('http://127.0.0.1:9333/json/version').then(r => r.json()); console.log('Warm Chrome already listening on :9333 — nothing to do.'); return; } catch {}
      let pids = '';
      try { pids = execFileSync('pgrep', ['-f', `user-data-dir=${args.profile}`], { encoding: 'utf8' }).trim(); } catch {}
      if (pids) { console.error(`A Chrome is already running on ${args.profile} WITHOUT :9333 (pids ${pids.split('\n').join(',')}). Quit it first, then rerun --login.`); process.exit(1); }
      console.log(`Starting warm Chrome on ${args.profile} (debug port 9333) — LEAVE THIS WINDOW OPEN.`);
      console.log('One-time setup:');
      console.log(`  1) chrome://extensions: if the extension is missing → Developer mode → Load unpacked → ${root}`);
      console.log('  2) side panel tab: Google login, onboarding consents, library folder');
      console.log('  3) LMS tab: log in, open the lecture, play the video, open the panel from the toolbar icon,');
      console.log('     click 백그라운드로 처리 and Allow BOTH prompts (webRequest + folder), then cancel');
      const child = spawn(CHROME, [`--user-data-dir=${args.profile}`, '--remote-debugging-port=9333', '--enable-unsafe-extension-debugging',
        '--no-first-run', '--no-default-browser-check', 'chrome://extensions', `chrome-extension://${extId}/sidepanel.html`, ...args.urls],
        { detached: true, stdio: 'ignore' });
      child.unref();
      console.log(`spawned pid ${child.pid}. When setup is done, run the flow — it attaches to this Chrome.`);
      return;
    }
    if (!args.urls.length) throw new Error('--url is required (or use --login)');
    if (args.fresh) await launchContext(args.headless); else await attachContext();

    // ---- 1 launch -----------------------------------------------------------
    await step('launch', async rec => {
      report.version = require(path.join(root, 'manifest.json')).version;
      if (args.fresh) {
        ({ id } = await cdp.send('Extensions.loadUnpacked', { path: root }));
        report.extensionId = id;
        rec.detail = `fresh; id=${id} v${report.version}`;
      } else {
      // attach: use the installed extension WITHOUT reloading when its version
      // already matches the repo — every reload (loadUnpacked or
      // chrome.runtime.reload) REVOKES the session-scoped library-folder FS
      // grant, which needs a native-prompt re-grant. webRequest survives.
        const extId = 'gllijdanodakjamndimlpgmhokaakpod';
        id = extId;
        const swTarget = async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`));
        // grab whatever SW channel exists: Playwright worker or a CDP session on the target
        const grabWorker = async () => {
          worker = context.serviceWorkers().find(w => w.url().includes(id)) || worker;
          if (!worker && !swSession) {
            const t = await swTarget();
            if (t) swSession = (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: false }).catch(() => ({}))).sessionId || null;
          }
          return worker || swSession;
        };
        // wake the SW first: options page + a runtime message; an action click also works
        const waker = await newPage(`chrome-extension://${id}/options.html`).catch(() => null);
        if (waker) await waker.evaluate(() => chrome.runtime.sendMessage({ target: 'background', type: 'GET_STATE' }).catch(() => {})).catch(() => {});
        for (let i = 0; i < 30 && !(await grabWorker()); i++) {
          if (i === 10) { // action dispatch is a reliable SW wake-up
            const tabs = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos.filter(t => /^https?:/.test(t.url));
            if (tabs.length) await cdp.send('Extensions.triggerAction', { id, targetId: tabs[0].targetId }).catch(() => {});
          }
          await new Promise(r => setTimeout(r, 700));
        }
        const FOLDER_NOTE = ' reloaded — folder permission is revoked by reload; preflight will likely block until the user re-grants it (options page → 폴더 고르기).';
        let v;
        if (!(await grabWorker())) {
          // no SW channel at all — the extension may be absent; loadUnpacked installs it
          try { ({ id } = await cdp.send('Extensions.loadUnpacked', { path: root })); }
          catch (e) { throw new Error(`extension service worker unreachable and loadUnpacked failed over port (${e.message.split('\n')[0]}) — Load unpacked manually in chrome://extensions`); }
          for (let i = 0; i < 30 && !(await grabWorker()); i++) await new Promise(r => setTimeout(r, 700));
          if (!(await grabWorker())) throw new Error('extension did not come up after loadUnpacked');
          rec.detail = `attached; loadUnpacked installed id=${id}` + FOLDER_NOTE;
        } else {
          for (let i = 0; i < 6 && v === undefined; i++) { await new Promise(r => setTimeout(r, 700)); v = await workerEval(() => chrome.runtime.getManifest().version).catch(() => undefined); }
          if (v === report.version && !args.reload) rec.detail = `attached; no reload (v${v} matches repo)`;
          else {
            // version differs (or --reload): refresh code via loadUnpacked over the port
            try { ({ id } = await cdp.send('Extensions.loadUnpacked', { path: root })); }
            catch (e) { throw new Error(`running extension is v${v}, repo is ${report.version}, and loadUnpacked failed over port (${e.message.split('\n')[0]})`); }
            worker = null; swSession = null;
            for (let i = 0; i < 30 && !(await grabWorker()); i++) await new Promise(r => setTimeout(r, 700));
            if (!(await grabWorker())) throw new Error('extension did not come back after reload');
            v = await workerEval(() => chrome.runtime.getManifest().version).catch(() => null);
            if (v !== report.version) throw new Error(`extension version mismatch: running ${v}, repo ${report.version}`);
            rec.detail = `attached; reloaded id=${id} v${v}.` + FOLDER_NOTE;
          }
        }
      }
      report.extensionId = id;
      await attachAll();
      try { serviceHost = new URL((await workerEval(() => chrome.storage.local.get('serviceUrl'))).serviceUrl).hostname; } catch {}
    }, true);

    // ---- 2 auth -------------------------------------------------------------
    await step('auth', async rec => {
      options = await newPage();
      for (let i = 0; i < 3; i++) { const e = await options.goto(`chrome-extension://${id}/options.html`).catch(x => x); if (!(e instanceof Error)) break; if (i === 2) throw e; await options.waitForTimeout(2000); } // ERR_BLOCKED_BY_CLIENT on extension pages is transient here
      hookPageErrors(options);
      if (!swSession) worker = context.serviceWorkers().find(w => w.url().includes(id)) || await context.waitForEvent('serviceworker', { timeout: 15000 });
      await attachAll();
      const stored = await workerEval(() => chrome.storage.local.get(['authSession', 'serviceUrl']));
      const signedIn = !!stored.authSession;
      try { serviceHost = serviceHost || new URL(stored.serviceUrl).hostname; } catch {}
      await options.waitForTimeout(1500);
      const plan = await options.evaluate(() => !document.getElementById('accountPlanBox')?.hidden && document.getElementById('planState')?.textContent?.trim() || null);
      const s = await snap(options, 'auth-options'); if (s) rec.screenshots.push(s);
      rec.detail = `signedIn=${signedIn}${plan ? ` plan="${plan.slice(0, 80)}"` : ''}`;
      if (!signedIn) rec.status = 'warn';
    }, true);

    // --write-model: point the note writer at a dev model for this run only.
    // Removed in teardown (finally) no matter how the run ends.
    if (args.writeModel) {
      try { await workerEval(m => chrome.storage.local.set({ devWriteModel: m }), args.writeModel); report.writeModel = args.writeModel; ev({ kind: 'write-model', id: args.writeModel }); }
      catch (e) { ev({ kind: 'write-model-error', error: e.message }); }
    }

    // helpers for panel state (panel is rebound per URL)
    const panelState = () => panel.evaluate(() => ({
      stage: ['onboard', 'stageReady', 'stageLive', 'stageDone'].find(x => !document.getElementById(x)?.hidden) || '?',
      alerts: Object.fromEntries(['readyAlert', 'panelAlert', 'doneAlert'].map(x => [x, document.getElementById(x)?.hidden ? '' : document.getElementById(x)?.textContent?.trim().slice(0, 300) || ''])),
      status: document.getElementById('status')?.textContent?.trim().slice(0, 200),
      counters: { slides: document.getElementById('cntSlides')?.textContent, voice: document.getElementById('cntVoice')?.textContent, queue: document.getElementById('cntQueue')?.textContent },
      donePill: document.getElementById('donePill')?.textContent?.trim(),
      doneSummary: document.getElementById('doneSummary')?.textContent?.trim(),
      working: !document.getElementById('working')?.hidden,
      notesBtnEnabled: !document.getElementById('notesBtn')?.disabled,
      bgStatus: document.getElementById('bgStatus')?.textContent?.trim().slice(0, 300),
    }));

    const runUrl = async (url, i) => {
      const tag = `#${i + 1}`;
      let tabId, regenActive = false; // set when --regenerate clicked #notesBtn (bg_start or bg_progress)
      // v2.4 ready screen: mode cards (#viewMode) ↔ prep view (#viewPrep[data-mode]).
      // Enter the bg prep view like a user: back out of a live prep, then pick the bg card.
      const toBgPrep = async () => {
        const v = await panel.evaluate(() => ({
          prep: !document.getElementById('viewPrep')?.hidden ? document.getElementById('viewPrep').dataset.mode : null,
          mode: !document.getElementById('viewMode')?.hidden,
        })).catch(() => ({}));
        if (v.prep && v.prep !== 'bg') await panel.click('#prepBack').catch(() => {});
        if (v.mode || (v.prep && v.prep !== 'bg')) { await panel.click('#pickBg').catch(() => {}); await panel.waitForTimeout(800); }
      };
      try {
        // ---- open_lecture ----------------------------------------------------
        await step('open_lecture' + tag, async rec => {
          lecture = await newPage();
          await lecture.goto(url, { waitUntil: 'load', timeout: 45000 });
          await lecture.waitForTimeout(2000);
          const s = await snap(lecture, 'open-lecture'); if (s) rec.screenshots.push(s);
          rec.detail = stripUrl(lecture.url());
          if (isLoginPage(lecture.url())) rec.detail += ' (landed on a login page)';
        }, true);

        // ---- lms_login (LearnUs session cookies do not survive restarts) -------
        await step('lms_login' + tag, async rec => {
          if (!isLoginPage(lecture.url())) { rec.status = 'skip'; rec.detail = 'already logged in'; return; }
          const { account, password } = lmsCreds();
          let ok = false, lastWhere = '', route = 'none';
          for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
            try {
              if (/login\.php/.test(lecture.url())) {
                // student number → 연세포털 SSO; navigating directly 403s, must click through
                await lecture.click('a.btn-sso', { timeout: 10000 });
                await lecture.waitForURL(/yonsei\.ac\.kr|learnus\.org/, { timeout: 30000 });
              }
              if (/infra\.yonsei\.ac\.kr/.test(lecture.url())) {
                route = 'portal sso';
                await lecture.fill('#loginId', account);
                await lecture.fill('#loginPasswd', password);
                await lecture.click('a#loginBtn');
                await lecture.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
              } else if (await lecture.locator('#input-username').isVisible().catch(() => false)) {
                // 외부 로그인 form (fallback route)
                route = 'external form';
                await lecture.fill('#input-username', account);
                await lecture.fill('#input-password', password);
                await lecture.click('input[name="loginbutton"], button:has-text("로그인")');
                await lecture.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
              }
              lastWhere = `${await lecture.title()} ${stripUrl(lecture.url())}`;
              await lecture.goto(url, { waitUntil: 'load', timeout: 45000 });
              await lecture.waitForTimeout(1500);
              ok = !isLoginPage(lecture.url());
            } catch (e) { lastWhere = `${e.message.split('\n')[0]} @ ${stripUrl(lecture.url())}`; }
          }
          const s = await snap(lecture, 'post-login'); if (s) rec.screenshots.push(s); // after submit only — never shoot the filled form
          if (!ok) { rec.status = 'fail'; rec.error = `login failed — last: ${lastWhere}; now: ${await lecture.title().catch(() => '?')} ${stripUrl(lecture.url())}`; return; }
          rec.detail = `logged in via ${route}; lecture page: ${stripUrl(lecture.url())}`;
        }, true);

        // fail-fast if the lecture page still isn't the real page
        await step('lecture_ready' + tag, async rec => {
          if (isLoginPage(lecture.url())) { rec.status = 'fail'; rec.error = `still on login page: ${stripUrl(lecture.url())}`; return; }
          rec.detail = `${await lecture.title().catch(() => '?')} ${stripUrl(lecture.url())}`;
        }, true);

        // ---- invoke_action ---------------------------------------------------
        await step('invoke_action' + tag, async rec => {
          await lecture.bringToFront();
          const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
          const tab = targetInfos.find(t => t.url === lecture.url());
          if (!tab) throw new Error('no CDP tab target for lecture page');
          let actionErr = null;
          try { await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId }); }
          catch (e) { actionErr = e.message.split('\n')[0]; } // may not exist over a port connection
          await lecture.waitForTimeout(3500);
          const contexts = await workerEval(() => chrome.runtime.getContexts({}).then(cs => cs.map(c => c.contextType)));
          rec.detail = `contexts=${contexts.join(',')}`;
          if (actionErr) rec.detail += ` | triggerAction failed: ${actionErr}`;
          if (!contexts.includes('SIDE_PANEL')) rec.detail += ' (real side panel NOT opened)';
          // The real side panel has no CDP target — drive through the product's own
          // fallback route (openCaptureWindow popup), same as extension-capture-smoke.cjs.
          tabId = await workerEval(async pageUrl => {
            const tabs = await chrome.tabs.query({});
            const hit = tabs.find(t => t.url === pageUrl) || tabs.find(t => t.active);
            if (!hit) return null;
            await openCaptureWindow(await chrome.tabs.get(hit.id));
            return hit.id;
          }, lecture.url());
          if (!Number.isInteger(tabId)) throw new Error('could not find lecture tab / open capture window');
          panel = await context.waitForEvent('page', { timeout: 10000 });
          opened.add(panel); hookPageErrors(panel);
          panel.on('dialog', d => { ev({ kind: 'dialog', text: d.message().slice(0, 300) }); d.dismiss(); });
          await panel.waitForURL(`chrome-extension://${id}/sidepanel.html?tabId=${tabId}`);
          await attachAll();
          await panel.waitForTimeout(1500);
          const s = await snap(panel, 'panel'); if (s) rec.screenshots.push(s);
          rec.detail += ` | panel driven via capture-window popup (real side panel has no CDP handle), tabId=${tabId}`;
        }, true);

        if (args.flow === 'bg') {
          // ---- preflight ------------------------------------------------------
          await step('preflight' + tag, async rec => {
            const read = () => panel.evaluate(async tid => ({
              webRequest: await chrome.permissions.contains({ permissions: ['webRequest'] }).catch(() => null),
              folder: await LibraryFolder.status(await PackageStore.indexedDbAdapter()).then(s => s.state).catch(e => 'err:' + e.message),
              stage: ['onboard', 'stageReady', 'stageLive', 'stageDone'].find(x => !document.getElementById(x)?.hidden) || '?',
              view: !document.getElementById('viewMode')?.hidden ? 'mode' : (!document.getElementById('viewPrep')?.hidden ? document.getElementById('viewPrep').dataset.mode : null),
              bgLocked: !document.getElementById('bgLocked')?.hidden,
              bgBox: !document.getElementById('bgBox')?.hidden,
              bgBtnDisabled: !!document.getElementById('bgBtn')?.disabled,
              bgStatus: document.getElementById('bgStatus')?.textContent?.trim(),
              tabMatch: document.getElementById('tabSelect')?.value === String(tid),
            }), tabId).catch(e => ({ evalError: e.message }));
            let pf = await read();
            if (pf.stage === 'onboard') { rec.status = 'blocked'; rec.detail = 'onboarding/consent screen is showing — needs a human'; return; }
            if (pf.stage === 'stageReady' && pf.view !== 'bg') { await toBgPrep(); pf = await read(); }
            if (!pf.tabMatch) await panel.selectOption('#tabSelect', String(tabId)).catch(() => {});
            rec.detail = JSON.stringify(pf);
            if (pf.webRequest !== true && pf.stage !== 'stageDone') { rec.status = 'blocked'; rec.detail += ' | In the warm Chrome window: play the video, open the panel, pick 백그라운드 생성, click 노트 생성 시작 once and Allow the prompt(s); leave Chrome open.'; return; }
            if (pf.folder === 'needs-permission') { rec.status = 'blocked'; rec.detail += ' | In the warm Chrome window: open the panel and re-pick/Allow the library folder; leave Chrome open.'; return; }
            if (pf.stage === 'stageDone') return; // completion screen of an already-processed lecture — bg_start decides skip/--regenerate
            if (pf.bgLocked) { rec.status = 'blocked'; rec.detail += ' | bgLocked — background is a paid feature'; return; }
            if (pf.bgBox === false) { rec.status = 'fail'; rec.error = 'bgBox hidden — background mode not offered (login/paid plan?)'; return; }
          }, true);

          // ---- play_video -----------------------------------------------------
          await step('play_video' + tag, async rec => {
            await lecture.bringToFront();
            const videoT = f => f.evaluate(() => document.querySelector('video')?.currentTime || 0).catch(() => 0);
            let method = null, frameUrl = null;
            const playing = async () => { for (const f of lecture.frames()) if (await videoT(f) > 0) { frameUrl = f.url(); return true; } return false; };
            if (!(await playing())) {
              // like a user: try the player's own control first (LearnUs nests it in iframes)
              for (const f of lecture.frames()) {
                for (const sel of ['.vjs-big-play-button', '.vjs-play-control', 'button[aria-label*="재생"]', 'button[aria-label*="Play"]', '.fp-play', '.play']) {
                  const loc = f.locator(sel).first();
                  if (await loc.isVisible().catch(() => false)) {
                    await loc.click().catch(() => {});
                    await lecture.waitForTimeout(1500);
                    if (await playing()) { method = `click ${sel}`; break; }
                  }
                }
                if (method) break;
              }
              if (!method) for (const f of lecture.frames()) { // last resort: direct play()
                const ok = await f.evaluate(() => { const v = document.querySelector('video'); if (!v) return false; v.muted = true; return v.play().then(() => true).catch(() => false); }).catch(() => false);
                if (ok) { method = 'video.play() fallback'; break; }
              }
            }
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) { if (await playing()) break; await lecture.waitForTimeout(1000); }
            const s = await snap(lecture, 'play'); if (s) rec.screenshots.push(s);
            if (!frameUrl) {
              const st = await panelState().catch(() => ({ alerts: {} }));
              const alert = Object.values(st.alerts || {}).join(' ');
              if (/보호|DRM|차단/.test(alert)) { rec.status = 'blocked'; rec.detail = `protection message: ${alert}`; return; }
              throw new Error(`no video with currentTime>0 within 30s (method=${method || 'none'}; lecture title="${await lecture.title().catch(() => '?')}")`);
            }
            rec.detail = `playing; method=${method || 'already playing'} frame=${stripUrl(frameUrl)}`;
          }, true);

          // ---- bg_start --------------------------------------------------------
          await step('bg_start' + tag, async rec => {
            const st = await panel.evaluate(() => ({
              stage: ['onboard', 'stageReady', 'stageLive', 'stageDone'].find(x => !document.getElementById(x)?.hidden) || '?',
              view: !document.getElementById('viewMode')?.hidden ? 'mode' : (!document.getElementById('viewPrep')?.hidden ? document.getElementById('viewPrep').dataset.mode : null),
              donePill: document.getElementById('donePill')?.textContent?.trim(),
              notesDisabled: !!document.getElementById('notesBtn')?.disabled,
              recognition: !!document.getElementById('recognitionBox')?.checkVisibility?.(),
              retryNote: !!document.getElementById('retryNoteBtn')?.checkVisibility?.(),
            }));
            // Shared completion screen for an already-processed lecture.
            if (st.stage === 'stageDone') {
              if (!args.regenerate) { rec.status = 'skip'; rec.detail = `already has a note (pill="${st.donePill}")`; return; }
              if (st.recognition) { rec.status = 'blocked'; rec.detail = 'recognition-only result — 노트 만들기 needs a summary-consent decision by a human'; return; }
              if (st.retryNote || /노트 실패|중단됨/.test(st.donePill || '')) { rec.status = 'fail'; rec.error = `completion screen shows failure (pill="${st.donePill}")`; return; }
              if (st.notesDisabled) { rec.status = 'fail'; rec.error = 'notesBtn disabled — no regenerate path'; return; }
              await panel.click('#notesBtn');
              regenActive = true;
              rec.detail = 'clicked 노트 다시 만들기 (#notesBtn, --regenerate)';
              return;
            }
            if (st.stage === 'stageReady' && st.view !== 'bg') await toBgPrep(); // mode cards → bg prep, like a user
            if (await panel.locator('#bgBtn').isDisabled().catch(() => true)) { rec.status = 'fail'; rec.error = 'bgBtn disabled'; return; }
            const label = (await panel.locator('#bgBtn').textContent().catch(() => '')).trim();
            await panel.click('#bgBtn');
            rec.detail = `clicked "${label}"`;
          }, true);

          // ---- bg_progress -----------------------------------------------------
          await step('bg_progress' + tag, async rec => {
            const deadline = Date.now() + args.bgTimeout * 60000;
            let lastStage = '', sawRun = regenActive, regenBusy = false;
            const read = () => panel.evaluate(() => ({
              stage: ['onboard', 'stageReady', 'stageLive', 'stageDone'].find(x => !document.getElementById(x)?.hidden) || '?',
              bgStatus: document.getElementById('bgStatus')?.textContent?.trim(),
              bgProgress: document.getElementById('bgProgress')?.textContent?.trim(),
              bgTime: document.getElementById('bgTime')?.hidden ? null : document.getElementById('bgTime')?.textContent,
              bar: document.getElementById('bgBar')?.hidden ? null : document.getElementById('bgBar')?.value,
              save: ['bgSave', 'saveBox'].map(b => document.getElementById(b)?.hidden ? '' : document.getElementById(b)?.textContent?.trim().slice(0, 300)).filter(Boolean).join(' / '),
              status: document.getElementById('status')?.textContent?.trim().slice(0, 200),
              working: !document.getElementById('working')?.hidden,
              donePill: document.getElementById('donePill')?.textContent?.trim(),
              doneSummary: document.getElementById('doneSummary')?.textContent?.trim(),
              doneAlert: document.getElementById('doneAlert')?.hidden ? '' : document.getElementById('doneAlert')?.textContent?.trim().slice(0, 300),
              notesBtnDisabled: !!document.getElementById('notesBtn')?.disabled,
              vis: Object.fromEntries(['bgRetryBtn', 'bgCancelBtn', 'bgLiveBtn', 'bgConsentBtn', 'bgMakeBtn', 'bgDiscardBtn', 'bgBilling', 'bgSummaryLink', 'notesBtn', 'makeNoteBtn', 'retryNoteBtn', 'siteNotesBtn', 'againBtn'].map(b => [b, !!document.getElementById(b)?.checkVisibility?.()])), // ancestors may be hidden — own .hidden is not enough
            })).catch(() => null);
            const shot = async name => { const s = await snap(panel, name); if (s) rec.screenshots.push(s); };
            while (Date.now() < deadline) {
              const st = await read();
              if (!st) break;
              ev({ kind: 'bg-sample', ...st });
              const t = st.bgStatus || '';
              if (/^현재 단계 · /.test(t)) { sawRun = true; if (t !== lastStage) { lastStage = t; rec.detail = t; writeReport(); } }
              if (regenActive && (st.working || /만드는 중/.test(st.status || ''))) regenBusy = true; // regen must show work before its done screen counts
              // note ready: bg card text and/or the shared completion screen
              if (t.startsWith('노트 준비됨')) { rec.detail = `${t}${st.save ? ' | save: ' + st.save : ''}`; await shot('bg-done'); return; }
              if (st.stage === 'stageDone' && sawRun && (!regenActive || regenBusy) && !st.working) {
                if (st.doneAlert && /동의|한도|로그인/.test(st.doneAlert)) { rec.status = 'blocked'; rec.detail = 'done alert needs a human: ' + st.doneAlert; await shot('bg-done'); return; }
                if (st.doneAlert || /노트 실패|중단됨/.test(st.donePill || '')) { rec.status = 'fail'; rec.error = `pill="${st.donePill}" alert="${st.doneAlert}"`; await shot('bg-done'); return; }
                if (st.vis.makeNoteBtn) { rec.status = 'blocked'; rec.detail = 'recognition-only — 노트 만들기 needs a summary-consent decision by a human'; await shot('bg-done'); return; }
                if (/노트 완성|일부 완료|인식 완료|인식만 완료/.test(st.donePill || '')) { rec.detail = `pill="${st.donePill}" ${st.doneSummary || ''}${st.save ? ' | save: ' + st.save : ''}`; await shot('bg-done'); return; }
              }
              // completion screen of an already-processed lecture (no run happened yet)
              if (st.stage === 'stageDone' && !sawRun) {
                if (!args.regenerate) { rec.status = 'skip'; rec.detail = `already has a note (pill="${st.donePill}")`; return; }
                if (st.vis.makeNoteBtn) { rec.status = 'blocked'; rec.detail = 'recognition-only result — 노트 만들기 needs a summary-consent decision by a human'; return; }
                if (st.vis.retryNoteBtn || /노트 실패|중단됨/.test(st.donePill || '')) { rec.status = 'fail'; rec.error = `prior run failed (pill="${st.donePill}")`; return; }
                if (st.vis.notesBtn && !st.notesBtnDisabled) { await panel.click('#notesBtn').catch(() => {}); regenActive = sawRun = true; ev({ kind: 'bg-regen-click' }); }
                // else: done screen still settling — keep sampling
              }
              if (t.includes('이미 노트를 만든 강의입니다')) {
                if (!args.regenerate) { rec.status = 'skip'; rec.detail = 'already has a note: ' + t; return; }
                // with --regenerate the shared completion screen follows (BG_DONE → showBgDone); the stageDone branch clicks 노트 다시 만들기
              }
              if (st.vis.bgConsentBtn || st.vis.bgBilling || st.vis.bgSummaryLink || st.vis.bgLiveBtn || st.vis.bgMakeBtn || /동의|한도/.test(t)) { rec.status = 'blocked'; rec.detail = 'needs a human: ' + t; return; }
              if (st.vis.bgRetryBtn || /마치지 못했습니다|찾지 못했습니다|코드:/.test(t)) { rec.status = 'fail'; rec.error = 'bg: ' + t; return; }
              if (t.includes('취소했습니다')) { rec.status = 'fail'; rec.error = 'cancelled: ' + t; return; }
              await panel.waitForTimeout(10000);
            }
            throw new Error(`bg_progress timed out; last="${lastStage}"`);
          }, true);
        } else {
          // ---- settings --------------------------------------------------------
          await step('settings' + tag, async rec => {
            let modeNote = '';
            if (args.mode) {
              if (await panel.locator('#settingsToggle').isVisible().catch(() => false)) {
                await panel.click('#settingsToggle'); // modeSelect lives inside the settings drawer
                await panel.selectOption('#modeSelect', args.mode);
                await panel.click('#settingsClose');
              } else { modeNote = `settings UI not visible (stage ${(await panelState()).stage}) — --mode not applied; `; rec.status = 'warn'; }
            }
            const s = await workerEval(() => chrome.storage.local.get(null));
            const settings = {};
            for (const k of ['ocrEngine', 'whisperModel', 'whisperLang', 'sttModel', 'visionModel', 'backgroundMode', 'remoteSummaryConsent', 'visionConsent', 'visionConsentVersion'])
              if (['string', 'number', 'boolean'].includes(typeof s[k])) settings[k] = s[k];
            if (typeof s.backgroundConsent?.version === 'string') settings.backgroundConsentVersion = s.backgroundConsent.version;
            try { settings.serviceHost = new URL(s.serviceUrl).hostname; } catch {}
            rec.detail = modeNote + JSON.stringify({ mode: args.mode || (await panel.locator('#modeSelect').inputValue().catch(() => '?')), settings });
          }, true);

          // ---- start ------------------------------------------------------------
          await step('start' + tag, async rec => {
            let st = await panelState();
            if (st.stage === 'onboard') { rec.status = 'blocked'; rec.detail = 'onboarding/consent screen is showing — needs a human'; return; }
            if (await panel.locator('#startBtn').isDisabled()) {
              rec.status = st.alerts.readyAlert ? 'blocked' : 'fail';
              rec.detail = `startBtn disabled; readyAlert="${st.alerts.readyAlert || ''}"`;
              return;
            }
            await panel.click('#startBtn');
            const deadline = Date.now() + 30000;
            while (Date.now() < deadline) {
              st = await panelState();
              if (st.stage === 'stageLive') { rec.detail = `live; ${st.status || ''}`; return; }
              if (st.stage === 'onboard') { rec.status = 'blocked'; rec.detail = 'consent/onboarding appeared on start — not auto-accepted'; return; }
              const alert = st.alerts.readyAlert || st.alerts.panelAlert;
              if (alert) { rec.status = /동의|로그인|보호|차단|전환|권한/.test(alert) ? 'blocked' : 'fail'; rec.detail = `alert: ${alert}`; return; }
              if (st.stage === 'stageDone') { rec.status = 'fail'; rec.detail = `went straight to done: ${st.donePill} ${st.alerts.doneAlert}`; return; }
              await panel.waitForTimeout(800);
            }
            throw new Error('start timed out; ' + JSON.stringify(await panelState()));
          }, true);

          // ---- capture -----------------------------------------------------------
          await step('capture' + tag, async rec => {
            const deadline = Date.now() + args.duration * 1000;
            while (Date.now() < deadline) {
              const st = await panelState().catch(() => null);
              if (!st) break;
              ev({ kind: 'sample', ...st });
              const alert = st.alerts.panelAlert;
              if (alert) { rec.status = 'fail'; rec.error = `panel alert during capture: ${alert}`; return; }
              if (st.stage !== 'stageLive') { rec.status = 'warn'; rec.detail = `left live stage early: ${st.stage}`; return; }
              await panel.waitForTimeout(5000);
            }
            const last = await panelState().catch(() => null);
            rec.detail = last ? `slides=${last.counters.slides} voice=${last.counters.voice} queue=${last.counters.queue}` : 'panel gone';
            const s = await snap(panel, 'capture'); if (s) rec.screenshots.push(s);
          }, true);

          // ---- stop ----------------------------------------------------------------
          await step('stop' + tag, async rec => {
            if (await panel.locator('#stopBtn').isDisabled().catch(() => true)) { rec.status = 'warn'; rec.detail = 'stopBtn not enabled — session may have ended already'; return; }
            await panel.click('#stopBtn');
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline) {
              const st = await panelState();
              if (st.stage === 'stageDone') { rec.detail = `pill="${st.donePill}" ${st.doneSummary || ''} alert="${st.alerts.doneAlert}"`; if (st.alerts.doneAlert) rec.status = 'warn'; return; }
              if (st.alerts.panelAlert) { rec.status = 'fail'; rec.error = st.alerts.panelAlert; return; }
              await panel.waitForTimeout(1000);
            }
            throw new Error('stop timed out');
          }, true);

          // ---- generate_notes ------------------------------------------------------
          await step('generate_notes' + tag, async rec => {
            const st0 = await panelState();
            if (st0.notesBtnEnabled) { await panel.click('#notesBtn'); ev({ kind: 'notes-click' }); }
            else rec.detail = `notesBtn disabled (auto-summarize or prior failure); `;
            const deadline = Date.now() + args.noteTimeout * 1000;
            while (Date.now() < deadline) {
              const st = await panelState();
              ev({ kind: 'sample', ...st });
              if (st.alerts.doneAlert && !st.working) {
                rec.status = 'fail'; rec.error = `doneAlert: ${st.alerts.doneAlert}`; return;
              }
              if (st.stage === 'stageDone' && !st.working && /노트 완성|인식 완료|인식만 완료|일부 완료|노트 실패|중단됨/.test(st.donePill || '')) {
                rec.detail = (rec.detail || '') + `pill="${st.donePill}" ${st.doneSummary || ''}`;
                if (st.donePill === '노트 실패' || st.donePill === '중단됨') { rec.status = 'fail'; rec.error = rec.detail; }
                const s = await snap(panel, 'done'); if (s) rec.screenshots.push(s);
                return;
              }
              if (st.stage === 'onboard') { rec.status = 'blocked'; rec.detail = 'consent/onboarding appeared — not auto-accepted'; return; }
              await panel.waitForTimeout(5000);
            }
            throw new Error('generate_notes timed out');
          }, true);
        }
      } catch (e) { if (!e.silent) throw e; ev({ kind: 'url-abort', url, error: e.message }); }
      finally { await panel?.close().catch(() => {}); await lecture?.close().catch(() => {}); opened.delete(panel); opened.delete(lecture); panel = lecture = null; }
    };

    for (const [i, url] of args.urls.entries()) await runUrl(url, i);

    // ---- diagnostics ---------------------------------------------------------
    await step('diagnostics', async rec => {
      const dl = options.waitForEvent('download', { timeout: 15000 }).catch(() => null);
      await options.bringToFront();
      await options.click('#diagExportBtn');
      const d = await dl;
      if (d) {
        const file = outFile(d.suggestedFilename());
        await d.saveAs(file);
        rec.detail = `saved ${file} (${fs.statSync(file).size} bytes)`;
        try { // agent-facing aggregate only — diagnostics are content-free by design
          const b = JSON.parse(fs.readFileSync(file, 'utf8'));
          const evs = b.events || [];
          const hist = {};
          for (const e of evs) hist[`${e.stage}:${e.code || ''}`] = (hist[`${e.stage}:${e.code || ''}`] || 0) + 1;
          const top = Object.entries(hist).sort((a, z) => z[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}×${v}`).join(', ');
          rec.detail += ` | keys=${Object.keys(b)} env=[${Object.keys(b.env || {})}] settings=[${Object.keys(b.env?.settings || {})}] auth.signedIn=${b.env?.auth?.signedIn} server.ok=${b.env?.server?.ok} server.httpStatus=${b.env?.server?.httpStatus} events=${evs.length} errors=${evs.filter(e => e.level === 'error').length} top=${top}`;
          const nm = evs.findLast?.(e => e.code === 'NOTE_MODELS') || [...evs].reverse().find(e => e.code === 'NOTE_MODELS');
          rec.detail += ` | noteModels=${nm ? JSON.stringify(String(nm.msg ?? '').slice(0, 160)) : 'none'} writeTimeout=${evs.filter(e => e.code === 'WRITE_TIMEOUT').length} altModel=${evs.filter(e => e.code === 'ALT_MODEL').length}`;
        } catch (e) { rec.detail += ` | parse failed: ${e.message}`; }
      } else {
        const notice = await options.evaluate(() => document.getElementById('saved')?.textContent || '').catch(() => '');
        rec.status = 'fail'; rec.error = `no download; notice="${notice}"`;
      }
      const s = await snap(options, 'diagnostics'); if (s) rec.screenshots.push(s);
    });

    if (report.result === 'running') report.result = 'ok';
  } finally {
    if (report.result === 'running') report.result = 'aborted';
    if (report.writeModel) { // --write-model: never leave the dev key behind
      try { await workerEval(() => chrome.storage.local.remove('devWriteModel')); ev({ kind: 'write-model-removed' }); }
      catch (e) { ev({ kind: 'write-model-remove-error', error: e.message }); }
    }
    writeReport();
    console.log(`REPORT ${outFile('report.json')}`);
    if (args.fresh) { await context?.close().catch(() => {}); }
    else {
      // attach mode: close only pages this run opened — never the warm Chrome.
      // Do NOT browser.close() (on connectOverCDP it closes the whole browser);
      // just let the process exit, which severs the socket.
      for (const p of opened) await p.close().catch(() => {});
      try { await fetch('http://127.0.0.1:9333/json/version'); console.log('warm Chrome still running on :9333'); }
      catch { console.log('NOTE: :9333 no longer reachable — warm Chrome may have exited'); }
    }
    await Promise.all([events, consoles, network].map(s => new Promise(r => s.end(r))));
    if (['fail', 'blocked'].includes(report.result)) process.exitCode = 1;
  }
  process.exit(process.exitCode || 0); // attach mode leaves the CDP socket open; exit severs it
})().catch(e => { if (!e.silent) { console.error(e); } process.exit(1); });
