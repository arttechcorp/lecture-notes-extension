const test=require("node:test"),assert=require("node:assert/strict");
const {AudioSegments}=require("./audio-segments");

const packet=(value=.1)=>new Float32Array(1600).fill(value);

test("ordinary silence batches short speech to ten seconds without dropping PCM",()=>{
  const jobs=[],segments=new AudioSegments(job=>jobs.push(job));
  for(let i=0;i<30;i++)segments.push(packet(),i/10,0);
  for(let i=30;i<100;i++)segments.push(packet(0),i/10,0);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].audio.length,160000);
  assert.ok(Math.abs(jobs[0].audio[0]-.1)<1e-6);
  assert.ok(Math.abs(jobs[0].audio[47999]-.1)<1e-6);
  assert.equal(jobs[0].audio[48000],0);
});

test("explicit and epoch flushes preserve a short tail",()=>{
  const jobs=[],segments=new AudioSegments(job=>jobs.push(job));
  segments.push(packet(),0,0);segments.push(packet(),.1,1);
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].audio.length,1600);
  segments.flush();
  assert.equal(jobs.length,2);
  assert.equal(jobs[1].audio.length,1600);
});

test("repeated three-second phrases do not flood a two-job queue",()=>{
  const jobs=[];let now=0,finishes=[],maximumPending=0;
  // Synthetic worker latency: old 4-second chunks overflowed at 19.7 seconds.
  const segments=new AudioSegments(job=>{
    jobs.push(job);finishes=finishes.filter(end=>end>now);
    finishes.push(Math.max(now,finishes.at(-1)||0)+6);
    maximumPending=Math.max(maximumPending,finishes.length);
  });
  for(let i=0;i<400;i++){now=(i+1)/10;segments.push(packet(i%40<30?.1:0),i/10,0);}
  assert.ok(jobs.every(job=>job.audio.length>=160000&&job.audio.length<=320000));
  segments.flush();
  assert.ok(maximumPending<=2);
  assert.equal(jobs.reduce((sum,job)=>sum+job.audio.reduce((count,v)=>count+(v>0?1:0),0),0),30*16000);
});

test("continuous speech fills Whisper's 30 s window and keeps a one-second overlap",()=>{
  // The ceiling is 29 s, not 20 s: the encoder pads every call to 30 s, so a short chunk pays the same fixed
  // cost for less audio and is what drove the ASR past real time on slower machines.
  const jobs=[],segments=new AudioSegments(job=>jobs.push(job));
  for(let i=0;i<300;i++)segments.push(packet(),i/10,0);
  segments.flush();
  assert.equal(jobs[0].audio.length,29*16000);
  assert.equal(jobs[1].audio.length,32000);
  assert.ok(jobs.every(job=>job.audio.length<=30*16000),"Whisper의 30초 한도를 넘지 않는다");
});

test("2x playback still cuts on the speaker's pauses instead of the 20 second ceiling",()=>{
  // Same lecture either way: 3 s of speech, 1 s pause. At 2x that pause is only 0.35 s of samples, so a
  // wall-clock silence gate never fires and every chunk becomes a hard 20 s cut holding 40 s of lecture.
  const run=rate=>{
    const jobs=[],segments=new AudioSegments(job=>jobs.push(job));
    for(let i=0;i<Math.round(120/rate*10);i++){const lecture=i/10*rate;segments.push(packet(lecture%4<3?.1:0),lecture,0,rate);}
    segments.flush();return jobs;
  };
  for(const rate of [1,1.5,2]){
    const jobs=run(rate);
    assert.ok(jobs.length>1,`${rate}배속에서 청크가 생성된다`);
    assert.ok(jobs.some(job=>job.audio.length<320000),`${rate}배속에서 20초 상한이 아닌 자연 경계로 끊긴다`);
    for(const job of jobs)assert.ok(job.t1-job.time<=20*rate+1,`${rate}배속 청크가 담는 강의 분량이 20초×배속 이내다`);
  }
  assert.equal(run(1).length,10,"1배속 동작은 그대로다");
});
