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
assert.match(html,/id="popoutBtn"/);
// v2: 패널은 노트를 직접 렌더하지 않는다 — 노트는 암호화 파일로 저장돼 웹사이트 보관함에서만 연다.
// 미리보기·내보내기·보관함 UI는 완료 화면에서 빠졌고, 저장 상태·고지·생성 옵션이 대신한다.
assert.doesNotMatch(js,/noteText|type:'RENDER'|type:'PRINT'|pdfRatio|lecture_notes_pdf_ratio|THEME/);
assert.doesNotMatch(js,/NoteExport|NoteLibrary|PRINT_|SAVE_VAULT|LOAD_VAULT|LIST_VAULT|DELETE_VAULT|openNote|lastPackageId/);
assert.doesNotMatch(html,/vaultPassphrase/);
assert.doesNotMatch(html,/notionBtn/);
assert.doesNotMatch(html,/viewRawBtn/);
assert.doesNotMatch(html,/마크다운 편집/);
assert.doesNotMatch(html,/id="(?:result|resultHint|exportRow|viewRenderedBtn|pdfBtn|notionModal|saveVaultBtn|loadVaultBtn|deleteVaultBtn|refreshVaultBtn|vaultList|libraryBtn|openNoteBtn|rawEvidence|rawScript|engineDetail)"/);
assert.doesNotMatch(html,/lib\/library\.js|lib\/note-export\.js/);
assert.match(html,/id="saveBox"/);assert.match(html,/id="genBox"/);assert.match(html,/id="doneNotices"/);
assert.match(html,/id="recognitionBox"/);assert.match(html,/id="makeNoteBtn"/);
assert.match(js,/function renderSaved\(/);
assert.match(js,/type:'RENDER_RECOGNITION'/);
assert.match(js,/type:'LIB_REGENERATE'/);
assert.match(js,/type:'LIB_EXPORT_ALL'/);
assert.match(js,/type:'LIB_SHOW'/);
assert.match(js,/Account\.SITE\+['"]\/library['"]/);
assert.match(js,/openOnboarding\(\['passphrase'\]\)/);
assert.match(js,/openOnboarding\(\['consent'\]\)/);
assert.match(js,/NOTE_CLAIMS_UNSUPPORTED|NOTE_AUGMENTED/);
assert.match(js,/CONSENT_/);
assert.doesNotMatch(js,/summarySettingsBtn/);assert.doesNotMatch(html,/summarySettingsBtn|OpenRouter/);
// 보관함 키·파일 암호화만 패널에 남는다 — 두 라이브러리가 패널 앞에 로드돼야 한다.
assert.match(html,/<script src="lib\/package-store\.js"><\/script>\s*<script src="lib\/note-file\.js"><\/script>\s*<script src="sidepanel\.js">/);
assert.match(html,/id="bgSave"/);assert.match(html,/id="bgBar"/);assert.match(html,/id="bgTime"/);
assert.match(html,/id="bgConsentBtn"/);assert.match(html,/id="bgMakeBtn"/);assert.match(html,/id="bgDiscardBtn"/);assert.match(html,/id="bgBilling"/);assert.match(html,/id="bgSummaryLink"/);
assert.doesNotMatch(html,/id="bgNoteBtn"|id="bgOptionsLink"/);
// The work indicator must exist and be driven by state, not left permanently visible.
assert.match(html,/id="working"[^>]*hidden[^>]*role="status"/);
assert.match(html,/id="workingText"/);
assert.match(html,/노트를 만드는 중입니다\. 몇 분 걸릴 수 있습니다\./);
assert.match(js,/남은 인식을 마무리하는 중입니다\./);
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
// 준비 카드의 계정·노트 저장 행(계정은 이메일·플랜·이번 달 사용량 또는 로그인 버튼, 노트 저장은 보관함 암호 상태).
assert.match(html,/id="markAccount"/);assert.match(html,/id="accountState"/);assert.match(html,/id="accountLoginBtn"/);
assert.match(html,/id="markStore"/);assert.match(html,/id="storeState"/);assert.match(html,/id="storePassBtn"/);
assert.match(js,/function updateReadyRows\(/);
// 확장 메뉴와 랜딩 메뉴는 같은 "내 노트 (웹)" 항목을 같은 자리(사용자 정보 다음)에 둔다(memory.md 계정 메뉴 결합).
const accountMenu=fs.readFileSync('landing/account-menu.js','utf8');
assert.match(html,/data-path="\/account">사용자 정보<\/button>\s*<button role="menuitem" type="button" data-path="\/library">내 노트 \(웹\)</);
assert.match(accountMenu,/link\("사용자 정보",\s*"\/account"\),\s*link\("내 노트 \(웹\)",\s*"\/library"\)/);
// 세션이 없으면 상태 줄은 비운다 — "세션 없음"은 보여 주지 않는다.
assert.doesNotMatch(js,/세션 없음/);
// START_SESSION options에 선택한 탭 제목을 최대 200자로 잘라 싣는다.
assert.match(js,/options:\{tabId:Number\(els\.tabSelect\.value\),pageTitle:[^,}]*\.slice\(0,\s*200\)/);
// 재생성(LIB_REGENERATE) 마무리: 노트가 나오면 인식 미리보기 상태를 지워 프레임·인식 상자를 숨긴다.
assert.match(js,/sum\.recognition=null/);
// 재생성 실패는 setError 직접 호출이 아니라 세션 오류 경로(state.error → render → doneAlertExtras)를 탄다.
assert.doesNotMatch(js,/setError\(r\?\.error/);
assert.match(js,/state\.error=message;render\(state\)/);
// partial 재생성은 알약이 '노트 완성'이 아니라 '일부 완료'다.
assert.match(js,/donePill\.textContent=r\.status==='partial'\?'일부 완료'/);
// '노트를 만드는 중' 문구는 요약·재생성 전용이다 — 일반 busy(start/stop)에는 쓰지 않는다.
assert.doesNotMatch(js,/making=busy/);
assert.match(js,/making=regenBusy\|\|s==='summarizing'/);
// 실시간 캡처의 인식 모드는 요금제가 고른다 — free만 온디바이스, 나머지는 클라우드 인식 동의를 거친 서버 인식.
assert.match(js,/cloudMode=\(\)=>obPlan!=='free'&&cloudRecognitionAllowed\(settings\)/);
assert.match(js,/recognition:cloud\?'cloud':'local'/);
assert.match(js,/ocrEngine:cloud\?'vision-cloud'/);
assert.match(js,/paid&&!cloudRecognitionAllowed\(settings\)/);
assert.match(js,/화면 인식 · 서버 \(고화질\)/);
assert.match(js,/음성 인식 · 서버/);
assert.match(html,/id="ocrField"/);
// 인증이 끊긴 응답 코드에는 오류 알림에 로그인 버튼을 단다.
assert.match(js,/\['AUTH_REQUIRED','unauthorized','token_expired'\]/);
// 노트 생성 실패는 깨끗한 실패 상태다 — '노트 실패' 알약과 다시 시도 버튼, '노트 준비됨'은 뜨지 않는다.
assert.match(js,/summaryFailed=/);
assert.match(js,/노트 실패/);
assert.match(html,/id="retryNoteBtn"/);
// 말소리 받아쓰기는 기본 켜짐 — 온보딩 체크박스는 설정 기본값(true)을 따른다.
assert.match(html,/id="obWhisper" checked/);
assert.match(js,/steps\.includes\('engine'\)\)els\.obWhisper\.checked=settings\?\.whisperEnabled/);
// 준비 카드(로컬 모드): 음성이 꺼져 있으면 '꺼짐'이 아니라 경고로 시작 전에 알린다.
assert.match(js,/settings\.whisperEnabled\?'ok':'warn'/);
assert.match(js,/꺼짐 — 음성은 기록되지 않습니다/);
// 설정 서랍의 받아쓰기 토글: 변경 즉시 저장하고 준비 카드를 고친다. 클라우드 모드에서는 OCR 행처럼 숨긴다.
assert.match(html,/id="whisperField"/);
assert.match(html,/id="whisperEnabledToggle"/);
assert.match(js,/whisperField\.hidden=cloud/);
assert.match(js,/saveSettings\(\{whisperEnabled:els\.whisperEnabledToggle\.checked\}\)/);
// 영역 지정 검사는 클라우드 모드(OCR 토글이 숨겨지는 곳)에서도 걸린다.
assert.match(js,/\(cloud\|\|els\.ocrEnabledToggle\.checked\)&&els\.modeSelect\.value==='region'/);
// 인증 오류 로그인 버튼: 같은 문구를 코드 없이 다시 그려도 마지막 코드를 기억해 버튼을 유지한다.
assert.match(js,/lastAuth=\{text:'',code:''\}/);
// 로그인 직후 준비 카드 전체를 고친다 — 서버 인식 행으로 바로 갈아탄다.
assert.match(js,/await obCheck\(rec\);s=Date.now\(\);setError\(''\);updateReadyCard\(\)/);
// 유료 서버 인식은 선택이 아니라 필수다.
assert.match(html,/\[유료\] 서버 인식/);
assert.doesNotMatch(html,/\[유료·선택\] 클라우드 인식/);
// 온보딩이 떠도 설정 서랍을 hidden으로 숨기지 않는다 — 열려 있으면 close()로 닫는다. 숨긴 <dialog>에 showModal하면 보이지 않는 모달이 패널을 얼린다.
assert.doesNotMatch(js,/settingsDrawer\.hidden\s*=/);
assert.match(js,/els\.settingsDrawer\.open\)els\.settingsDrawer\.close\(\)/);
// 캡처 영역 기본값은 영상 전체다 — 영역 지정은 슬라이드만 자를 때 고르는 옵션.
assert.match(html,/<select id="modeSelect">\s*<option value="slide"[^>]*>영상 전체<\/option>\s*<option value="region">영역 지정 \(슬라이드만\)<\/option>\s*<option value="caption">하단 자막 띠<\/option>/);
// 음성 인식 언어의 첫(기본) 옵션은 자동 감지다.
assert.match(html,/<select id="langSelect">\s*<option value="auto" selected>자동 감지/);
// 보관함 PIN은 확인 입력 없는 숫자 4자리 한 칸이다.
assert.doesNotMatch(html,/id="obPass2"/);
assert.doesNotMatch(js,/obPass2/);
assert.match(html,/id="obPass" type="password" inputmode="numeric" pattern="\[0-9\]\{4\}" maxlength="4" autocomplete="off"/);
assert.match(js,/\^\\d\{4\}\$\//);
assert.match(js,/숫자 4자리를 입력하세요\./);
// 시작 버튼 아래 안내는 인식 경로에 따라 갈린다 — 클라우드 모드면 서비스 인식 문구.
assert.match(html,/id="legalLine"/);
assert.match(html,/화면·음성 인식은 기기 안에서 하고, 노트는 로그인한 계정으로 Summrizei 서비스가 만듭니다\./);
assert.match(js,/화면·음성은 Summrizei 서비스에서 인식하고 저장하지 않습니다\. 노트도 로그인한 계정으로 서비스가 만듭니다\./);
assert.match(js,/화면·음성 인식은 기기 안에서 하고, 노트는 로그인한 계정으로 Summrizei 서비스가 만듭니다\./);
// 재생 중인 강의의 목록 찾기: scripting 권한으로 각 프레임(iframe 포함)의 리소스 기록을 먼저 스캔하고, 못 찾으면 webRequest 관찰로 넘어간다.
assert.ok(manifest.permissions.includes('scripting'));
assert.match(js,/chrome\.scripting\.executeScript\(\{target:\{tabId,allFrames:true\},func:\(\)=>performance\.getEntriesByType\('resource'\)\.map\(e=>e\.name\)\}\)/);
assert.match(js,/영상 목록\(HLS\)을 찾지 못했습니다\. 영상을 처음 위치로 되감거나 새로고침해 재생한 뒤 다시 시도하세요\./);
assert.match(js,/DASH 방식이라 아직 백그라운드 처리를 지원하지 않습니다\. 실시간 캡처를 쓰세요\./);
assert.match(js,/MP4 파일 방식이라 아직 백그라운드 처리를 지원하지 않습니다\. 실시간 캡처를 쓰세요\./);
console.log('panel: thin RPC adapter checks passed');
