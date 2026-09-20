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
  class VisualGate {
    // 비전 모드에서는 제출 한 장이 곧 API 호출 한 번이다. 기본 모드의 "타일이 변하면 제출"을
    // 그대로 쓰면 강사 커서와 판서 한 줄마다 돈이 나간다. 전환에서만, 화면이 멎은 뒤에 제출한다.
    constructor({mode="ocr",settleMs=1200}={}){this.mode=mode==="vision"?"vision":"ocr";this.settleMs=settleMs;this.previous=null;this.recognized=null;this.submitted=null;this.pending=false;this.changedAt=0;this.lastMotion=0;this.slideId=0;}
    inspect(canvas,now=performance.now(),force=false){
      const current={low:sample(canvas,64,36),high:sample(canvas,256,144)};
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
      const ready=this.mode==="vision"
        ? !this.recognized||(transition&&now-this.lastMotion>=this.settleMs)
        : !this.recognized||(changed&&(now-this.lastMotion>=600||now-this.changedAt>=2500));
      const accept=force||(!this.pending&&!duplicate&&ready);
      this.previous=current;
      if(accept){ if(transition)this.slideId++;this.submitted=current;this.pending=true; }
      return {accept,sample:current,slideId:this.slideId,movement,accumulated};
    }
    complete(sample){this.recognized=sample;this.pending=false;this.changedAt=0;}
    reset(){this.previous=null;this.recognized=null;this.submitted=null;this.pending=false;this.changedAt=0;}
  }
  globalThis.VisualGate=VisualGate;
  if(typeof module!=="undefined")module.exports={VisualGate,delta,tileChange};
})();

