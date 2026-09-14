// Local energy gate baseline. Silero VAD is a separately validated model upgrade.
(() => {
  class AudioSegments {
    constructor(emit,rate=16000){this.emit=emit;this.rate=rate;this.buffer=new Float32Array(rate*20);this.length=0;this.silence=0;this.speech=false;this.overlap=0;}
    push(input,time,epoch,playbackRate=1){
      if(this.epoch!==undefined&&this.epoch!==epoch)this.flush();
      this.epoch=epoch;this.playbackRate=playbackRate;
      let rms=0;for(const v of input)rms+=v*v;const voice=Math.sqrt(rms/input.length)>.0005;
      if(voice){this.speech=true;this.silence=0;}else this.silence+=input.length;
      if(!this.length)this.start=time;
      for(const v of input){this.buffer[this.length++]=v;if(this.length===this.buffer.length)this.flush(true);}
      if(!this.speech&&this.length>this.rate*.4){const keep=Math.round(this.rate*.4);this.buffer.copyWithin(0,this.length-keep,this.length);this.start=time+(input.length-keep)/this.rate*playbackRate;this.length=keep;}
      if(this.speech&&this.length>=this.rate*10&&this.silence>=this.rate*.7)this.flush();
    }
    flush(continued=false){
      if(this.length&&this.speech)this.emit({audio:this.buffer.slice(0,this.length),time:this.start,t1:this.start+this.length/this.rate*this.playbackRate,epoch:this.epoch,overlap:this.overlap});
      const keep=continued?Math.min(this.length,this.rate):0;
      if(keep)this.buffer.copyWithin(0,this.length-keep,this.length);
      this.start+=(this.length-keep)/this.rate*(this.playbackRate||1);this.length=keep;this.speech=continued;this.overlap=keep/this.rate;this.silence=0;
    }
    clear(){this.buffer.fill(0);this.length=0;this.speech=false;}
  }
  globalThis.AudioSegments=AudioSegments;
  if(typeof module!=="undefined")module.exports={AudioSegments};
})();

