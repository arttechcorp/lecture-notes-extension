import { PpOcrV5 } from "../lib/ppocr-runtime.mjs";

const canvas = document.getElementById("slide"), context = canvas.getContext("2d");
context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
context.fillStyle = "black"; context.font = "bold 58px 'Malgun Gothic', Arial, sans-serif";
context.fillText("전압 Voltage 123456", 55, 155);
context.fillText("옴의 법칙 V = IR", 55, 290);

const line = new OffscreenCanvas(850, 82), lineContext = line.getContext("2d");
lineContext.fillStyle = "white"; lineContext.fillRect(0, 0, line.width, line.height);
lineContext.fillStyle = "black"; lineContext.font = "bold 58px 'Malgun Gothic', Arial, sans-serif";
lineContext.fillText("전압 Voltage 123456", 8, 62);

try {
  const engine = new PpOcrV5(), started = performance.now();
  const direct = await engine.recognizeLine(line), full = await engine.recognize(canvas);
  const result = { ok: true, direct, fullText: full.text, boxes: full.detection.boxes.length, detectorMs: full.detection.inferenceMs, totalMs: performance.now() - started };
  document.getElementById("result").textContent = JSON.stringify(result, null, 2);
  globalThis.probeResult = result;
  await engine.dispose(); line.width = line.height = 1;
} catch (error) {
  globalThis.probeResult = { ok: false, error: error.stack || error.message };
  document.getElementById("result").textContent = JSON.stringify(globalThis.probeResult, null, 2);
}
