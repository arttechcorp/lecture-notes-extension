// Local energy gate baseline. Silero VAD is a separately validated model upgrade.
(() => {
  class AudioSegments {
    constructor(emit,rate=16000,stretch=false){this.emit=emit;this.rate=rate;this.stretch=stretch;this.buffer=new Float32Array(rate*30);this.length=0;this.silence=0;this.speech=false;this.overlap=0;}
    push(input,time,epoch,playbackRate=1){
      if(this.epoch!==undefined&&this.epoch!==epoch)this.flush();
      this.epoch=epoch;this.playbackRate=playbackRate;const speed=playbackRate>0?playbackRate:1;
      let rms=0;for(const v of input)rms+=v*v;const voice=Math.sqrt(rms/input.length)>.0005;
      if(voice){this.speech=true;this.silence=0;}else this.silence+=input.length;
      if(!this.length)this.start=time;
      // Whisper's encoder pads every call to 30 s, so a call costs about the same whether it carries 10 s or 29 s:
      // short chunks burn the same fixed cost several times over and are what pushes the ASR past real time.
      // Fill the window we already pay for. 배속 인식 보정 resamples back to 1x first, so its ceiling scales down.
      const ceiling=Math.min(this.buffer.length,Math.round(this.rate*29/(this.stretch?speed:1)));
      for(const v of input){this.buffer[this.length++]=v;if(this.length>=ceiling)this.flush(true);}
      if(!this.speech&&this.length>this.rate*.4){const keep=Math.round(this.rate*.4);this.buffer.copyWithin(0,this.length-keep,this.length);this.start=time+(input.length-keep)/this.rate*playbackRate;this.length=keep;}
      // A pause is a lecture-time cue: at 2x the speaker's 0.7 s breath arrives as 0.35 s of samples, so the gate
      // scales with playbackRate. Without it nothing ever flushes on silence and every chunk is a hard 20 s cut
      // through the middle of a sentence. The 10 s minimum stays wall-clock: it bounds ASR calls per real second.
      if(this.speech&&this.length>=this.rate*10&&this.silence>=this.rate*.7/speed)this.flush();
    }
    flush(continued=false){
      if(this.length&&this.speech)this.emit({audio:this.buffer.slice(0,this.length),time:this.start,t1:this.start+this.length/this.rate*this.playbackRate,epoch:this.epoch,overlap:this.overlap,rate:this.playbackRate||1});
      const keep=continued?Math.min(this.length,this.rate):0;
      if(keep)this.buffer.copyWithin(0,this.length-keep,this.length);
      this.start+=(this.length-keep)/this.rate*(this.playbackRate||1);this.length=keep;this.speech=continued;this.overlap=keep/this.rate;this.silence=0;
    }
    clear(){this.buffer.fill(0);this.length=0;this.speech=false;}
  }
  globalThis.AudioSegments=AudioSegments;
  if(typeof module!=="undefined")module.exports={AudioSegments};
})();

