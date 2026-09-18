import "./ppocr-core.js";
import * as ort from "./vendor/onnxruntime/ort.wasm.min.mjs";

const { detectorSize, detectorTensor, recognizerTensor, parseCharacterDictionary, decodeCtc } = globalThis.PpOcrCore;
const base = new URL("./vendor/", import.meta.url);

ort.env.wasm.wasmPaths = new URL("onnxruntime/", base).href;
ort.env.wasm.numThreads = 1;

function dimensions(source) {
  const width = source.width || source.videoWidth || source.naturalWidth;
  const height = source.height || source.videoHeight || source.naturalHeight;
  if (!width || !height) throw new Error("PP-OCR 입력 이미지 크기를 확인할 수 없습니다.");
  return { width, height };
}

function imageData(source, width, height) {
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height);
  canvas.width = canvas.height = 1;
  return data;
}

function probabilityBoxes(values, width, height, threshold = .3, boxThreshold = .6) {
  const seen = new Uint8Array(width * height), boxes = [];
  for (let seed = 0; seed < values.length; seed++) {
    if (seen[seed] || values[seed] < threshold) continue;
    const queue = [seed]; seen[seed] = 1;
    let head = 0, left = width, top = height, right = 0, bottom = 0, score = 0, count = 0;
    while (head < queue.length) {
      const index = queue[head++], x = index % width, y = (index / width) | 0;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      score += values[index]; count++;
      const candidates = [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y ? index - width : -1, y + 1 < height ? index + width : -1];
      for (const next of candidates) if (next >= 0 && !seen[next] && values[next] >= threshold) { seen[next] = 1; queue.push(next); }
    }
    if (count < 6 || score / count < boxThreshold) continue;
    const padX = Math.max(2, Math.round((right - left + 1) * .25));
    const padY = Math.max(2, Math.round((bottom - top + 1) * .25));
    boxes.push({ x: Math.max(0, left - padX), y: Math.max(0, top - padY),
      w: Math.min(width, right + padX + 1) - Math.max(0, left - padX),
      h: Math.min(height, bottom + padY + 1) - Math.max(0, top - padY), score: score / count });
  }
  // Axis-aligned grouping is intentionally limited to straight lecture slides.
  // ponytail: add contour/unclip/perspective only after real LearnUs samples show a need.
  return boxes.filter(box => box.w >= 4 && box.h >= 4).sort((a, b) => a.y - b.y || a.x - b.x).slice(0, 1000);
}

export class PpOcrV5 {
  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const [detector, recognizer, yaml] = await Promise.all([
        fetch(new URL("ppocr/PP-OCRv5_mobile_det.onnx", base)).then(r => r.arrayBuffer()),
        fetch(new URL("ppocr/korean_PP-OCRv5_mobile_rec.onnx", base)).then(r => r.arrayBuffer()),
        fetch(new URL("ppocr/korean_PP-OCRv5_mobile_rec.inference.yml", base)).then(r => r.text()),
      ]);
      this.characters = parseCharacterDictionary(yaml);
      const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
      [this.detector, this.recognizer] = await Promise.all([
        ort.InferenceSession.create(detector, options), ort.InferenceSession.create(recognizer, options),
      ]);
      return this;
    })();
    return this.ready;
  }

  async recognizeLine(source) {
    await this.init();
    const sourceSize = dimensions(source), resizedWidth = Math.max(1, Math.min(3200, Math.ceil(48 * sourceSize.width / sourceSize.height)));
    const inputWidth = Math.max(32, Math.ceil(resizedWidth / 32) * 32);
    const input = recognizerTensor(imageData(source, resizedWidth, 48), inputWidth);
    const result = await this.recognizer.run({ x: new ort.Tensor("float32", input.data, [1, 3, 48, inputWidth]) });
    const output = result.fetch_name_0 || Object.values(result)[0];
    return decodeCtc(output.data, output.dims.at(-2), output.dims.at(-1), this.characters);
  }

  async detect(source) {
    await this.init();
    const sourceSize = dimensions(source), size = detectorSize(sourceSize.width, sourceSize.height);
    const input = detectorTensor(imageData(source, size.width, size.height));
    const started = performance.now();
    const result = await this.detector.run({ x: new ort.Tensor("float32", input, [1, 3, size.height, size.width]) });
    const output = result.fetch_name_0 || Object.values(result)[0];
    return { boxes: probabilityBoxes(output.data, output.dims.at(-1), output.dims.at(-2)), size, inferenceMs: performance.now() - started };
  }

  async recognize(source) {
    const sourceSize = dimensions(source), detected = await this.detect(source), lines = [];
    for (const box of detected.boxes) {
      const x = Math.round(box.x / detected.size.width * sourceSize.width), y = Math.round(box.y / detected.size.height * sourceSize.height);
      const width = Math.max(1, Math.round(box.w / detected.size.width * sourceSize.width));
      const height = Math.max(1, Math.round(box.h / detected.size.height * sourceSize.height));
      const crop = new OffscreenCanvas(width, height), context = crop.getContext("2d");
      context.drawImage(source, x, y, width, height, 0, 0, width, height);
      const line = await this.recognizeLine(crop);
      crop.width = crop.height = 1;
      if (line.text.trim()) lines.push({ ...line, box: { x, y, width, height } });
    }
    return { text: lines.map(line => line.text).join("\n"), lines, detection: detected };
  }

  async dispose() {
    await Promise.allSettled([this.detector?.release?.(), this.recognizer?.release?.()]);
    this.detector = this.recognizer = this.ready = null;
  }
}

export { probabilityBoxes };
