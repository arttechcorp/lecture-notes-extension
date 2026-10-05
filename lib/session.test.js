const test=require("node:test"),assert=require("node:assert/strict");
require("./evidence");require("./visual-gate");require("./ink-layer");global.collapseRepeats=require("./repeats").collapseRepeats;const {CaptureSession,stretchAudio}=require("./session");const {AudioSegments}=require("./audio-segments");
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

// --- 같은 슬라이드 재캡처(판서): 가짜 캔버스가 pattern(u,v)을 요청한 해상도로 그려 준다. 게이트 시계도 가짜로 돌린다. ---
const ink = (() => {
  const block = (...rects) => (u, v) => { for (const [x, y, w, h, color = [40, 40, 40]] of rects) if (u >= x && u < x + w && v >= y && v < y + h) return color; return [235, 235, 235]; };
  const A = [[.1, .15, .5, .04], [.1, .25, .6, .04], [.1, .35, .4, .04], [.1, .45, .55, .04]];
  const B = [[.35, .15, .5, .04], [.35, .25, .5, .04], [.35, .35, .5, .04], [.35, .45, .5, .04]];
  const PEN = [[.65, .65, .25, .05, [220, 30, 30]], [.1, .7, .3, .04, [20, 20, 140]]];
  let shown = block(), clock = 0;
  class FakeCanvas {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage() {},
        putImageData: image => { this.ink = image; },
        getImageData: (_x, _y, width, height) => {
          const data = new Uint8ClampedArray(width * height * 4);
          for (let i = 0; i < width * height; i++) data.set([...shown(((i % width) + .5) / width, (Math.floor(i / width) + .5) / height), 255], i * 4);
          return { data, width, height };
        },
      };
    }
    async convertToBlob() { return { ink: !!this.ink }; }
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function make(options = {}) {
    global.OffscreenCanvas = FakeCanvas;
    global.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
    global.document = { createElement: () => ({ currentTime: 0, muted: true, srcObject: null }) };
    const s = new CaptureSession({ id: "ink", generation: 1, stream: { getTracks: () => [] }, options: { watchFrameId: null, ...options }, emit: () => {} });
    s.status = "running"; s.video = { videoWidth: 320, videoHeight: 180, currentTime: 0 };
    const inspect = s.gate.inspect.bind(s.gate); s.gate.inspect = (canvas, _now, force) => inspect(canvas, clock, force);
    s.blobs = []; s.ocr = { recognize: async blob => { s.blobs.push(blob.ink); return { data: { text: blob.ink ? "밑줄 판서" : "인쇄 제목", confidence: 90 } }; } };
    return s;
  }
  // 화면을 rects 로 바꾸고 700ms 간격으로 지켜본다(게이트가 멎기를 기다리는 시간). 처리 중인 인식이 끝나길 기다린다.
  async function watch(s, rects, from, force = false) {
    shown = block(...rects);
    for (clock = from; clock <= from + 3000; clock += 700) {
      s.lastSample = -1e6; await s.captureVisual(force);
      while (s.ocrBusy || s.imageQueue.length) await wait(1);
      if (force) break;
    }
  }
  return { A, B, PEN, make, watch };
})();

test("같은 슬라이드 재캡처는 판서만 남긴 이미지를 인식하고 근거 앞에 (판서)를 붙인다", async () => {
  const s = ink.make();
  await ink.watch(s, ink.A, 1000);
  assert.deepEqual(s.blobs, [false], "첫 화면은 통째로 인식한다");
  assert.equal(s.slideBase.width, 320, "기준 화면을 메모리에 쥔다");
  const base = s.slideBase;

  await ink.watch(s, [...ink.A, ...ink.PEN], 10000);
  assert.deepEqual(s.blobs, [false, true], "재캡처는 판서만 남긴 이미지");
  assert.equal(s.slideBase, base, "같은 슬라이드에서는 기준을 바꾸지 않는다");
  assert.deepEqual(s.store.items.map(e => e.text), ["인쇄 제목", "(판서) 밑줄 판서"]);
  assert.equal(s.store.items[1].slideId, s.store.items[0].slideId);

  await ink.watch(s, ink.B, 20000);
  assert.equal(s.blobs.length, 3);
  assert.equal(s.blobs[2], false, "다음 슬라이드 첫 화면은 통째로 인식한다");
  assert.equal(s.store.items[2].text, "인쇄 제목");
  assert.notEqual(s.slideBase, base, "새 슬라이드의 첫 화면이 새 기준");

  s.updateMetadata({ epoch: 1, rate: 1, paused: false });
  assert.equal(s.slideBase, null, "에포크가 바뀌면 기준을 버린다");
  await ink.watch(s, ink.A, 30000);
  assert.ok(s.slideBase);
  await s.dispose();
  assert.equal(s.slideBase, null, "세션을 닫으면 기준을 버린다");
});

test("바뀐 곳이 없는 재캡처는 인식 없이 게이트를 풀어 준다", async () => {
  const s = ink.make();
  await ink.watch(s, ink.A, 1000);
  await ink.watch(s, [...ink.A, ...ink.PEN], 10000);
  await ink.watch(s, ink.A, 20000); // 판서를 지웠다: 직전 인식과는 다르지만 기준 화면과는 같다
  assert.equal(s.blobs.length, 2, "인식하지 않는다");
  assert.equal(s.gate.pending, false, "게이트가 대기 상태로 남지 않는다");
  assert.equal(s.imageQueue.length + (s.ocrBusy ? 1 : 0), 0);
  await ink.watch(s, [...ink.A, ...ink.PEN], 30000);
  assert.equal(s.blobs.length, 3, "다음 판서는 다시 잡힌다");
});

test("비전 모드는 기준 화면도 판서 층도 만들지 않는다", async () => {
  const s = ink.make({ ocrEngine: "vision-cloud" });
  await ink.watch(s, ink.A, 1000);
  await ink.watch(s, [...ink.A, ...ink.PEN], 10000, true);
  assert.deepEqual(s.blobs, [false, false], "강제 캡처도 화면 전체를 보낸다");
  assert.equal(s.slideBase, null);
  assert.ok(s.store.items.every(e => !e.text.startsWith("(판서)")));
});
