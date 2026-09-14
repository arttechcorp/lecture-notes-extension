const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('sidepanel.html','utf8'),js=fs.readFileSync('sidepanel.js','utf8'),offscreenHtml=fs.readFileSync('offscreen.html','utf8'),background=fs.readFileSync('background.js','utf8'),manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
// The panel is display/control only; the offscreen document owns the lecture session and the
// service client, so it — not the panel — must load lib/service-client.js and lib/summary.js.
assert.doesNotMatch(html,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/summary\.js/);
assert.match(html,/OpenRouter API 키/);
assert.doesNotMatch(html,/id="(?:apiKey|provider|syncCb|planSelect|ocrEngineSelect)"/);
assert.doesNotMatch(js,/settings\.apiKey|allowRemoteOcr|callRemote\(|ServiceClient\./);
assert.match(js,/target:\s*['"]background['"]/);
assert.doesNotMatch(js,/URL\.createObjectURL|new Blob\(|buildTimeline\s*\(/);
assert.match(js,/!state\|\|s===['"]disposed['"]\)setStage\(['"]ready['"]\)/);
assert.match(html,/id="readyAlert"[^>]*role="alert"/);
assert.match(js,/\[els\.readyAlert,els\.panelAlert,els\.doneAlert\]/);
assert.match(html,/<details id="debugDetails">/);
assert.match(js,/state\?\.debug\?\.join/);
assert.match(js,/state\?\.recent/);
assert.equal(manifest.commands['open-capture-panel'].suggested_key.default,'Alt+Shift+S');
assert.match(html,/aria-describedby="capturePermissionHint"/);
assert.match(background,/Extension has not been invoked\|Chrome pages cannot be captured/);
assert.match(background,/Alt\+Shift\+S/);
for(const field of ['keyConclusions','formulas','visuals','reviewQuestions'])assert.match(js,new RegExp(field));
assert.match(html,/id="pdfBtn"/);assert.match(html,/id="notionBtn"/);assert.match(html,/id="popoutBtn"/);
assert.match(js,/pdfBtn.*addEventListener/);assert.match(js,/notionBtn.*addEventListener/);
console.log('panel: thin RPC adapter checks passed');
