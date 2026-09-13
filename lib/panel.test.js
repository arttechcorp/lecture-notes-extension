const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('sidepanel.html','utf8'),js=fs.readFileSync('sidepanel.js','utf8'),offscreenHtml=fs.readFileSync('offscreen.html','utf8');
// The panel is display/control only; the offscreen document owns the lecture session and the
// service client, so it — not the panel — must load lib/service-client.js and lib/summary.js.
assert.doesNotMatch(html,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/summary\.js/);
assert.match(html,/서비스 URL과 앱 세션 토큰/);
assert.doesNotMatch(html,/id="(?:apiKey|provider|syncCb|planSelect|ocrEngineSelect)"/);
assert.doesNotMatch(js,/settings\.apiKey|allowRemoteOcr|callRemote\(|ServiceClient\./);
assert.match(js,/target:\s*['"]background['"]/);
assert.doesNotMatch(js,/URL\.createObjectURL|new Blob\(|buildTimeline\s*\(/);
assert.match(html,/id="pdfBtn"/);assert.match(html,/id="notionBtn"/);assert.match(html,/id="popoutBtn"/);
assert.match(js,/pdfBtn.*addEventListener/);assert.match(js,/notionBtn.*addEventListener/);
console.log('panel: thin RPC adapter checks passed');
