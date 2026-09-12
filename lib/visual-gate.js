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
    constructor(){this.previous=null;this.recognized=null;this.submitted=null;this.changedAt=0;this.lastMotion=0;this.lastAccepted=0;this.slideId=0;}
    inspect(canvas,now=performance.now(),force=false){
      const current={low:sample(canvas,64,36),high:sample(canvas,256,144)};
      const movement=delta(this.previous?.low,current.low), accumulated=tileChange(this.recognized?.high,current.high);
      if(movement>.015)this.lastMotion=now;
      if(accumulated>.035&&!this.changedAt)this.changedAt=now;
      const transition=delta(this.recognized?.low,current.low)>.32;
      const changed=!this.recognized||accumulated>.035;
      const duplicate=this.submitted&&delta(this.submitted.high,current.high)<.004;
      const accept=force||(!duplicate&&(!this.recognized||(changed&&(transition||now-this.lastMotion>=600||now-this.changedAt>=2500))||now-this.lastAccepted>=12000));
      this.previous=current;
      if(accept){ if(transition)this.slideId++;this.submitted=current;this.lastAccepted=now; }
      return {accept,sample:current,slideId:this.slideId,movement,accumulated};
    }
    complete(sample){this.recognized=sample;this.changedAt=0;}
    reset(){this.previous=null;this.recognized=null;this.submitted=null;this.changedAt=0;}
  }
  globalThis.VisualGate=VisualGate;
  if(typeof module!=="undefined")module.exports={VisualGate,delta,tileChange};
})();

