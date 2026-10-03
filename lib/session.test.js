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

const { EventBus } = require("./events");
function busSession(){global.document={createElement:()=>({currentTime:0,muted:true,srcObject:null})};const bus=new EventBus();return {bus,s:new CaptureSession({id:"s",generation:1,stream:{getTracks:()=>[]},options:{},emit:()=>{},events:bus})};}

test("log() mirrors a diagnostic onto the event bus",()=>{
  const {s,bus}=busSession();
  s.log("synthetic diagnostic");
  const e=bus.recent().at(-1);
  assert.equal(e.stage,"capture");assert.equal(e.jobId,"s");assert.equal(e.level,"info");assert.equal(e.msg,"synthetic diagnostic");
});

test("transcript text never reaches the event stream",()=>{
  const {s,bus}=busSession();
  s.status="running";s.asrBusy=true;s.audioQueue=[];s.activeAudio={time:3,t1:4,audioSeconds:1};s.asrStartedAt=performance.now()-10;
  s.onAsr({type:"TRANSCRIBED",text:"private lecture words"});
  assert.ok(!JSON.stringify(bus.recent()).includes("private lecture words"));
});

test("a failing OCR job ends its span as failed",async()=>{
  const {s,bus}=busSession();
  s.ocr={recognize:async()=>{throw new Error("boom");}};s.fail=()=>{};
  s.imageQueue.push({blob:{},bytes:100,time:1,t1:1,epoch:0,sample:{},slideId:3});
  await s.processImages();
  const spans=bus.recent().filter(e=>e.stage==="ocr");
  assert.equal(spans[0].status,"running");assert.equal(spans[0].unit,"slide-3");assert.equal(spans[0].jobId,"s");
  const last=spans.at(-1);
  assert.equal(last.status,"failed");assert.equal(last.code,"OCR_FAILED");assert.equal(last.level,"error");assert.equal(last.spanId,spans[0].spanId);
});

test("a successful OCR job ends its span as done with bytes",async()=>{
  const {s,bus}=busSession();
  s.ocr={recognize:async()=>({data:{text:"x",confidence:90}})};s.gate={complete(){}};
  s.imageQueue.push({blob:{},bytes:100,time:1,t1:1,epoch:0,sample:{},slideId:3});
  await s.processImages();
  const last=bus.recent().filter(e=>e.stage==="ocr").at(-1);
  assert.equal(last.status,"done");assert.equal(last.bytes,100);
});

test("ASR job spans run, finish on TRANSCRIBED and fail on ERROR",()=>{
  const {s,bus}=busSession();
  s.status="running";s.asr={postMessage(){}};s.audioContext={sampleRate:16000};s.metadata={rate:1};
  s.audioQueue=[{audio:new Float32Array(16000),time:5,t1:6,epoch:0,rate:1}];
  s.processAudio();
  const running=bus.recent().filter(e=>e.stage==="asr").at(-1);
  assert.equal(running.status,"running");assert.equal(running.unit,"t5");assert.equal(running.jobId,"s");
  s.onAsr({type:"TRANSCRIBED",text:"ok"});clearTimeout(s.asrTimer);
  assert.equal(bus.recent().filter(e=>e.stage==="asr").at(-1).status,"done");
  const {s:s2,bus:bus2}=busSession();
  s2.status="running";s2.asr={postMessage(){}};s2.audioContext={sampleRate:16000};s2.metadata={rate:1};s2.fail=()=>{};
  s2.audioQueue=[{audio:new Float32Array(16000),time:7,t1:8,epoch:0,rate:1}];
  s2.processAudio();s2.onAsr({type:"ERROR",error:"x"});clearTimeout(s2.asrTimer);
  const last=bus2.recent().filter(e=>e.stage==="asr").at(-1);
  assert.equal(last.status,"failed");assert.equal(last.code,"ASR_FAILED");
});

