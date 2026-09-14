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

test("continuous speech remains bounded at twenty seconds with one-second overlap",()=>{
  const jobs=[],segments=new AudioSegments(job=>jobs.push(job));
  for(let i=0;i<210;i++)segments.push(packet(),i/10,0);
  segments.flush();
  assert.equal(jobs[0].audio.length,320000);
  assert.equal(jobs[1].audio.length,32000);
  assert.ok(jobs.every(job=>job.audio.length<=320000));
});
