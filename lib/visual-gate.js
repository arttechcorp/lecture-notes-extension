// Two sampling scales and a recognition-complete reference; thresholds require field evaluation.
(() => {
  function delta(a,b) {
    if (!a || !b || a.length !== b.length) return 1;
    let changed = 0; for(let i=0;i<a.length;i++) if(Math.abs(a[i]-b[i])>18) changed++;
    return changed/a.length;
  }
  function sample(canvas,w,h) {
    const c=new OffscreenCanvas(w,h), ctx=c.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(canvas,0,0,w,h); const d=ctx.getImageData(0,0,w,h).data, a=new Uint8Array(w*h);
    for(let i=0;i<a.length;i++)a[i]=(d[i*4]*3+d[i*4+1]*6+d[i*4+2])/10;
    return a;
  }
  function tileChange(a,b) {
    if(!a||!b)return 1;
    let peak=0;
    for(let y=0;y<144;y+=18)for(let x=0;x<256;x+=32){
      let changed=0;
      for(let dy=0;dy<18;dy++)for(let dx=0;dx<32;dx++)if(Math.abs(a[(y+dy)*256+x+dx]-b[(y+dy)*256+x+dx])>18)changed++;
      peak=Math.max(peak,changed/(32*18));
    }
    return peak;
  }
  // 256×144 표본을 8×8 타일(32×18)로 나눠 바뀐 픽셀이 8%를 넘는 타일에 1을 둔다. 한쪽이 없으면 전부 바뀐 것으로 본다.
  function tileFlags(a,b) {
    const f=new Uint8Array(64);
    if(!a||!b)return f.fill(1);
    for(let t=0;t<64;t++){
      const x0=(t&7)*32,y0=(t>>3)*18;let changed=0;
      for(let dy=0;dy<18;dy++)for(let dx=0;dx<32;dx++)if(Math.abs(a[(y0+dy)*256+x0+dx]-b[(y0+dy)*256+x0+dx])>18)changed++;
      f[t]=changed/(32*18)>.08;
    }
    return f;
  }
  // mask(1=제외)를 뺀 타일 가운데 바뀐 타일의 비율.
  function tileFrac(f,mask) {
    let n=0,changed=0;
    for(let t=0;t<64;t++){if(mask&&mask[t])continue;n++;changed+=f[t];}
    return n?changed/n:0;
  }
  const tilesChanged=(a,b,mask)=>tileFrac(tileFlags(a,b),mask);
  class VisualGate {
    // 비전 모드에서는 제출 한 장이 곧 API 호출 한 번이다. 기본 모드의 "타일이 변하면 제출"을
    // 그대로 쓰면 강사 커서와 판서 한 줄마다 돈이 나간다. 전환에서만, 화면이 멎은 뒤에 제출한다.
    // 표본이 몇 초 간격이라 시간으로 "멎음"을 재지 않는다 — 계속 움직이는 타일(웹캠·재생 영상)은 EMA로 배워
    // 판정에서 뺀 뒤 바뀐 타일의 비율로 전환(≥15%)·정지(≤5%)·중복(≤2%)을 본다. minGapMs는 호출 상한이다.
    constructor({mode="ocr",settleMs=1200,minGapMs=8000,lastFrame=false}={}){this.mode=mode==="vision"?"vision":"ocr";this.settleMs=settleMs;this.minGapMs=minGapMs;this.lastFrame=lastFrame===true;this.previous=null;this.recognized=null;this.submitted=null;this.pending=false;this.changedAt=0;this.lastMotion=0;this.lastAccept=-Infinity;this.live=new Float64Array(64);this.slideId=0;this.shown=null;this.candidate=null;this.slideStart=0;this.lastMask=null;}
    // tag는 호출자의 프레임 식별자 — 게이트는 내용을 모르고 candidate/tag로 그대로 돌려준다.
    inspect(canvas,now=performance.now(),force=false,tag=null){
      const current={low:sample(canvas,64,36),high:sample(canvas,256,144)};
      if(this.mode==="vision"){
        const flags=this.previous?tileFlags(this.previous.high,current.high):new Uint8Array(64);
        for(let t=0;t<64;t++)this.live[t]=this.live[t]*.7+flags[t]*.3;
        const mask=new Uint8Array(64);let live=0;
        for(let t=0;t<64;t++)if(this.live[t]>.5){mask[t]=1;live++;}
        if(live>32)mask.fill(0); // 화면 절반 이상이 계속 움직이면 영상 구간 — 뺄 타일이 없다
        this.lastMask=mask;
        // "직전 프레임" 모드(mis-sol-hai §4.1): 화면이 멎을 때마다 후보를 갱신해 쥐고, 다음 전환이
        // 확정되면 후보(전환 직전의 마지막 정지 프레임)를 제출한다 — 판서가 끝난 장면을 얻는다.
        // 결과의 entered는 새 슬라이드의 첫 정지 표본(썸네일·재방문 비교의 재료), t0ms는 제출된 슬라이드의 시작 시각.
        if(this.lastFrame){
          const transition=this.shown?tilesChanged(this.shown.high,current.high,mask)>=.15:false;
          const still=!this.previous||tileFrac(flags,mask)<=.05;
          this.changedAt=transition?this.changedAt||now:0;
          let accept=false,entered=null,submitTag=null,t0ms=this.slideStart,sid=this.slideId;
          if(!this.shown){this.shown=current;this.slideStart=now;this.candidate={sample:current,tag};entered={slideId:sid,sample:current,tag,t0ms:now};}
          else if(!transition&&still)this.candidate={sample:current,tag};
          if(force||(transition&&still&&!this.pending&&now-this.lastAccept>=this.minGapMs)){
            const c=this.candidate??{sample:current,tag};
            accept=true;submitTag=c.tag;t0ms=this.slideStart;this.submitted=c.sample;
            if(transition){this.slideId++;this.slideStart=this.changedAt;this.changedAt=0;this.shown=current;this.candidate={sample:current,tag};entered={slideId:this.slideId,sample:current,tag,t0ms:this.slideStart};}
            this.pending=true;this.lastAccept=now;
          }
          this.previous=current;
          return {accept,sample:accept?this.submitted:current,tag:submitTag,entered,candidateTag:this.candidate?.tag??null,mask,slideId:sid,t0ms,movement:tileFrac(flags),accumulated:this.shown?tilesChanged(this.shown.high,current.high,mask):0};
        }
        const transition=tilesChanged(this.recognized?.high,current.high,mask)>=.15;
        const settled=!this.previous||tileFrac(flags,mask)<=.05;
        const duplicate=this.submitted&&tilesChanged(this.submitted.high,current.high,mask)<=.02;
        if(transition&&!this.changedAt)this.changedAt=now;
        const ready=!this.recognized||(transition&&settled);
        const accept=force||(!this.pending&&!duplicate&&ready&&now-this.lastAccept>=this.minGapMs);
        this.previous=current;
        if(accept){if(transition)this.slideId++;this.submitted=current;this.pending=true;this.lastAccept=now;}
        return {accept,sample:current,slideId:this.slideId,movement:tileFrac(flags),accumulated:tilesChanged(this.recognized?.high,current.high,mask)};
      }
      const movement=delta(this.previous?.low,current.low), accumulated=tileChange(this.recognized?.high,current.high);
      if(movement>.015)this.lastMotion=now;
      if(accumulated>.035&&!this.changedAt)this.changedAt=now;
      const transition=delta(this.recognized?.low,current.low)>.32;
      const changed=!this.recognized||accumulated>.035;
      const duplicate=this.submitted&&delta(this.submitted.high,current.high)<.004;
      // A stable slide is submitted once.  The old 12 s heartbeat re-submitted
      // an unchanged video frame even when OCR had already completed, which
      // polluted the evidence stream with repeated screen text.  Keep the
      // stability/transition checks as the only non-forced admission path.
      const ready=!this.recognized||(changed&&(now-this.lastMotion>=600||now-this.changedAt>=2500));
      const accept=force||(!this.pending&&!duplicate&&ready);
      this.previous=current;
      if(accept){ if(transition)this.slideId++;this.submitted=current;this.pending=true; }
      return {accept,sample:current,slideId:this.slideId,movement,accumulated};
    }
    complete(sample){this.recognized=sample;this.pending=false;this.changedAt=0;}
    // 직전 프레임 모드 전용: 영상이 끝났는데 화면에 남은 슬라이드가 있으면 그 마지막 후보를 낸다.
    flush(){if(!this.lastFrame||!this.candidate)return null;const c=this.candidate;this.candidate=null;return {accept:true,sample:c.sample,tag:c.tag,entered:null,candidateTag:null,mask:this.lastMask,slideId:this.slideId,t0ms:this.slideStart};}
    reset(){this.previous=null;this.recognized=null;this.submitted=null;this.pending=false;this.changedAt=0;this.lastAccept=-Infinity;this.live.fill(0);this.shown=null;this.candidate=null;this.slideStart=0;this.lastMask=null;}
  }
  VisualGate.tilesChanged=tilesChanged; // 재방문 대조(썸네일 비교)에서 쓴다
  globalThis.VisualGate=VisualGate;
  if(typeof module!=="undefined")module.exports={VisualGate,delta,tileChange,tilesChanged};
})();

