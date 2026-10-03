const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('sidepanel.html','utf8'),js=fs.readFileSync('sidepanel.js','utf8'),offscreenHtml=fs.readFileSync('offscreen.html','utf8'),background=fs.readFileSync('background.js','utf8'),manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
// The panel is display/control only; the offscreen document owns the lecture session and the v2
// note pipeline, so it — not the panel — must load the service client and the note stages.
assert.doesNotMatch(html,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/service-client\.js/);
assert.match(offscreenHtml,/lib\/note-contract\.js/);
assert.match(offscreenHtml,/lib\/stages\.js/);
assert.doesNotMatch(offscreenHtml,/lib\/summary\.js|lib\/openrouter-client\.js/);
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
assert.match(html,/id="pdfBtn"/);assert.match(html,/id="notionBtn"/);assert.match(html,/id="popoutBtn"/);
assert.match(js,/pdfBtn.*addEventListener/);assert.match(js,/notionBtn.*addEventListener/);
// v2: 패널은 노트를 직접 렌더하지 않는다 — 마크다운·비율·테마 전달은 v1 경로다.
assert.doesNotMatch(js,/noteText|type:'RENDER'|type:'PRINT'|pdfRatio|lecture_notes_pdf_ratio|THEME/);
assert.match(js,/type:'RENDER_NOTE'|type:"RENDER_NOTE"/);
assert.match(js,/type:'RENDER_RECOGNITION'/);
assert.match(js,/NoteExport\.toMarkdown/);
assert.match(js,/NoteLibrary\.cropUrls/);
assert.doesNotMatch(js,/summarySettingsBtn/);assert.doesNotMatch(html,/summarySettingsBtn|OpenRouter/);
// 노트·인식 데이터는 보관함 스토어와 Markdown 내보내기로 나간다 — 두 라이브러리가 패널 앞에 로드돼야 한다.
assert.match(html,/<script src="lib\/package-store\.js"><\/script>\s*<script src="lib\/note-file\.js"><\/script>\s*<script src="lib\/library\.js"><\/script>\s*<script src="lib\/note-export\.js"><\/script>\s*<script src="sidepanel\.js">/);
assert.match(html,/id="libraryBtn"/);assert.match(html,/id="openNoteBtn"/);assert.match(html,/id="bgNoteBtn"/);
// The work indicator must exist and be driven by state, not left permanently visible.
assert.match(html,/id="working"[^>]*hidden[^>]*role="status"/);
assert.match(html,/노트 필기중\. 만약 노트가 생성되지 않았으면 다시 생성해주세요/);
assert.match(html,/@keyframes working-spin/);
assert.match(js,/function setWorking\(\)/);
assert.match(js,/s===['"]summarizing['"]/);
// 배속 인식 보정 is opt-in and must reach the session through START_SESSION options.
assert.match(js,/speedCorrection:settings\.speedCorrection===true/);
// 캡처가 끝나 completed 로 넘어가면 요약이 자동으로 이어져야 한다 — 요약 화면이 비어 뜨던 자리다.
const active=s=>['preparing','running','paused','draining','summarizing'].includes(s?.status);
eval(js.slice(js.indexOf('function shouldAutoSummarize'),js.indexOf("let autoSummaryKey")));
const done=extra=>({status:'completed',counts:{visual:3,audio:2},...extra});
assert.ok(shouldAutoSummarize('draining',done()),'캡처를 마치면 요약을 자동으로 건다');
assert.ok(!shouldAutoSummarize('draining',done({summary:{sections:[]}})),'이미 노트가 있으면 다시 걸지 않는다');
assert.ok(!shouldAutoSummarize('summarizing',done({error:'실패'})),'실패한 요약을 자동으로 되돌리지 않는다');
assert.ok(!shouldAutoSummarize('draining',done({counts:{visual:0,audio:0}})),'인식 자료가 없으면 걸지 않는다');
assert.ok(!shouldAutoSummarize(undefined,done()),'패널을 열자마자 이전 세션을 다시 요약하지 않는다');
assert.ok(!shouldAutoSummarize('completed',done()),'보관본 불러오기처럼 캡처를 거치지 않은 전이는 제외한다');
// 요약 중에는 캡처 화면이 아니라 노트 화면에 진행 표시가 떠야 한다.
assert.ok(js.includes("active(state)&&s!=='summarizing')setStage('live')"),"요약 중에는 노트 화면을 유지해야 한다");
// 계정 메뉴: 햄버거 + 메뉴 패널, 로그인용 identity 권한. 설정 링크는 메뉴로 대체됐다.
assert.match(html,/id="menuBtn"[^>]*aria-haspopup="menu"/);
assert.match(html,/id="accountMenu"[^>]*role="menu"|role="menu"[^>]*id="accountMenu"/);
assert.match(html,/<script src="lib\/account\.js"><\/script>/);
assert.ok(manifest.permissions.includes('identity'));
assert.doesNotMatch(js,/settingsLink/);
assert.doesNotMatch(html,/id="settingsLink"/);
console.log('panel: thin RPC adapter checks passed');