test("cleanup() skips an open ASR span",async()=>{
  const {s,bus}=busSession();
  s.status="running";s.asr={postMessage(){},terminate(){}};s.audioContext={sampleRate:16000,close:async()=>{}};s.metadata={rate:1};
  s.audioQueue=[{audio:new Float32Array(16000),time:5,t1:6,epoch:0,rate:1}];
  s.processAudio();await s.cleanup();clearTimeout(s.asrTimer);
  assert.equal(bus.recent().filter(e=>e.stage==="asr").at(-1).status,"skipped");
});

test("fail() emits a capture failure without the error text",async()=>{
  const {s,bus}=busSession();
  s.status="running";
  await s.fail("sensitive failure reason");
  const failed=bus.recent().filter(e=>e.code==="SESSION_FAILED");
  assert.equal(failed.length,1);assert.equal(failed[0].status,"failed");assert.equal(failed[0].level,"error");
  assert.ok(!JSON.stringify(bus.recent()).includes("sensitive failure reason"));
});

test("a session without events still logs and fails",async()=>{
  const s=session();
  s.log("no bus");await s.fail("boom");
  assert.equal(s.status,"failed");assert.match(s.debug.join("\n"),/no bus/);
});

// 로컬 Whisper 는 세그먼트 점수가 없어 청크 RMS 로만 환각을 가른다. enqueueAudio 가 잰 값이 onAsr 까지 실제 흐름으로 가야 한다.
function asrChunk(fill,text,make=session){
  const s=make();s.status="running";s.asr={postMessage(){}};s.audioContext={sampleRate:16000};s.metadata={rate:1};
  s.enqueueAudio({audio:new Float32Array(16000).fill(fill),time:5,t1:6,epoch:0,rate:1});
  s.onAsr({type:"TRANSCRIBED",text});clearTimeout(s.asrTimer);return s;
}
test("무음 수준 청크의 알려진 환각 문구는 저장하지 않고 본문 없이 제외했다고만 남긴다",()=>{
  const {s,bus}=busSession(),phrase="시청해주셔서 감사합니다";
  asrChunk(.001,phrase,()=>s);
  assert.equal(s.store.items.length,0);assert.equal(s.counts.audio,0);
  const debug=s.state().debug.join("\n");
  assert.match(debug,/무음 구간 환각 문구 제외/);assert.doesNotMatch(debug,/시청해|감사합니다/);
  assert.ok(!JSON.stringify(bus.recent()).includes(phrase));
  assert.equal(bus.recent().filter(e=>e.stage==="asr").at(-1).status,"done");
});
test("발화 수준 청크의 같은 문구는 진짜 발화이므로 저장한다",()=>{
  const s=asrChunk(.1,"시청해주셔서 감사합니다");
  assert.equal(s.store.items.length,1);assert.equal(s.store.items[0].text,"시청해주셔서 감사합니다");assert.doesNotMatch(s.state().debug.join("\n"),/환각 문구 제외/);
});
test("무음 수준 청크라도 알려진 문구가 아닌 강의 문장은 저장한다",()=>{
  const s=asrChunk(.001,"오늘은 푸리에 변환의 성질을 살펴보겠습니다");
  assert.equal(s.store.items.length,1);assert.equal(s.counts.audio,1);
});
test("청크 음량이 없거나 유한하지 않으면 환각 필터를 걸지 않는다",()=>{
  for(const rms of [undefined,null,NaN]){
    const s=session();s.status="running";s.asrBusy=true;s.audioQueue=[];s.activeAudio={time:5,t1:6,audioSeconds:1,rms};s.asrStartedAt=performance.now()-10;
    s.onAsr({type:"TRANSCRIBED",text:"시청해주셔서 감사합니다"});
    assert.equal(s.store.items.length,1,`rms=${rms}`);
  }
});

