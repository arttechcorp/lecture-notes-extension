// Emits bounded 100 ms mono packets; the direct source->destination path preserves listening audio.
class LecturePCM extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(Math.round(sampleRate/10));this.offset=0;this.active=true;
    this.port.onmessage=({data})=>{if(data==="flush"){if(this.offset)this.port.postMessage(this.buffer.slice(0,this.offset));this.offset=0;}if(data==="stop")this.active=false;};
  }
  process(inputs){
    if(!this.active)return false;
    const channels=inputs[0];if(!channels?.length)return true;
    for(let i=0;i<channels[0].length;i++){
      let v=0;for(const channel of channels)v+=channel[i]||0;
      this.buffer[this.offset++]=v/channels.length;
      if(this.offset===this.buffer.length){const out=this.buffer;this.port.postMessage(out,[out.buffer]);this.buffer=new Float32Array(Math.round(sampleRate/10));this.offset=0;}
    }
    return true;
  }
}
registerProcessor("lecture-pcm",LecturePCM);

