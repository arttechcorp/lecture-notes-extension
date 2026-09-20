const test=require("node:test"),assert=require("node:assert/strict");
require("./evidence");require("./visual-gate");global.collapseRepeats=require("./repeats").collapseRepeats;const {CaptureSession,stretchAudio}=require("./session");const {AudioSegments}=require("./audio-segments");
function session(){global.document={createElement:()=>({currentTime:0,muted:true,srcObject:null})};return new CaptureSession({id:"s",generation:1,stream:{getTracks:()=>[]},options:{},emit:()=>{}});}
test("STOP captures final frame then drains once; disposal clears notes and texts",async()=>{const s=session();s.status="running";let captures=0,cleanups=0;s.captureVisual=async()=>{captures++;};s.cleanup=async()=>{s.closed=true;cleanups++;};const a=s.stop(),b=s.stop();assert.equal(a,b);await a;assert.equal(captures,1);assert.equal(cleanups,1);assert.equal(s.status,"completed");s.summary={title:"synthetic"};s.store.add({text:"private",time:0});await s.dispose();assert.equal(s.summary,null);assert.equal(s.store.items.length,0);});
test("late ASR result cannot mutate disposed session",()=>{const s=session();s.closed=true;s.asrBusy=true;s.onAsr({type:"TRANSCRIBED",text:"late"});assert.equal(s.store.items.length,0);});
test("diagnostic logs publish as soon as they are appended",()=>{let publishes=0;const s=new CaptureSession({id:"log",generation:1,stream:{getTracks:()=>[]},options:{},emit:()=>publishes++});s.log("[음성] 입력 연결됨");assert.equal(publishes,1);assert.match(s.state().debug.join("\n"),/입력 연결됨/);});
test("session state exposes only the latest three recognition lines",()=>{const s=session();for(const [source,text] of [["asr","음성 하나"],["ocr","화면 둘"],["asr","음성 셋"],["ocr","화면 넷"]])s.store.add({source,text,t0:s.store.items.length,t1:s.store.items.length+1});assert.deepEqual(s.state().recent.map(item=>[item.source,item.text]),[["ocr","화면 둘"],["asr","음성 셋"],["ocr","화면 넷"]]);});
test("ASR diagnostics expose throughput without logging transcript text",()=>{const empty=session();empty.status="running";empty.asrBusy=true;empty.activeAudio={time:2,t1:3,audioSeconds:1};empty.asrStartedAt=performance.now()-10;empty.onAsr({type:"TRANSCRIBED",text:""});assert.match(empty.state().debug.join("\n"),/인식 결과 없음/);assert.equal(empty.store.items.length,0);const spoken=session();spoken.status="running";spoken.asrBusy=true;spoken.audioQueue=[{audioSeconds:1.5}];spoken.activeAudio={time:3,t1:4,audioSeconds:1};spoken.asrStartedAt=performance.now()-10;spoken.onAsr({type:"TRANSCRIBED",text:"private lecture words"});const debug=spoken.state().debug.join("\n");assert.match(debug,/인식 완료 · 캡처 1\.0초 · 추론 [\d.]+초 · RTF [\d.]+ · 대기 1건 · 1\.5초/);assert.doesNotMatch(debug,/private lecture words/);assert.equal(spoken.store.items.length,1);const failed=session();failed.status="running";failed.asrBusy=true;failed.audioQueue=[{audioSeconds:2}];failed.activeAudio={time:4,t1:5,audioSeconds:1};failed.asrStartedAt=performance.now()-10;failed.fail=()=>{};failed.onAsr({type:"ERROR",error:"synthetic failure"});assert.match(failed.state().debug.join("\n"),/Whisper 오류 · 캡처 1\.0초 · 추론 [\d.]+초 · RTF [\d.]+ · 대기 1건 · 2\.0초/);});
test("STOP cancels pending model preparation without waiting for its timeout",async()=>{const {timeout}=require('./session');const s=session();const pending=timeout(new Promise(()=>{}),90000,'model timeout',s.startController.signal);const assertion=assert.rejects(pending,/취소/);await s.stop();await assertion;assert.ok(s.closed);});
test("voice segmentation flushes tail and splits before unbounded growth",()=>{const jobs=[];const a=new AudioSegments(j=>jobs.push(j));for(let i=0;i<300;i++)a.push(new Float32Array(1600).fill(.1),i/10,0,1);a.flush();assert.ok(jobs.length>=2);assert.equal(jobs[0].audio.length,29*16000);assert.ok(jobs[1].audio.length>16000);assert.ok(a.length===0);});
test("voice at the 29-second ceiling is emitted",()=>{const jobs=[];const a=new AudioSegments(j=>jobs.push(j));for(let i=0;i<290;i++)a.push(new Float32Array(1600).fill(.01),i/10,0,1);assert.equal(jobs.length,1);assert.equal(jobs[0].audio.length,29*16000);});
test("audio normalization raises quiet speech without clipping",()=>{const {normalizeAudio}=require("./session");const audio=new Float32Array([.01,-.01]);normalizeAudio(audio);assert.ok(Math.abs(audio[0]-.1)<1e-6);assert.ok(Math.abs(audio[1]+.1)<1e-6);});
test("auto Whisper language is Korean-first instead of the library English default",()=>{const {whisperLanguage}=require("./session");assert.equal(whisperLanguage("auto"),"korean");assert.equal(whisperLanguage("ko"),"korean");assert.equal(whisperLanguage("en"),"english");});
test("audio-only start fails honestly if the tab has no audio",async()=>{global.document={createElement:()=>({currentTime:0,muted:true,srcObject:null,videoWidth:1280,play:async()=>{}})};const s=new CaptureSession({id:"screen",generation:1,stream:{getTracks:()=>[],getAudioTracks:()=>[]},options:{ocrEnabled:false,whisperEnabled:true},emit:()=>{}});await assert.rejects(s.start(),/오디오가 없습니다/);assert.equal(s.status,"failed");assert.ok(s.closed);});
test("rate changes flush the previous audio clock mapping",()=>{const s=session();s.metadata={rate:1,paused:false};let flushes=0;s.segments={flush:()=>flushes++};s.updateMetadata({rate:2,paused:false,epoch:0});assert.equal(flushes,1);});
test("silent pre-roll clock begins at the retained samples",()=>{const a=new AudioSegments(()=>{});for(let i=0;i<10;i++)a.push(new Float32Array(1600),i/10,0,1);assert.ok(Math.abs(a.start-.6)<1e-9);});
test("partially clipped video is rejected instead of remapping its ROI",()=>{const s=session();s.video.videoWidth=1280;s.video.videoHeight=720;s.metadata={box:{x:-.1,y:0,w:.8,h:.8},videoAspect:16/9};s.options.rect={x:0,y:0,w:.5,h:1};assert.throws(()=>s.rect(),/영상 전체가 보이도록/);});
test("배속 보정은 원래 길이를 복원하고 Whisper의 30초 한도를 넘기지 않는다",()=>{
  const tone=new Float32Array(16000*10).map((_,i)=>Math.sin(i/16));
  assert.equal(stretchAudio(tone,1),tone,"1배속이면 원본을 그대로 넘긴다");
  for(const rate of [1.5,2,3]){
    const out=stretchAudio(tone,rate);
    assert.equal(out.length,Math.min(Math.round(tone.length*rate),16000*30),`${rate}배속에서 길이가 ${rate}배로 늘어난다`);
    assert.ok(out.every(Number.isFinite));
  }
  // 보정을 켜면 청크 상한이 배속에 맞춰 줄어야 늘린 뒤에도 30초 안에 들어온다.
  for(const rate of [1,1.5,2,3,4]){
    const jobs=[],segments=new AudioSegments(job=>jobs.push(job),16000,true);
    for(let i=0;i<Math.round(300/rate*10);i++)segments.push(new Float32Array(1600).fill(.1),i/10*rate,0,rate);
    segments.flush();
    for(const job of jobs)assert.ok(stretchAudio(job.audio,job.rate).length<=16000*30,`${rate}배속 청크가 보정 후에도 30초 이내다`);
    assert.ok(jobs.every(job=>Math.round(job.audio.length*job.rate)<=16000*30),`${rate}배속에서 잘려나가는 구간이 없다`);
  }
});
test("느린 기기의 인식 백로그는 세션을 죽이지 않고 구간을 건너뛴다",()=>{
  const s=session();
  s.audioContext={sampleRate:16000};s.metadata={rate:1};s.options.whisperModel="small-webgpu";
  let failed=false;s.fail=()=>{failed=true;};s.processAudio=()=>{};
  // 워커가 한 건도 끝내지 못하는 최악의 기기: 큐만 쌓인다.
  s.asrBusy=true;s.activeAudio={audioSeconds:29};s.asrStartedAt=performance.now();
  for(let i=0;i<10;i++)s.enqueueAudio({audio:new Float32Array(16000).fill(.1),time:i*29,t1:i*29+29,epoch:0,rate:1});
  assert.equal(failed,false,"백로그로 세션을 중단하지 않는다");
  assert.ok(s.audioQueue.length<=4,`큐가 무한히 자라지 않는다 (현재 ${s.audioQueue.length})`);
  assert.ok(s.dropped>0,"건너뛴 구간을 센다");
  assert.ok(s.gaps.some(gap=>gap.reason==="audio-capacity"),"건너뛴 구간을 gap으로 남긴다");
  assert.match(s.state().debug.join("\n"),/인식이 밀려/);
  // 가장 오래된 구간을 버리므로 큐에는 최신 구간이 남는다.
  assert.ok(s.audioQueue.at(-1).time>s.audioQueue[0].time);
});
test("video scrolled out of view skips the frame mid-capture but refuses at start",async()=>{
  const s=session();s.status="running";s.video={videoWidth:1280,videoHeight:720};
  // 플레이어가 헤더 뒤로 절반 가려진 상태. 캡처된 픽셀에 그 부분은 없다.
  s.metadata={time:10,rate:1,paused:false,epoch:0,box:{x:0,y:-0.2,w:1,h:0.6},videoAspect:16/9};
  let failed=null;s.fail=message=>{failed=message;};
  s.lastSample=-1e6; // performance.now()는 프로세스 시작 기준이라 500ms 간격 게이트에 걸린다
  await s.captureVisual();
  assert.equal(failed,null,"스크롤 한 번에 세션이 죽는다 — 프레임만 건너뛰어야 한다");
  assert.equal(s.status,"running");
  assert.match(s.state().debug.join("\n"),/창 밖으로 나가 프레임을 건너뜁니다/,"건너뛴 사실을 알리지 않는다");
  assert.equal(s.state().gaps.at(-1).reason,"video-offscreen","건너뛴 구간이 공백으로 기록되지 않는다");
  // 같은 상태가 이어져도 로그를 도배하지 않는다.
  const lines=s.state().debug.length;s.lastSample=-1e6;await s.captureVisual();
  assert.equal(s.state().debug.length,lines,"매 프레임 같은 줄을 반복해 찍는다");
  // 시작 시점(force)에는 거부한다 — 반쪽짜리 슬라이드를 OCR에 넣으면 안 된다.
  await assert.rejects(()=>s.captureVisual(true),/영상 전체가 보이도록/);
});