// 로그인 토큰은 1시간이면 만료된다. 오프스크린이 getToken을 주면 비전 엔진은 문자열 대신 그 함수를 받아 호출마다 새 토큰을 쓴다.
test("vision engine gets the token getter when given, and the plain string otherwise", async () => {
  let captured;
  const previous = global.VisionClient;
  global.VisionClient = { createVisionEngine: options => { captured = options; throw new Error("엔진 생성은 여기까지만 확인한다"); } };
  try {
    const getToken = async () => "fresh-token";
    const base = { visionConsent: true, serviceUrl: "https://service.example", appSessionToken: "x".repeat(40) };
    await assert.rejects(visionSession("t1", { ...base, getToken }).start(), /여기까지만/);
    assert.equal(captured.token, getToken, "함수를 그대로 넘긴다 - 호출 때마다 새 토큰");
    assert.equal(await captured.token(), "fresh-token");
    assert.equal(captured.baseUrl, "https://service.example");
    await assert.rejects(visionSession("t2", base).start(), /여기까지만/);
    assert.equal(captured.token, "x".repeat(40), "getToken이 없으면 예전처럼 문자열 토큰");
  } finally {
    if (previous === undefined) delete global.VisionClient; else global.VisionClient = previous;
  }
});

// 서버 STT 경로는 Worker 없이 같은 청크 흐름을 쓴다 — 같은 정규화 PCM을 WAV로 감싸 서비스로 보낼 뿐이다.
function cloudSession(service,options={}){const s=session();s.status="running";s.audioContext={sampleRate:16000,close:async()=>{}};s.metadata={rate:1};s.options={sttEngine:"cloud",sttModel:"test-stt",whisperLang:"auto",sttService:service,...options};return s;}
const cloudJob=(o={})=>({audio:new Float32Array(16000).fill(.1),time:5,t1:6,epoch:0,rate:1,rms:.1,...o});

test("서버 STT 세션은 Worker 없이 WAV 청크를 보내고 세그먼트를 asr 근거로 저장한다",async()=>{
  const calls=[],prevWorker=global.Worker;
  global.Worker=class{constructor(){throw new Error("클라우드 경로는 Worker를 만들지 않는다");}};
  try{
    const s=cloudSession({stt:async args=>{calls.push(args);return {transcript:{segments:[
      {t0:5,t1:5.4,text:"시간 복잡도를 분석합니다",status:"kept"},
      {t0:5.5,t1:6,text:"이차 항이 지배합니다 ".repeat(140).trim()},
      {t0:5.8,t1:6,text:"무음 구간",noSpeechProb:.9,avgLogprob:-1.5},
      {t0:5.9,t1:6,text:""},
    ]}};}});
    assert.equal(s.asr,undefined);
    s.audioQueue=[cloudJob()];
    await s.processAudio();
    assert.equal(calls.length,1);
    assert.equal(calls[0].lang,"auto","whisperLang auto는 auto로 간다");
    assert.equal(calls[0].model,"test-stt");
    assert.equal(calls[0].t0,5);
    assert.equal(calls[0].durationSec,1);
    assert.ok(calls[0].audio.startsWith("data:audio/wav;base64,"));
    assert.equal(atob(calls[0].audio.split(",")[1]).slice(0,4),"RIFF");
    assert.equal(s.store.items.length,2,"필터된 세그먼트와 빈 세그먼트는 저장하지 않는다");
    assert.equal(s.store.items[0].source,"asr");
    assert.equal(s.store.items[0].time,5);assert.equal(s.store.items[0].t1,5.4);
    assert.equal(s.store.items[0].epoch,0);
    assert.ok(s.store.items[1].text.length<"이차 항이 지배합니다 ".repeat(140).trim().length,"반복 루프는 접어서 저장한다");
    assert.equal(s.counts.audio,2);
    assert.equal(s.asrBusy,false);
    const debug=s.state().debug.join("\n");
    assert.match(debug,/서버 인식 완료 · 2구간 · \d+자 · 1\.0초/);
    assert.doesNotMatch(debug,/시간 복잡도|이차 항|무음 구간/,"전사 내용은 로그에 남기지 않는다");
  }finally{if(prevWorker===undefined)delete global.Worker;else global.Worker=prevWorker;}
});

