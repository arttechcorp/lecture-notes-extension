(() => {
  const MAX_BYTES=64*1024*1024, MAX_IMAGES=4, MAX_AUDIO=2, MAX_DEBUG=200;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function createOcrEngine(){
    const {PpOcrV5}=await import(chrome.runtime.getURL("lib/ppocr-runtime.mjs"));
    const engine=new PpOcrV5();await engine.init();
    return {
      async recognize(blob){
        const image=await createImageBitmap(blob);
        try{
          const result=await engine.recognize(image);
          const scores=result.lines.map(line=>line.confidence).filter(Number.isFinite);
          return {data:{text:result.text,confidence:scores.length?scores.reduce((a,b)=>a+b,0)/scores.length*100:0}};
        }finally{image.close();}
      },
      terminate:()=>engine.dispose(),
    };
  }
  async function timeout(p,ms,label,signal){
    let timer,abort;
    try{return await Promise.race([p,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Error(label)),ms);
      abort=()=>reject(new Error("준비가 취소됐습니다."));
      if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
    })]);}finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
  }
  function normalizeAudio(audio){
    let peak=0;for(const sample of audio)peak=Math.max(peak,Math.abs(sample));
    if(peak>.0005&&peak<.6){const gain=Math.min(10,.75/peak);for(let i=0;i<audio.length;i++)audio[i]=Math.max(-1,Math.min(1,audio[i]*gain));}
    return audio;
  }
  // Transformers.js defaults multilingual Whisper to English when language is
  // omitted.  "auto" therefore cannot mean a neutral detector here; keep the
  // Korean lecture default explicit while retaining an English override.
  function whisperLanguage(value){
    return {ko:"korean",korean:"korean",en:"english",english:"english"}[value]||"korean";
  }
  class CaptureSession {
    constructor({id,generation,stream,options={},emit}){
      Object.assign(this,{id,generation,stream,options,emit,status:"preparing",store:new EvidenceStore(),gate:new VisualGate(),imageQueue:[],audioQueue:[],imageBytes:0,gaps:[],debug:[],debugAt:performance.now(),counts:{visual:0,audio:0},revision:0,disposed:false,progress:null});
      this.metadata=options.metadata||{};this.metadataAt=performance.now();this.epoch=this.metadata.epoch||0;
      this.startController=new AbortController();
      this.video=document.createElement("video");Object.assign(this.video,{muted:true,playsInline:true,srcObject:stream});
    }
    state(){const recent=this.store.items.slice(-3).map(item=>({source:item.source,time:item.t0??item.time??0,t1:item.t1??item.t0??item.time??0,text:String(item.text||"").slice(0,500)}));return {sessionId:this.id,generation:this.generation,tabId:this.options.tabId,status:this.status,counts:{...this.counts},backlog:{images:this.imageQueue.length+(this.ocrBusy?1:0),audio:this.audioQueue.length+(this.asrBusy?1:0),imageBytes:this.imageBytes},recent,gaps:this.gaps.slice(-30),debug:this.debug.slice(-100),summary:this.summary||null,error:this.error||null,progress:this.progress,timeKind:this.metadata.time===undefined?"elapsed":"media",mediaTime:this.time()};}
    publish(){this.emit(this.state());}
    log(message){const elapsed=(performance.now()-this.debugAt)/1000,stamp=`${String(Math.floor(elapsed/60)).padStart(2,"0")}:${(elapsed%60).toFixed(1).padStart(4,"0")}`;this.debug.push(`[${stamp}] ${message}`);if(this.debug.length>MAX_DEBUG)this.debug.shift();this.publish();}
    time(){return Number.isFinite(this.metadata.time)?this.metadata.time+(this.metadata.paused?0:(performance.now()-this.metadataAt)/1000*(this.metadata.rate||1)):(this.video.currentTime||0);}
    async start(){
      try{
        if(this.options.ocrEnabled===false&&!this.options.whisperEnabled)throw new Error("화면 또는 음성 인식을 선택하세요.");
        await timeout(this.video.play(),10000,"탭 화면을 시작하지 못했습니다.",this.startController.signal);
        if(!this.video.videoWidth)throw new Error("탭 화면을 읽을 수 없습니다.");
        const hasAudio=this.stream.getAudioTracks().length>0;
        if(!hasAudio&&this.options.ocrEnabled===false)throw new Error("이 탭에 인식할 오디오가 없습니다. 화면 인식을 켜거나 재생 상태를 확인하세요.");
        if(hasAudio){
          const Context=globalThis.AudioContext;
          this.audioContext=new Context({sampleRate:16000});this.audioSource=this.audioContext.createMediaStreamSource(this.stream);
          this.audioSource.connect(this.audioContext.destination);await this.audioContext.resume();
          this.log(`[음성] 입력 연결됨 · ${this.audioContext.sampleRate} Hz · AudioContext ${this.audioContext.state}`);
        }
        if(this.options.ocrEnabled!==false){
          this.progress="PP-OCRv5 한국어 모델 준비 중";this.publish();
          const loading=createOcrEngine().then(engine=>{if(this.closed){engine.terminate();throw new Error("준비가 취소됐습니다.");}return engine;});
          this.ocr=await timeout(loading,90000,"화면 인식 모델 준비 시간 초과",this.startController.signal);
        }
        if(this.options.whisperEnabled&&hasAudio)await this.startAudio();
        else if(this.options.whisperEnabled)this.gap("audio-unavailable",this.time());
        if(this.disposed)throw new Error("준비가 취소됐습니다.");
        if(this.closed)throw new Error("준비가 취소됐습니다.");
        this.status="running";this.progress=null;this.metadataAt=performance.now();
        this.stream.getTracks().forEach(t=>t.addEventListener("ended",()=>{if(!this.closed)this.stop().catch(()=>{});},{once:true}));
        this.timer=setInterval(()=>{
          if(this.options.tabId&&performance.now()-this.metadataAt>2500){this.fail("강의 탭 연결이 끊겨 인식을 중단했습니다.");return;}
          this.captureVisual().catch(e=>this.fail(e.message));
        },250);
        await this.captureVisual(true);this.publish();
      }catch(error){await this.cleanup();this.status="failed";this.error=error.message;this.publish();throw error;}
    }
    updateMetadata(data){
      if(!data||!Number.isFinite(data.epoch))return;
      if(data.blocked){this.fail("보호된 콘텐츠가 감지되어 중단했습니다.");return;}
      if(data.rate!==this.metadata.rate||data.paused!==this.metadata.paused)this.segments?.flush();
      if(data.epoch!==this.epoch){this.segments?.flush();this.gate.reset();this.epoch=data.epoch;}
      this.metadata=data;this.metadataAt=performance.now();
      if(data.ended)this.stop().catch(e=>this.fail(e.message));
    }
    rect(){
      const b=this.metadata.box;
      if(!b||![b.x,b.y,b.w,b.h].every(Number.isFinite)||b.w<=0||b.h<=0)throw new Error("영상 영역을 확인할 수 없습니다.");
      if(b.x<0||b.y<0||b.x+b.w>1.01||b.y+b.h>1.01)throw new Error("영상 전체가 보이도록 화면을 조정한 뒤 다시 시작하세요.");
      const v={x:b.x*this.video.videoWidth,y:b.y*this.video.videoHeight,w:b.w*this.video.videoWidth,h:b.h*this.video.videoHeight};
      // The source video uses object-fit:contain in the usual player. Unusual layouts require ROI adjustment.
      const aspect=this.metadata.videoAspect||v.w/v.h;
      if(v.w/v.h>aspect){const w=v.h*aspect;v.x+=(v.w-w)/2;v.w=w;}else{const h=v.w/aspect;v.y+=(v.h-h)/2;v.h=h;}
      const r=this.options.rect||{x:0,y:0,w:1,h:1};
      if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1||r.y+r.h>1)throw new Error("인식 영역 좌표가 올바르지 않습니다.");
      return {x:Math.round(v.x+v.w*r.x),y:Math.round(v.y+v.h*r.y),w:Math.max(1,Math.round(v.w*r.w)),h:Math.max(1,Math.round(v.h*r.h))};
    }
    async captureVisual(force=false){
      if(this.options.ocrEnabled===false||this.closed||this.pendingFrame||(!force&&(this.status!=="running"||this.metadata.paused)))return;
      const now=performance.now();if(!force&&now-(this.lastSample||0)<500)return;this.lastSample=now;
      const rect=this.rect(), bytes=rect.w*rect.h*4;
      if(bytes>MAX_BYTES/2)throw new Error("화면 크기가 로컬 처리 예산을 초과합니다. 영역을 줄여 주세요.");
      const canvas=new OffscreenCanvas(rect.w,rect.h);const ctx=canvas.getContext("2d",{willReadFrequently:true});ctx.drawImage(this.video,rect.x,rect.y,rect.w,rect.h,0,0,rect.w,rect.h);
      const choice=this.gate.inspect(canvas,now,force);if(!choice.accept){canvas.width=1;canvas.height=1;return;}
      if(this.imageQueue.length+(this.ocrBusy?1:0)>=MAX_IMAGES||this.imageBytes+bytes*2>MAX_BYTES){
        canvas.width=1;canvas.height=1;this.gap("visual-capacity");await this.fail("화면 인식이 밀려 입력을 중단했습니다. 현재까지의 결과를 확인하세요.");return;
      }
      this.imageBytes+=bytes;const revision=this.revision, time=this.time(), epoch=this.epoch;
      this.pendingFrame=(async()=>{
        try{
          const blob=await canvas.convertToBlob({type:"image/jpeg",quality:.9});
          if(this.closed||revision!==this.revision){this.imageBytes-=bytes;return;}
          this.imageQueue.push({blob,bytes,time,t1:time,epoch,bbox:this.options.rect||null,sample:choice.sample,slideId:choice.slideId});
          this.processImages();this.publish();
        }catch(error){this.imageBytes-=bytes;throw error;}
        finally{canvas.width=1;canvas.height=1;this.pendingFrame=null;}
      })();
      return this.pendingFrame;
    }
    async processImages(){
      if(this.closed||this.ocrBusy||!this.imageQueue.length)return;
      this.ocrBusy=true;const job=this.imageQueue.shift(),revision=this.revision;
      try{
        const result=await timeout(this.ocr.recognize(job.blob),45000,"화면 인식 시간 초과");
        if(this.closed||revision!==this.revision)return;
        if(this.store.add({source:"ocr",...job,blob:undefined,text:result.data.text,confidence:Number.isFinite(result.data.confidence)?result.data.confidence/100:null}))this.counts.visual++;
        this.gate.complete(job.sample);
      }catch(error){if(!this.closed){this.gap("ocr-failed",job.time);this.fail(error.message);}}
      finally{this.imageBytes=Math.max(0,this.imageBytes-job.bytes);this.ocrBusy=false;if(!this.closed){this.publish();this.processImages();}}
    }
    async startAudio(){
      const high=this.options.whisperModel==="small-webgpu";
      const model=high?"Whisper Small q8/q4 · WebGPU":"Whisper Base · WASM",started=performance.now();
      const selectedLanguage=this.options.whisperLang||"ko";
      this.log(`[음성] ${model} 준비 시작 · 언어 ${selectedLanguage}${selectedLanguage==="auto"?" (한국어 우선)":""} · 배속 ${this.metadata.rate||1}× · OCR ${this.options.ocrEnabled===false?"꺼짐":"켜짐"} · 청크 정책 10~20초`);
      this.asr=new Worker(chrome.runtime.getURL(high?"lib/whisper-webgpu-worker.js":"lib/whisper-worker.js"),{type:"module"});
      await timeout(new Promise((resolve,reject)=>{
        this.asr.onmessage=({data})=>{if(data.type==="READY"){this.log(`[음성] ${model} 준비 완료 · ${((performance.now()-started)/1000).toFixed(1)}초 · Worker ${data.model||"미보고"} · ${data.device||"미보고"} · dtype ${typeof data.dtype==="object"?`${data.dtype.encoder_model}/${data.dtype.decoder_model_merged}`:data.dtype||"미보고"}`);resolve();}else if(data.type==="ERROR"){this.log(`[음성] 모델 준비 오류 · ${data.error||"원인 없음"}`);reject(new Error(data.error||"음성 모델을 준비하지 못했습니다."));}else if(data.type==="PROGRESS"){this.progress="음성 모델 다운로드·준비 중";this.publish();}};
        this.asr.onerror=event=>{this.log(`[음성] Worker 로드 실패 · ${event.message||"원인 없음"}`);reject(new Error("음성 Worker를 불러오지 못했습니다."));};
        this.asr.postMessage({type:"INIT",model:high?"small":"base"});
      }),180000,"음성 모델 준비 시간 초과",this.startController.signal);
      this.asr.onmessage=({data})=>this.onAsr(data);this.asr.onerror=event=>{this.log(`[음성] Worker 중단 · ${event.message||"원인 없음"}`);this.fail("음성 Worker가 중단됐습니다.");};
      this.segments=new AudioSegments(job=>{
        if(this.closed)return;
        let energy=0;for(const sample of job.audio)energy+=sample*sample;const rms=Math.sqrt(energy/job.audio.length),pending=this.audioQueue.length+(this.asrBusy?1:0);
        if(pending>=MAX_AUDIO){const queuedSeconds=this.audioQueue.reduce((total,queued)=>total+queued.audio.length/this.audioContext.sampleRate,0);this.log(`[음성] 백로그 한도 초과 · ${job.audio.length}샘플 · RMS ${rms.toFixed(5)} · 대기 ${pending}/${MAX_AUDIO}건 · 처리 중 ${this.activeAudio?.audioSeconds?.toFixed(1)||"0.0"}초 / 경과 ${this.asrBusy?((performance.now()-this.asrStartedAt)/1000).toFixed(1):"0.0"}초 · 미처리 ${queuedSeconds.toFixed(1)}초 · OCR ${this.ocrBusy?"처리 중":"대기"}`);this.gap("audio-capacity",job.time);this.fail(`음성 인식이 밀려 입력을 중단했습니다. (대기 ${pending}/${MAX_AUDIO}건) 디버그 로그에서 처리 시간을 확인하세요.`);return;}
        this.audioQueue.push(job);this.log(`[음성] 청크 수신 · ${(job.audio.length/this.audioContext.sampleRate).toFixed(1)}초 · RMS ${rms.toFixed(5)} · 대기 ${pending+1}/${MAX_AUDIO}건`);this.processAudio();this.publish();
      },this.audioContext.sampleRate);
      await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL("lib/pcm-worklet.js"));
      this.processor=new AudioWorkletNode(this.audioContext,"lecture-pcm");
      this.processor.port.onmessage=({data})=>{if((this.status==="running"||this.flushing)&&!this.closed){this.segments.push(data,this.time()-data.length/this.audioContext.sampleRate*(this.metadata.rate||1),this.epoch,this.metadata.rate||1);}};
      this.audioSource.connect(this.processor);this.processor.connect(this.audioContext.destination);
    }
    processAudio(){
      if(this.closed||!this.asr||this.asrBusy||!this.audioQueue.length)return;
      this.asrBusy=true;this.activeAudio=this.audioQueue.shift();
      const job=this.activeAudio;job.audioSeconds=job.audio.length/(this.audioContext?.sampleRate||16000);this.asrStartedAt=performance.now();
      this.asrTimer=setTimeout(()=>{this.log(`[음성] 인식 시간 초과 · 강의 ${job.time.toFixed(1)}초 · 60.0초`);this.fail("음성 인식 시간 초과");},60000);
      this.log(`[음성] 인식 시작 · 강의 ${job.time.toFixed(1)}초 · 청크 ${(job.audio.length/16000).toFixed(1)}초 · 남은 대기 ${this.audioQueue.length}건`);
      const language=whisperLanguage(this.options.whisperLang);
      this.asr.postMessage({type:"TRANSCRIBE",audio:normalizeAudio(job.audio),id:job.time,language,model:this.options.whisperModel==="small-webgpu"?"small":"base"},[job.audio.buffer]);
    }
    onAsr(data){
      if(this.closed||!this.asrBusy)return;
      if(!["TRANSCRIBED","ERROR"].includes(data.type))return;
      clearTimeout(this.asrTimer);const job=this.activeAudio,seconds=(performance.now()-this.asrStartedAt)/1000,capturedSeconds=job.audioSeconds??Math.max(0,(job.t1||job.time)-job.time),backlogSeconds=this.audioQueue.reduce((total,queued)=>total+(queued.audioSeconds??queued.audio.length/16000),0),diagnostic=`캡처 ${capturedSeconds.toFixed(1)}초 · 추론 ${seconds.toFixed(1)}초 · RTF ${(seconds/capturedSeconds).toFixed(2)} · 대기 ${this.audioQueue.length}건 · ${backlogSeconds.toFixed(1)}초`;this.asrBusy=false;this.activeAudio=null;this.asrStartedAt=null;
      if(data.type==="ERROR"){this.log(`[음성] Whisper 오류 · ${diagnostic} · ${data.error||"원인 없음"}`);this.gap("asr-failed",job.time);this.fail("음성 인식이 실패했습니다.");return;}
      try{
        const length=String(data.text||"").trim().length;this.log(length?`[음성] 인식 완료 · ${diagnostic} · ${length}자`:`[음성] 인식 결과 없음 · ${diagnostic} · 무음 또는 인식 실패`);
        // Preserve repeated emphasis and numbers; unaligned overlapping text is not silently deleted.
        if(this.store.add({source:"asr",time:job.time,t1:job.t1,text:data.text,epoch:job.epoch}))this.counts.audio++;
      }catch(error){this.fail(error.message);return;}
      this.processAudio();this.publish();
    }
    pause(){if(this.status==="running"){this.segments?.flush();this.status="paused";this.gap("user-paused");this.publish();}}
    resume(){if(this.status==="paused"){this.gate.reset();this.status="running";this.publish();}}
    gap(reason,time=this.time()){this.gaps.push({time,reason});if(this.gaps.length>200)this.gaps.shift();}
    async fail(error){if(this.closed)return;this.error=error;this.gap("stopped-on-error");await this.cleanup();this.status="failed";this.publish();}
    stop(){if(!this.stopping)this.stopping=this.drain();return this.stopping;}
    async drain(){
      if(["completed","disposed","failed"].includes(this.status))return this.state();
      const before=this.status;this.status="draining";clearInterval(this.timer);this.publish();
      try{
        await this.pendingFrame;
        if(before==="running"||before==="paused")await this.captureVisual(true);
        if(this.processor){this.flushing=before==="running";this.processor.port.postMessage("flush");this.processor.port.postMessage("stop");await delay(150);this.flushing=false;this.segments.flush();}
        const until=Date.now()+60000;
        while(!this.closed&&(this.imageQueue.length||this.audioQueue.length||this.ocrBusy||this.asrBusy)&&Date.now()<until)await delay(50);
        if(this.imageQueue.length||this.audioQueue.length||this.ocrBusy||this.asrBusy)this.gap("drain-timeout");
      }catch(error){this.error=error.message;this.gap("drain-failed");}
      await this.cleanup();if(this.status!=="failed")this.status="completed";this.progress=null;this.publish();return this.state();
    }
    async cleanup(){
      if(this.closed)return;this.closed=true;this.revision++;this.startController.abort();
      clearInterval(this.timer);clearTimeout(this.asrTimer);
      this.processor?.port.postMessage("stop");this.processor?.disconnect();this.audioSource?.disconnect();
      this.asr?.terminate();this.stream?.getTracks().forEach(t=>t.stop());this.video.srcObject=null;
      await Promise.allSettled([this.audioContext?.close(),this.ocr?.terminate?.()]);
      this.gate.reset();for(const job of this.audioQueue)job.audio?.fill(0);
      this.stream=null;this.ocr=null;this.asr=null;this.processor=null;this.audioSource=null;this.audioContext=null;
      this.segments?.clear();this.imageQueue=[];this.audioQueue=[];this.imageBytes=0;this.asrBusy=false;this.ocrBusy=false;this.activeAudio=null;
    }
    async dispose(){this.disposed=true;await this.cleanup();this.store.clear();this.summaryCache?.clear();this.summary=null;this.gaps=[];this.debug=[];this.error=null;this.progress=null;this.status="disposed";this.publish();return this.state();}
  }
  globalThis.CaptureSession=CaptureSession;
  if(typeof module!=="undefined")module.exports={CaptureSession,timeout,normalizeAudio,whisperLanguage};
})();
