(() => {
  const DET_MEAN = [0.485, 0.456, 0.406];
  const DET_STD = [0.229, 0.224, 0.225];

  function detectorSize(width, height, limit = 960) {
    const ratio = Math.min(1, limit / Math.max(width, height));
    return {
      width: Math.max(32, Math.round(width * ratio / 32) * 32),
      height: Math.max(32, Math.round(height * ratio / 32) * 32),
    };
  }

  function detectorTensor(image) {
    const pixels = image.data, area = image.width * image.height;
    const data = new Float32Array(area * 3);
    for (let i = 0; i < area; i++) {
      const p = i * 4;
      data[i] = (pixels[p + 2] / 255 - DET_MEAN[0]) / DET_STD[0];
      data[area + i] = (pixels[p + 1] / 255 - DET_MEAN[1]) / DET_STD[1];
      data[area * 2 + i] = (pixels[p] / 255 - DET_MEAN[2]) / DET_STD[2];
    }
    return data;
  }

  function recognizerTensor(image, maxWidth = 320) {
    const ratio = image.width / image.height;
    const width = Math.max(1, Math.min(maxWidth, Math.ceil(48 * ratio)));
    const area = 48 * maxWidth, data = new Float32Array(area * 3);
    const pixels = image.data;
    for (let y = 0; y < 48; y++) for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4, target = y * maxWidth + x;
      data[target] = (pixels[source + 2] / 255 - 0.5) / 0.5;
      data[area + target] = (pixels[source + 1] / 255 - 0.5) / 0.5;
      data[area * 2 + target] = (pixels[source] / 255 - 0.5) / 0.5;
    }
    return { data, width };
  }

  function parseCharacterDictionary(yaml) {
    const marker = "  character_dict:";
    const start = yaml.split(/\r?\n/).indexOf(marker);
    if (start < 0) throw new Error("PP-OCR 문자 사전을 찾지 못했습니다.");
    const chars = yaml.split(/\r?\n/).slice(start + 1)
      .filter(line => line.startsWith("  - ")).map(line => {
        const value = line.slice(4);
        return value.startsWith("'") && value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value;
      });
    if (chars.length !== 11945) throw new Error(`PP-OCR 문자 사전 길이가 다릅니다: ${chars.length}`);
    // Official CTCLabelDecode prepends blank. The exported model has one extra class
    // for use_space_char, which PaddleOCR appends after the file dictionary.
    return ["blank", ...chars, " "];
  }

  function winnerProbability(values, offset, classes, winner, max) {
    if (max >= 0 && max <= 1) return max;
    let sum = 0;
    for (let i = 0; i < classes; i++) sum += Math.exp(values[offset + i] - max);
    return 1 / sum;
  }

  function decodeCtc(values, steps, classes, characters) {
    if (classes !== characters.length || values.length !== steps * classes) throw new Error("PP-OCR 출력과 문자 사전 크기가 다릅니다.");
    const text = [], confidence = [];
    let previous = -1;
    for (let step = 0; step < steps; step++) {
      const offset = step * classes;
      let winner = 0, max = values[offset];
      for (let i = 1; i < classes; i++) if (values[offset + i] > max) { winner = i; max = values[offset + i]; }
      if (winner && winner !== previous) {
        text.push(characters[winner]);
        confidence.push(winnerProbability(values, offset, classes, winner, max));
      }
      previous = winner;
    }
    return { text: text.join(""), confidence: confidence.length ? confidence.reduce((a, b) => a + b, 0) / confidence.length : 0 };
  }

  const api = { detectorSize, detectorTensor, recognizerTensor, parseCharacterDictionary, decodeCtc };
  globalThis.PpOcrCore = api;
  if (typeof module !== "undefined") module.exports = api;
})();