test("서버 STT는 whisperLang ko/en을 그대로, auto·미지정은 auto로 보낸다",async()=>{
  for(const [whisperLang,want]of[["ko","ko"],["en","en"],[undefined,"auto"],["auto","auto"]]){
    const calls=[];
    const s=cloudSession({stt:async a=>{calls.push(a);return {transcript:{segments:[]}};}},{whisperLang});
    s.audioQueue=[cloudJob()];
    await s.processAudio();
    assert.equal(calls[0].lang,want,String(whisperLang));
  }
});

test("서버 STT 일반 오류는 공백만 남기고 다음 청크로 계속 돌린다",async()=>{
  let n=0;
  const s=cloudSession({stt:async()=>{n++;if(n===1){const e=new Error("제공자가 응답하지 않습니다");e.code="provider_busy";throw e;}return {transcript:{segments:[{t0:34,t1:35,text:"후속 청크"}]}};}});
  let failed=null;s.fail=async m=>{failed=m;};
  s.audioQueue=[cloudJob(),cloudJob({time:34,t1:35})];
  await s.processAudio();
  await new Promise(r=>setTimeout(r,0)); // 실패 뒤 이어진 두 번째 청크 정산
  assert.equal(failed,null,"일반 오류로 세션을 죽이지 않는다");
  assert.equal(n,2,"다음 청크로 계속 진행한다");
  assert.equal(s.status,"running");
  assert.ok(s.gaps.some(g=>g.reason==="asr-failed"&&g.time===5));
  assert.equal(s.store.items.length,1);
  assert.equal(s.counts.audio,1);
  assert.match(s.state().debug.join("\n"),/서버 인식 실패 · provider_busy/);
});

test("서버 STT 인증·한도 오류는 세션을 중단한다",async()=>{
  for(const code of ["unauthorized","token_expired","AUTH_REQUIRED","quota_exceeded","feature_not_in_account_plan"]){
    const s=cloudSession({stt:async()=>{const e=new Error("중단 사유 "+code);e.code=code;throw e;}});
    s.audioQueue=[cloudJob()];
    await s.processAudio();await new Promise(r=>setTimeout(r,0));
    assert.equal(s.status,"failed",code);
    assert.equal(s.error,"중단 사유 "+code);
    assert.ok(s.closed);
  }
});

test("sttService가 없으면 ServiceClient에 URL과 새 토큰을 붙인다",async()=>{
  const calls=[],prev=global.ServiceClient;
  global.ServiceClient={stt:async a=>{calls.push(a);return {transcript:{segments:[]}};}};
  try{
    const s=cloudSession(null,{serviceUrl:"https://svc.example",getToken:async()=>"tok-"+calls.length,whisperLang:"en"});
    s.audioQueue=[cloudJob()];
    await s.processAudio();
    assert.equal(calls.length,1);
    assert.equal(calls[0].baseUrl,"https://svc.example");
    assert.equal(calls[0].token,"tok-0","요청마다 getToken으로 새 토큰을 받는다");
    assert.equal(calls[0].lang,"en");
  }finally{if(prev===undefined)delete global.ServiceClient;else global.ServiceClient=prev;}
});

test("진행 중인 서버 요청은 dispose가 취소하고 늦은 결과는 무시한다",async()=>{
  let signal;
  const s=cloudSession({stt:({signal:sig})=>{signal=sig;return new Promise((_,rej)=>sig.addEventListener("abort",()=>rej(new DOMException("취소됨","AbortError")),{once:true}));}});
  s.audioQueue=[cloudJob()];
  const p=s.processAudio();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(s.asrBusy,true,"진행 중 요청은 Worker와 같이 busy로 잡혀 drain이 기다린다");
  await s.dispose();
  assert.ok(signal.aborted);
  await p; // 취소 뒤 정산되는 체인 — 늦은 결과는 무시된다
  assert.equal(s.store.items.length,0);
  clearTimeout(s.asrTimer);
});

