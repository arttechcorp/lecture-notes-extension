// Loads the real MV3 worker and measures 20-second synthetic inference in isolated Chrome.
// Requires PLAYWRIGHT_MODULE and CHROME_PATH. Model weights are cached in the test profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const runs = Math.max(1, Number(process.env.WHISPER_BENCH_RUNS) || 1);
const mode = process.env.WHISPER_BENCH_MODE === 'base-wasm' ? 'base-wasm' : 'small-webgpu';
const wav = process.env.WHISPER_WAV_PATH ? fs.readFileSync(process.env.WHISPER_WAV_PATH).toString('base64') : null;

(async () => {
  const context = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'summrizei-whisper-extension-cache'), {
    executablePath: process.env.CHROME_PATH,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: root });
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/options.html`);
    const result = await page.evaluate(({ workerUrl, runs, mode, wav }) => new Promise(resolve => {
      const worker = new Worker(workerUrl, { type: 'module' });
      let progress = null, started = 0, run = 0, audioSeconds = 20;
      const inferenceMs = [], rtf = [], textLengths = [];
      const timeout = setTimeout(() => { worker.terminate(); resolve({ ok: false, error: 'benchmark timeout', progress }); }, 600000);
      const makeAudio = () => {
        if (!wav) {
          const audio = new Float32Array(320000);
          for (let i = 0; i < audio.length; i++) audio[i] = .03 * Math.sin(2 * Math.PI * 220 * i / 16000);
          return audio;
        }
        const bytes = Uint8Array.from(atob(wav), value => value.charCodeAt(0)), view = new DataView(bytes.buffer);
        let offset = 12;
        while (offset + 8 <= bytes.length && String.fromCharCode(...bytes.slice(offset, offset + 4)) !== 'data') offset += 8 + view.getUint32(offset + 4, true);
        if (offset + 8 > bytes.length) throw new Error('WAV data chunk not found');
        const samples = Math.min(320000, view.getUint32(offset + 4, true) / 2), audio = new Float32Array(samples);
        for (let i = 0; i < samples; i++) audio[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
        return audio;
      };
      const transcribe = () => {
        const audio = makeAudio();audioSeconds = audio.length / 16000;
        started = performance.now();
        worker.postMessage({ type: 'TRANSCRIBE', audio, id: run++, language: 'korean', model: mode === 'base-wasm' ? 'base' : 'small' }, [audio.buffer]);
      };
      worker.onmessage = ({ data }) => {
        if (data.type === 'PROGRESS') progress = data.data;
        if (data.type === 'READY') { transcribe(); return; }
        if (data.type === 'TRANSCRIBED') {
          const elapsed = performance.now() - started;inferenceMs.push(elapsed);rtf.push(elapsed / (audioSeconds * 1000));textLengths.push(String(data.text || '').trim().length);
          if (run < runs) { transcribe(); return; }
          clearTimeout(timeout); worker.terminate();
          resolve({ ok: true, mode, input: wav ? 'wav' : 'tone', audioSeconds, inferenceMs, rtf, textLengths });
          return;
        }
        if (data.type === 'ERROR') { clearTimeout(timeout); worker.terminate(); resolve({ ok: false, error: data.error, progress }); }
      };
      worker.onerror = event => { clearTimeout(timeout); worker.terminate(); resolve({ ok: false, error: event.message }); };
      worker.postMessage({ type: 'INIT', model: mode === 'base-wasm' ? 'base' : 'small' });
    }), { workerUrl: `chrome-extension://${id}/lib/${mode === 'base-wasm' ? 'whisper-worker.js' : 'whisper-webgpu-worker.js'}`, runs, mode, wav });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.mode, mode);
    console.log(`PASS real MV3 Whisper ${mode} throughput`, JSON.stringify(result));
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
