const assert = require("node:assert/strict");
const { detectorSize, detectorTensor, recognizerTensor, parseCharacterDictionary, decodeCtc } = require("./ppocr-core.js");

assert.deepEqual(detectorSize(1920, 1080), { width: 960, height: 544 });
assert.deepEqual(detectorSize(20, 20), { width: 32, height: 32 });

const pixel = { width: 1, height: 1, data: new Uint8ClampedArray([255, 128, 0, 255]) };
const det = detectorTensor(pixel);
assert.ok(Math.abs(det[0] - (0 / 255 - .485) / .229) < 1e-6, "detector uses BGR order");
assert.ok(Math.abs(det[2] - (255 / 255 - .406) / .225) < 1e-6);

const rec = recognizerTensor({ width: 1, height: 48, data: new Uint8ClampedArray(48 * 4).fill(255) });
assert.equal(rec.width, 1); assert.equal(rec.data.length, 48 * 320 * 3);
assert.equal(rec.data[0], 1); assert.equal(rec.data[1], 0, "recognizer padding is zero after normalization");

const dictionary = parseCharacterDictionary("x\n  character_dict:\n  - 가\n  - '1'\n" + Array.from({ length: 11943 }, (_, i) => `  - ${i}`).join("\n"));
assert.equal(dictionary.length, 11947); assert.equal(dictionary[0], "blank"); assert.equal(dictionary[1], "가"); assert.equal(dictionary[2], "1"); assert.equal(dictionary.at(-1), " ");

const values = new Float32Array([
  4, 0, 0,
  0, 4, 0,
  0, 4, 0,
  4, 0, 0,
  0, 4, 0,
  0, 0, 4,
]);
const decoded = decodeCtc(values, 6, 3, ["blank", "가", " "]);
assert.equal(decoded.text, "가가 ");
assert.ok(decoded.confidence > .9);

console.log("ppocr-core: all tests passed");