// 서버 STT 요청은 최대 120초까지 걸릴 수 있으니 drain 상한은 그보다 조금 길어야 한다(130초). 로컬은 60초 유지.
test("drain은 진행 중인 서버 STT를 130초까지, 나머지는 60초까지 기다린다",async()=>{
  const realNow=Date.now;
  try{
    for(const [engine,limit]of[["cloud",130000],["local",60000],[undefined,60000]]){
      let now=0;Date.now=()=>now;
      const s=session();s.status="running";s.options={sttEngine:engine};
      s.captureVisual=async()=>{};s.asrBusy=true;
      const p=s.drain();
      await new Promise(r=>setTimeout(r,60));
      now=limit-1;await new Promise(r=>setTimeout(r,60));
      assert.equal(s.status,"draining",`${engine}: 상한 전에는 계속 기다린다`);
      now=limit+1;await p;
      assert.equal(s.status,"completed",`${engine}: 상한을 넘기면 빠져나온다`);
      assert.ok(s.gaps.some(g=>g.reason==="drain-timeout"),engine);
    }
  }finally{Date.now=realNow;}
});

// "[음성] 입력 연결됨"만 찍히면 받아쓰기가 켜진 것처럼 읽힌다 — 꺼져 있으면 꺼져 있다고 한 줄 남긴다.
test("음성 입력이 연결돼도 받아쓰기가 꺼져 있으면 로그에 그 사실을 남긴다",async()=>{
  global.document={createElement:()=>({currentTime:0,muted:true,srcObject:null,videoWidth:1280,videoHeight:720,play:async()=>{}})};
  const prevAC=globalThis.AudioContext,prevVision=globalThis.VisionClient;
  globalThis.AudioContext=class{constructor(){this.sampleRate=16000;this.state="running";this.destination={};}createMediaStreamSource(){return {connect(){},disconnect(){}};}async resume(){}async close(){}};
  globalThis.VisionClient={createVisionEngine:()=>({terminate(){}})};
  try{
    const s=new CaptureSession({id:"quiet",generation:1,stream:{getTracks:()=>[],getAudioTracks:()=>[{}]},options:{ocrEngine:"vision-cloud",visionConsent:true,serviceUrl:"https://svc.example",appSessionToken:"tok",whisperEnabled:false,metadata:{time:0,rate:1,paused:false,epoch:0}},emit:()=>{}});
    s.captureVisual=async()=>{};
    await s.start();
    assert.equal(s.status,"running");
    const debug=s.state().debug.join("\n");
    assert.match(debug,/입력 연결됨/);
    assert.match(debug,/받아쓰기 꺼짐 · 음성은 기록하지 않습니다/,"입력 연결 로그만 있으면 받아쓰기가 켜진 것처럼 읽힌다");
    assert.equal(s.segments,undefined,"받아쓰기 파이프라인은 시작하지 않는다");
    await s.dispose();
  }finally{
    if(prevAC===undefined)delete globalThis.AudioContext;else globalThis.AudioContext=prevAC;
    if(prevVision===undefined)delete globalThis.VisionClient;else globalThis.VisionClient=prevVision;
  }
});

// sttService도 getToken도 없으면 매 청크 공백을 기록하는 대신 startAudio에서 바로 실패해야 한다.
test("서버 STT는 서비스 연결 없이 시작하면 청크 공백 대신 시작 시점에 실패한다",async()=>{
  const s=cloudSession(null);
  await assert.rejects(s.startAudio(),/서비스 연결/);
  assert.equal(s.sttController,undefined);
  assert.equal(s.segments,undefined);
  assert.equal(s.gaps.length,0,"시작 시점에 거절하므로 청크마다 공백을 기록하지 않는다");
  const ok=cloudSession(null,{getToken:async()=>"tok"});
  await assert.rejects(ok.startAudio(),error=>!/서비스 연결/.test(error.message));
  assert.ok(ok.sttController,"연결이 확인되면 다음 단계까지 진행한다");
});
