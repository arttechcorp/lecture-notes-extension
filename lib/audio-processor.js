class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 16000 * 5; // 5 seconds of audio at 16kHz
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    
    // Convert stereo to mono if needed
    const channelData = input[0]; 
    
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.offset++] = channelData[i];
      if (this.offset >= this.bufferSize) {
        // Send chunk to main thread
        this.port.postMessage({ audio: new Float32Array(this.buffer) });
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);