test("Whisper 반복 루프는 근거에 저장되기 전에 접힌다",()=>{
  const s=session();s.status="running";s.asrBusy=true;s.audioQueue=[];
  s.activeAudio={time:5,t1:6,audioSeconds:1};s.asrStartedAt=performance.now()-10;
  s.onAsr({type:"TRANSCRIBED",text:"제가 얘기하면 ".repeat(140).trim()});
  assert.equal(s.store.items.length,1);
  assert.equal(s.store.items[0].text,"제가 얘기하면 제가 얘기하면");
  const debug=s.state().debug.join(" ");
  assert.match(debug,/반복 루프/);
  assert.doesNotMatch(debug,/제가 얘기하면/);
});

const visionSession = (id, options) => {
  global.document = { createElement: () => ({ currentTime: 0, muted: true, srcObject: null, videoWidth: 1280, videoHeight: 720, play: async () => {} }) };
  return new CaptureSession({
    id, generation: 1,
    stream: { getTracks: () => [], getAudioTracks: () => [] },
    options: { ocrEnabled: true, ocrEngine: 'vision-cloud', ...options },
    emit: () => {},
  });
};

test("vision sessions refuse to start without consent instead of falling back to local", async () => {
  const s = visionSession("s1", { visionConsent: false, serviceUrl: "https://service.example", appSessionToken: "x".repeat(40) });
  await assert.rejects(s.start(), /동의/, "조용히 로컬 인식으로 바꾸지 않는다 — 사용자가 켠 것과 다른 일을 하는 셈이다");
  assert.equal(s.status, "failed");
});

test("vision sessions refuse to start without a service connection", async () => {
  const s = visionSession("s2", { visionConsent: true, serviceUrl: "", appSessionToken: "" });
  await assert.rejects(s.start(), /서비스 연결/);
});
