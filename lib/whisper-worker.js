import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;

async function initTranscriber(progressCallback) {
  if (transcriber) return transcriber;
  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
    progress_callback: progressCallback,
  });
  return transcriber;
}

self.onmessage = async (e) => {
  const { type, audio, id } = e.data;

  if (type === 'INIT') {
    try {
      await initTranscriber(data => {
        self.postMessage({ type: 'PROGRESS', data });
      });
      self.postMessage({ type: 'READY' });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  } else if (type === 'TRANSCRIBE') {
    try {
      const model = await initTranscriber();
      // Whisper expects Float32Array at 16kHz
      const output = await model(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        language: 'korean',
        task: 'transcribe',
      });
      self.postMessage({ type: 'TRANSCRIBED', id, text: output.text });
    } catch (err) {
      self.postMessage({ type: 'ERROR', error: err.message });
    }
  }
};
