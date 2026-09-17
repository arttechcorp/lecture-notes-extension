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
// The note must read in lecture order: sections sorted by evidence time, each concept/formula/visual under the
// moment it is taught. Grouping by type again would put every formula after every section.
eval(js.slice(js.indexOf('function noteText'),js.indexOf('function renderNote')));
const ref=(id,t0)=>({id,t0,t1:t0+1});
const cite=(content,importance,evidenceIds)=>({content,importance,evidenceIds});
const note={title:'강의',evidenceRefs:[ref('a',10),ref('b',20),ref('c',30),ref('d',40)],
  keyConclusions:[cite('결론','critical',['c'])],
  sections:[{heading:'나중',content:'B',importance:'important',evidenceIds:['c']},{heading:'먼저',content:'A',importance:'critical',evidenceIds:['a']}],
  concepts:[cite('A개념','important',['b']),cite('B개념','reference',['d'])],
  formulas:[{latex:'X=1',explanation:'A수식',variables:'',units:'',conditions:'',importance:'important',evidenceIds:['b']}],
  visuals:[{type:'table',title:'B표',description:'',data:'| x |',importance:'important',evidenceIds:['d']}],
  reviewQuestions:[{question:'왜?',evidenceIds:['c']}]};
const order=x=>noteText(note).indexOf(x);
assert.ok(order('## 먼저')<order('## 나중'),'섹션은 강의 시간순으로 정렬한다');
for(const [inside,after] of [['A개념','## 나중'],['A수식','## 나중'],['X=1','## 나중']])
  assert.ok(order(inside)<order(after),`${inside}은(는) 해당 시점 섹션 안에 놓인다`);
for(const late of ['B개념','B표'])assert.ok(order(late)>order('## 나중'),`${late}은(는) 뒤 섹션에 놓인다`);
assert.ok(order('## 핵심 결론')<order('## 먼저')&&order('## 복습 질문')===Math.max(...['## 핵심 결론','## 먼저','## 나중','## 복습 질문'].map(order)),'핵심 결론은 앞, 복습 질문은 끝');
assert.doesNotMatch(noteText(note),/## 수식|## 표·관계·그래프/,'시간축 렌더에서는 종류별 묶음 제목을 쓰지 않는다');
// Legacy archives and partial results carry no evidenceRefs; they keep the old grouped layout instead of collapsing.
assert.match(noteText({...note,evidenceRefs:undefined}),/## 수식/);
assert.equal(noteText(null),'');
// 줄머리 [핵심] 배지는 제거했다. 중요도는 섹션 제목의 별표로만 남는다.
assert.doesNotMatch(noteText(note),/\[핵심\]/,'[핵심] 배지가 다시 붙었다');
assert.match(noteText(note),/## 먼저 ⭐/,'중요 섹션 표시(별표)까지 같이 사라졌다');
// The work indicator must exist and be driven by state, not left permanently visible.
assert.match(html,/id="working"[^>]*hidden[^>]*role="status"/);
assert.match(html,/노트 필기중\. 만약 노트가 생성되지 않았으면 다시 생성해주세요/);
assert.match(html,/@keyframes working-spin/);
assert.match(js,/function setWorking\(\)/);
assert.match(js,/s===['"]summarizing['"]/);
// 배속 인식 보정 is opt-in and must reach the session through START_SESSION options.
assert.match(js,/speedCorrection:settings\.speedCorrection===true/);
// Models omit the ```mermaid fence ~78% of the time; noteText's visual builder must wrap bare diagrams before rendering.
assert.match(js,/```mermaid/);
assert.match(js,/flowchart\|graph\|sequenceDiagram\|classDiagram\|stateDiagram/);
assert.doesNotMatch(js,/\$\{v\.data\?`\\n\\n\$\{v\.data\}`/,'visual 빌더가 v.data를 펜스 없이 그대로 꽂으면 안 된다');
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
console.log('panel: thin RPC adapter checks passed');
