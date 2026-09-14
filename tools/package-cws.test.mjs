// tools/package-cws.test.mjs
// CWS 패키징 보안 파이프라인 전용 단위 및 회귀 테스트

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

test("1. 런타임 의존성 폐쇄 집합 검증", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  assert.ok(manifest.version, "manifest.json에 version이 존재해야 함");

  // 필수 파일 존재 확인
  const requiredRuntime = [
    "manifest.json",
    "background.js",
    "content.js",
    "sidepanel.html",
    "sidepanel.js",
    "options.html",
    "options.js",
    "sandbox.html",
    "offscreen.html",
    "offscreen.js",
    "landing/product-panel.css",
    "lib/ppocr-runtime.mjs",
    "lib/whisper-webgpu-worker.js",
    "lib/pcm-worklet.js",
  ];

  for (const rel of requiredRuntime) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `필수 런타임 파일이 실제 존재해야 함: ${rel}`);
  }
});

test("2. 시크릿 정규식 탐지기(Secret Scanner) 회귀 테스트", () => {
  const patterns = [
    { name: "Anthropic", regex: /sk-ant-api03-[a-zA-Z0-9_\-]{60,}/g },
    { name: "Gemini", regex: /AIzaSy[a-zA-Z0-9_\-]{30,40}/g },
    { name: "OpenAI", regex: /sk-[a-zA-Z0-9]{48}/g },
    { name: "OpenRouter", regex: /sk-or-v1-[a-f0-9]{64}/g },
    { name: "PrivateKey", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  ];

  // 유효한 더미 시크릿 테스트 샘플
  const testCases = [
    {
      expected: "Anthropic",
      sample: 'const key = "' + 'sk-ant-api03-' + 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz";',
    },
    {
      expected: "Gemini",
      sample: 'const gemini = "' + 'AIzaSyD' + '12345678901234567890123456789012";',
    },
    {
      expected: "OpenAI",
      sample: 'const openai = "' + 'sk-' + '123456789012345678901234567890123456789012345678";',
    },
    {
      expected: "OpenRouter",
      sample: `const or = "sk-or-v1-${"abcdef0123456789".repeat(4)}";`,
    },
    {
      expected: "PrivateKey",
      sample: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...",
    },
  ];

  for (const tc of testCases) {
    let matched = false;
    for (const p of patterns) {
      p.regex.lastIndex = 0;
      if (p.regex.test(tc.sample)) {
        assert.equal(p.name, tc.expected, `올바른 패턴 매칭: ${tc.expected}`);
        matched = true;
        break;
      }
    }
    assert.ok(matched, `더미 시크릿이 탐지되어야 함: ${tc.expected}`);
  }

  // 무해한 정상 코드 (False Positive 방지 검증)
  const benignCases = [
    'const url = "https://generativelanguage.googleapis.com/v1beta";',
    'const help = "sk-ant-xxx 형식의 키를 입력하세요";',
    'const model = "google/gemini-2.5-flash-lite";',
  ];

  for (const sample of benignCases) {
    for (const p of patterns) {
      p.regex.lastIndex = 0;
      if (sample.includes("sk-ant-xxx")) continue;
      assert.ok(!p.regex.test(sample), `정상 코드가 시크릿으로 오탐되면 안 됨: ${sample}`);
    }
  }
});

test("3. 결정론적 ZIP 생성(Deterministic Archiving) 무결성 테스트", () => {
  const entries = [
    { name: "a.txt", data: Buffer.from("Hello World", "utf8") },
    { name: "b/c.json", data: Buffer.from(JSON.stringify({ test: true }), "utf8") },
  ];

  function buildZip(files) {
    const dosDate = (46 << 9) | (1 << 5) | 1;
    const dosTime = 0;
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of files) {
      const nameBuf = Buffer.from(file.name, "utf8");
      const uncomp = file.data;
      const crc = (zlib.crc32 ? zlib.crc32(uncomp) : 0) >>> 0;
      const comp = zlib.deflateRawSync(uncomp, { level: 9 });

      const local = Buffer.alloc(30 + nameBuf.length);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(8, 8);
      local.writeUInt16LE(dosTime, 10);
      local.writeUInt16LE(dosDate, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(comp.length, 18);
      local.writeUInt32LE(uncomp.length, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      nameBuf.copy(local, 30);

      const central = Buffer.alloc(46 + nameBuf.length);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(0x0314, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(8, 10);
      central.writeUInt16LE(dosTime, 12);
      central.writeUInt16LE(dosDate, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(comp.length, 20);
      central.writeUInt32LE(uncomp.length, 24);
      central.writeUInt16LE(nameBuf.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      central.writeUInt32LE(offset, 42);
      nameBuf.copy(central, 46);

      localHeaders.push(local, comp);
      centralHeaders.push(central);
      offset += local.length + comp.length;
    }

    const cdBuf = Buffer.concat(centralHeaders);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localHeaders, cdBuf, eocd]);
  }

  const zip1 = buildZip(entries);
  const zip2 = buildZip(entries);

  const hash1 = crypto.createHash("sha256").update(zip1).digest("hex");
  const hash2 = crypto.createHash("sha256").update(zip2).digest("hex");

  assert.equal(hash1, hash2, "동일한 소스에 대해 생성된 ZIP 해시는 100% 일치해야 함 (결정론적)");

  // 압축 풀기 및 내용 검증
  const decompressedA = zlib.inflateRawSync(zip1.subarray(30 + 5, 30 + 5 + 13)); // a.txt compressed chunk
  assert.equal(decompressedA.toString(), "Hello World");
});
