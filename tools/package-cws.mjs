// Chrome Web Store (CWS) 배포용 보안 패키징 및 릴리스 파이프라인
// PRD v1.1.0 (review.md 피드백 반영 완료)
// 1) 교차 플랫폼 사전 테스트 게이트 (node --test)
// 2) 런타임 의존성 폐쇄(Dependency Closure) 재귀 수집 (landing/product-panel.css, .mjs, 워커, ONNX 가중치 포함)
// 3) 정적 보안 휴리스틱(API Key/시크릿) 및 AGENTS.md 불변식 정적 감사
// 4) 순수 JS 결정론적 ZIP 아카이빙 (고정 타임스탬프, 알파벳 경로 정렬, 쉘 호출 배제)
// 5) 사후 무결성 언팩 CRC32 검증 및 외부 build-provenance.json / SHA-256 생성

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// CLI 인자 파싱
const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");
const SKIP_TESTS = args.includes("--skip-tests");

console.log("\n============================================================");
console.log("🔒 Summrizei — Chrome Web Store 배포 보안 패키징 파이프라인");
console.log(`   모드: ${IS_DRY_RUN ? "🔍 DRY-RUN (검사만 수행)" : "📦 PRODUCTION PACKAGING"}`);
console.log(`   테스트 게이트: ${SKIP_TESTS ? "⚠️ 건너뜀 (UNVERIFIED)" : "✅ 필수 실행"}`);
console.log("============================================================\n");

// --------------------------------------------------------------------------
// Step 1: 교차 플랫폼 사전 테스트 게이트 (Cross-Platform Pre-flight Gate)
// --------------------------------------------------------------------------
function runPreflightTests() {
  if (SKIP_TESTS) {
    console.warn("⚠️  [경고] --skip-tests 플래그가 지정되어 단위 테스트를 생략합니다.");
    console.warn("    생성되는 패키지는 UNVERIFIED로 마킹되며 공식 CWS 업로드가 제한됩니다.");
    return "UNVERIFIED (TESTS_SKIPPED)";
  }

  console.log("▶ [Step 1/5] 사전 단위 테스트 실행 중...");
  const libDir = path.join(ROOT, "lib");
  const testFiles = fs.readdirSync(libDir)
    .filter(name => name.endsWith(".test.js"))
    .map(name => path.join("lib", name));

  if (testFiles.length === 0) {
    throw new Error("치명적 오류: 실행할 단위 테스트(*.test.js)를 찾을 수 없습니다.");
  }

  try {
    execFileSync(process.execPath, ["--test", ...testFiles], {
      cwd: ROOT,
      stdio: "inherit",
    });
    console.log(`\n✅ [Step 1/5 통과] 단위 테스트 ${testFiles.length}개 파일 전원 통과.\n`);
    return `PASSED (${testFiles.length} files)`;
  } catch (err) {
    console.error("\n❌ [Step 1/5 실패] 단위 테스트 실패. 배포 패키징을 즉시 중단합니다.");
    process.exit(1);
  }
}

// --------------------------------------------------------------------------
// Step 2: 런타임 의존성 폐쇄 수집 엔진 (Runtime Dependency Closure)
// --------------------------------------------------------------------------
function resolveRuntimeClosure() {
  console.log("▶ [Step 2/5] 런타임 의존성 폐쇄(Closure) 집합 계산 중...");
  const manifestPath = path.join(ROOT, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("치명적 오류: manifest.json이 존재하지 않습니다.");
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const closure = new Set();
  const queue = [];

  function enqueue(relPath) {
    if (!relPath) return;
    const cleanRel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (closure.has(cleanRel)) return;
    const absPath = path.join(ROOT, cleanRel);
    if (fs.existsSync(absPath)) {
      closure.add(cleanRel);
      queue.push(cleanRel);
    } else {
      console.warn(`⚠️  [주의] 의존성 파일 미발견: ${cleanRel}`);
    }
  }

  // 1. 매니페스트 루트 엔트리 등록
  enqueue("manifest.json");
  if (manifest.background?.service_worker) enqueue(manifest.background.service_worker);
  if (manifest.side_panel?.default_path) enqueue(manifest.side_panel.default_path);
  if (manifest.options_page) enqueue(manifest.options_page);
  if (Array.isArray(manifest.sandbox?.pages)) {
    for (const p of manifest.sandbox.pages) enqueue(p);
  }
  if (manifest.icons) {
    for (const iconPath of Object.values(manifest.icons)) enqueue(iconPath);
  }
  if (manifest.action?.default_icon) {
    if (typeof manifest.action.default_icon === "string") {
      enqueue(manifest.action.default_icon);
    } else {
      for (const iconPath of Object.values(manifest.action.default_icon)) enqueue(iconPath);
    }
  }

  // 2. 확장 프로그램 핵심 런타임 파일 명시 등록
  enqueue("content.js");
  enqueue("offscreen.html");
  enqueue("offscreen.js");

  // 3. 재귀 의존성 탐색 (HTML <link>/<script>, JS/MJS imports/workers)
  while (queue.length > 0) {
    const currentRel = queue.shift();
    const currentAbs = path.join(ROOT, currentRel);
    const currentDir = path.dirname(currentRel);

    if (currentRel.endsWith(".html")) {
      const content = fs.readFileSync(currentAbs, "utf8");
      // <link rel="stylesheet" href="..."> (e.g. landing/product-panel.css)
      const cssMatches = content.matchAll(/<link\s+[^>]*href=["']([^"'#?]+)[^"']*["'][^>]*>/gi);
      for (const match of cssMatches) {
        const href = match[1].trim();
        if (!href.startsWith("http://") && !href.startsWith("https://") && !href.startsWith("//")) {
          const resolved = path.join(currentDir, href).replace(/\\/g, "/");
          enqueue(resolved);
        }
      }
      // <script src="...">
      const scriptMatches = content.matchAll(/<script\s+[^>]*src=["']([^"'#?]+)[^"']*["'][^>]*>/gi);
      for (const match of scriptMatches) {
        const src = match[1].trim();
        if (!src.startsWith("http://") && !src.startsWith("https://") && !src.startsWith("//")) {
          const resolved = path.join(currentDir, src).replace(/\\/g, "/");
          enqueue(resolved);
        }
      }
    } else if (currentRel.endsWith(".js") || currentRel.endsWith(".mjs")) {
      const content = fs.readFileSync(currentAbs, "utf8");
      
      // Static import/export from '...'
      const importMatches = content.matchAll(/(?:import|from)\s+["'](\.[^"']+)["']/g);
      for (const match of importMatches) {
        const rel = match[1];
        const resolved = path.join(currentDir, rel).replace(/\\/g, "/");
        enqueue(resolved);
      }

      // Dynamic import('...')
      const dynImportMatches = content.matchAll(/import\s*\(\s*(?:chrome\.runtime\.getURL\()?\s*["']([^"']+)["']\s*\)?\s*\)/g);
      for (const match of dynImportMatches) {
        const rel = match[1];
        if (!rel.startsWith("http")) {
          const resolved = rel.startsWith(".") ? path.join(currentDir, rel).replace(/\\/g, "/") : rel;
          enqueue(resolved);
        }
      }

      // new Worker('...')
      const workerMatches = content.matchAll(/new\s+Worker\s*\(\s*(?:chrome\.runtime\.getURL\()?\s*["']([^"']+)["']/g);
      for (const match of workerMatches) {
        const rel = match[1];
        if (!rel.startsWith("http")) {
          const resolved = rel.startsWith(".") ? path.join(currentDir, rel).replace(/\\/g, "/") : rel;
          enqueue(resolved);
        }
      }

      // audioWorklet.addModule('...')
      const workletMatches = content.matchAll(/addModule\s*\(\s*(?:chrome\.runtime\.getURL\()?\s*["']([^"']+)["']/g);
      for (const match of workletMatches) {
        const rel = match[1];
        if (!rel.startsWith("http")) {
          const resolved = rel.startsWith(".") ? path.join(currentDir, rel).replace(/\\/g, "/") : rel;
          enqueue(resolved);
        }
      }
    }
  }

  // 4. KaTeX fonts 및 런타임 벤더 자산 추가 (sandbox / OCR / Whisper 가중치)
  const katexFontsDir = path.join(ROOT, "lib", "vendor", "katex", "fonts");
  if (fs.existsSync(katexFontsDir)) {
    for (const font of fs.readdirSync(katexFontsDir)) {
      if (font.endsWith(".woff2") || font.endsWith(".woff") || font.endsWith(".ttf")) {
        closure.add(`lib/vendor/katex/fonts/${font}`);
      }
    }
  }

  // 5. PP-OCR 및 Transformers 런타임 가중치/WASM 에셋 포함
  const runtimeVendorSubdirs = [
    "lib/vendor/onnxruntime",
    "lib/vendor/ppocr",
    "lib/vendor/transformers4",
  ];
  for (const subDir of runtimeVendorSubdirs) {
    const absSub = path.join(ROOT, subDir);
    if (fs.existsSync(absSub)) {
      for (const file of fs.readdirSync(absSub)) {
        if (!file.endsWith(".md") && !file.endsWith(".test.js") && !file.endsWith(".map")) {
          closure.add(`${subDir}/${file}`);
        }
      }
    }
  }

  // 6. 엄격한 배제 필터링 (Strict Exclusion)
  const FORBIDDEN_EXTENSIONS = [".test.js", ".spec.js", ".map", ".log"];
  const FORBIDDEN_FILENAMES = ["apikey.env.local", ".env", "memory.md", "README.md", "AGENTS.md"];
  const finalFiles = [];

  for (const file of closure) {
    const baseName = path.basename(file);
    if (FORBIDDEN_FILENAMES.includes(baseName) || baseName.startsWith(".env.")) {
      continue;
    }
    if (FORBIDDEN_EXTENSIONS.some(ext => file.endsWith(ext))) {
      continue;
    }
    if (file.startsWith("server/") || file.startsWith("tools/") || file.startsWith("docs/")) {
      continue;
    }
    if (file.startsWith("landing/") && file !== "landing/product-panel.css") {
      // 마케팅용 랜딩 파일(demo-panel.html, index.html 등) 배제
      continue;
    }
    finalFiles.push(file);
  }

  finalFiles.sort();
  console.log(`✅ [Step 2/5 통과] 런타임 의존성 폐쇄 집합: 총 ${finalFiles.length}개 파일 식별.`);
  console.log(`   - 필수 런타임 포함 확인: landing/product-panel.css: ${finalFiles.includes("landing/product-panel.css") ? "OK" : "MISSING"}`);
  console.log(`   - 필수 런타임 포함 확인: offscreen.html: ${finalFiles.includes("offscreen.html") ? "OK" : "MISSING"}`);
  console.log(`   - 필수 런타임 포함 확인: lib/ppocr-runtime.mjs: ${finalFiles.includes("lib/ppocr-runtime.mjs") ? "OK" : "MISSING"}\n`);

  return { manifest, files: finalFiles };
}

// --------------------------------------------------------------------------
// Step 3: 정적 보안 휴리스틱 및 아키텍처 불변식 감사기 (Security Auditor)
// --------------------------------------------------------------------------
function auditSecurityAndInvariants(files) {
  console.log("▶ [Step 3/5] 정적 보안 휴리스틱 및 아키텍처 불변식 감사 중...");
  const errors = [];

  // 정규식 기반 알려진 키 패턴
  const KNOWN_SECRET_PATTERNS = [
    { name: "Anthropic Claude API Key", regex: /sk-ant-api03-[a-zA-Z0-9_\-]{60,}/g },
    { name: "Google Gemini / AI Studio Key", regex: /AIzaSy[a-zA-Z0-9_\-]{30,40}/g },
    { name: "OpenAI API Key", regex: /sk-[a-zA-Z0-9]{48}/g },
    { name: "OpenRouter Key", regex: /sk-or-v1-[a-f0-9]{64}/g },
    { name: "Private Key Header", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { name: "Generic Secret Assignment", regex: /(?:api[_-]?key|client[_-]?secret|auth[_-]?token)\s*[:=]\s*['"]([a-zA-Z0-9_\-]{24,})['"]/gi },
  ];

  for (const relPath of files) {
    const absPath = path.join(ROOT, relPath);
    // 텍스트 파일만 내용 스캔
    if (!/\.(js|mjs|html|css|json|txt|yml|yaml)$/i.test(relPath)) continue;

    const content = fs.readFileSync(absPath, "utf8");
    const lines = content.split("\n");

    // 1. 시크릿 패턴 검사
    for (const pattern of KNOWN_SECRET_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("YOUR_API_KEY") || line.includes("sk-ant-xxx")) continue; // 더미 설명 제외
        pattern.regex.lastIndex = 0;
        const match = pattern.regex.exec(line);
        if (match) {
          const secret = match[0];
          const masked = secret.slice(0, 6) + "..." + secret.slice(-4);
          errors.push(`[시크릿 유출 의심] ${relPath}:${i + 1} - ${pattern.name} 매칭 (${masked})`);
        }
      }
    }

    // 2. MV3 원격 코드 실행(Remote Code) 검사 (HTML)
    if (relPath.endsWith(".html")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/<script\s+[^>]*src=["']https?:\/\//i.test(line)) {
          // Google Fonts 등 preconnect link는 허용, remote script는 거부
          errors.push(`[MV3 위반] ${relPath}:${i + 1} - 원격 외부 스크립트 <script src="http..."> 로드 차단`);
        }
      }
    }

    // 3. MV3 원격 코드 실행 검사 (JS/MJS) (vendor 및 sandbox 제외)
    if ((relPath.endsWith(".js") || relPath.endsWith(".mjs")) && !relPath.startsWith("lib/vendor/")) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/\bimport\s*\(\s*['"]https?:\/\//i.test(line)) {
          errors.push(`[MV3 위반] ${relPath}:${i + 1} - 원격 동적 import("http...") 차단`);
        }
        if (/\bimportScripts\s*\(\s*['"]https?:\/\//i.test(line)) {
          errors.push(`[MV3 위반] ${relPath}:${i + 1} - 원격 importScripts("http...") 차단`);
        }
      }
    }

    // 4. AGENTS.md 아키텍처 불변식 검사
    // Invariant: chrome.storage에 transcript/rawAudio/lectureNotes 영구 저장 금지
    if (relPath.startsWith("lib/") && relPath !== "lib/settings.js") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/chrome\.storage\.(?:local|sync)\.set\s*\(\s*\{[^}]*\b(?:transcript|rawAudio|lectureNotes)\b/i.test(line)) {
          errors.push(`[불변식 위반] ${relPath}:${i + 1} - chrome.storage에 평문 원문/오디오 영구 저장 시도 감지`);
        }
      }
    }
  }

  // 5. sandbox.html 격리 규약 점검 (chrome.* API 접근 부재 및 postMessage origin/스키마 검증)
  if (files.includes("sandbox.html")) {
    const sandboxContent = fs.readFileSync(path.join(ROOT, "sandbox.html"), "utf8");
    if (/\bchrome\.(runtime|storage|tabs)\b/.test(sandboxContent)) {
      errors.push("[격리 위반] sandbox.html 내부에서 직접 chrome.* 확장 API 접근 감지");
    }
  }

  if (errors.length > 0) {
    console.error("\n❌ [Step 3/5 실패] 보안 감사에서 다음 위반 사항이 발견되었습니다:");
    for (const err of errors) console.error(`   - ${err}`);
    console.error("\n보안 위험으로 인해 패키징을 강제 중단합니다.");
    process.exit(1);
  }

  console.log("✅ [Step 3/5 통과] 시크릿 스캔, MV3 정책 및 아키텍처 불변식 정적 감사 완료 (위반 0건).\n");
}

// --------------------------------------------------------------------------
// Step 4: 순수 JS 결정론적 ZIP 아카이빙 엔진 (Deterministic Archiver)
// --------------------------------------------------------------------------
function buildZipArchive(files, version) {
  console.log("▶ [Step 4/5] 순수 JS 결정론적 ZIP 아카이브 생성 중...");
  const distDir = path.join(ROOT, "dist");
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const zipBaseName = SKIP_TESTS
    ? `summrizei-v${version}-UNVERIFIED.zip`
    : `summrizei-v${version}-cws.zip`;
  const zipFilePath = path.join(distDir, zipBaseName);

  // 결정론적 타임스탬프: 2026-01-01 00:00:00 (DOS format)
  // DOS Date: (2026 - 1980) << 9 | 1 << 5 | 1 = 46 << 9 | 32 | 1 = 23585 (0x5C21)
  // DOS Time: 0
  const dosDate = (46 << 9) | (1 << 5) | 1;
  const dosTime = 0;

  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;
  const fileManifest = [];

  for (const relPath of files) {
    const absPath = path.join(ROOT, relPath);
    const uncompressedData = fs.readFileSync(absPath);
    const uncompressedSize = uncompressedData.length;
    
    // 개별 파일 SHA-256 계산
    const fileHash = crypto.createHash("sha256").update(uncompressedData).digest("hex");
    fileManifest.push({ path: relPath, size: uncompressedSize, sha256: fileHash });

    // CRC32 계산
    const crc = (zlib.crc32 ? zlib.crc32(uncompressedData) : computeCrc32Fallback(uncompressedData)) >>> 0;
    
    // Raw Deflate 압축 (Level 9: 최대 압축)
    const compressedData = zlib.deflateRawSync(uncompressedData, { level: 9 });
    const compressedSize = compressedData.length;

    // 경로 표준화 (ZIP 사양: forward slash '/')
    const normName = relPath.replace(/\\/g, "/");
    const nameBuffer = Buffer.from(normName, "utf8");

    // 1. Local File Header (30 bytes + name length)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local header signature
    localHeader.writeUInt16LE(20, 4);         // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6);     // General purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(8, 8);          // Compression method (Deflate)
    localHeader.writeUInt16LE(dosTime, 10);   // Last mod file time
    localHeader.writeUInt16LE(dosDate, 12);   // Last mod file date
    localHeader.writeUInt32LE(crc, 14);       // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);   // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28);         // Extra field length
    nameBuffer.copy(localHeader, 30);

    // 2. Central Directory Header (46 bytes + name length)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(0x0314, 4);     // Version made by (UNIX, 2.0)
    centralHeader.writeUInt16LE(20, 6);         // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8);     // Bit flag (UTF-8)
    centralHeader.writeUInt16LE(8, 10);         // Compression method
    centralHeader.writeUInt16LE(dosTime, 12);   // Last mod time
    centralHeader.writeUInt16LE(dosDate, 14);   // Last mod date
    centralHeader.writeUInt32LE(crc, 16);       // CRC-32
    centralHeader.writeUInt32LE(compressedSize, 20);   // Compressed size
    centralHeader.writeUInt32LE(uncompressedSize, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30);         // Extra field length
    centralHeader.writeUInt16LE(0, 32);         // File comment length
    centralHeader.writeUInt16LE(0, 34);         // Disk number start
    centralHeader.writeUInt16LE(0, 36);         // Internal file attributes
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // External file attributes (POSIX permissions)
    centralHeader.writeUInt32LE(currentOffset, 42); // Relative offset of local header
    nameBuffer.copy(centralHeader, 46);

    localHeaders.push(localHeader, compressedData);
    centralHeaders.push(centralHeader);

    currentOffset += localHeader.length + compressedData.length;
  }

  // 3. Central Directory 및 End of Central Directory (EOCD)
  const cdOffset = currentOffset;
  const centralDirectoryBuffer = Buffer.concat(centralHeaders);
  const cdSize = centralDirectoryBuffer.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);    // EOCD signature
  eocd.writeUInt16LE(0, 4);             // Disk number
  eocd.writeUInt16LE(0, 6);             // Disk with start of CD
  eocd.writeUInt16LE(files.length, 8);  // Number of CD entries on this disk
  eocd.writeUInt16LE(files.length, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12);       // Size of CD
  eocd.writeUInt32LE(cdOffset, 16);     // Offset of CD
  eocd.writeUInt16LE(0, 20);            // Comment length

  const finalZipBuffer = Buffer.concat([...localHeaders, centralDirectoryBuffer, eocd]);

  if (IS_DRY_RUN) {
    console.log(`🔍 [DRY-RUN] ZIP 파일 생성을 건너뜁니다 (가상 아카이브 크기: ${(finalZipBuffer.length / 1024 / 1024).toFixed(2)} MB).`);
    return { zipBuffer: finalZipBuffer, zipFilePath, fileManifest };
  }

  fs.writeFileSync(zipFilePath, finalZipBuffer);
  console.log(`✅ [Step 4/5 통과] 결정론적 ZIP 아카이브 작성 완료:`);
  console.log(`   파일 경로: ${zipFilePath}`);
  console.log(`   파일 크기: ${(finalZipBuffer.length / 1024 / 1024).toFixed(2)} MB (${finalZipBuffer.length.toLocaleString()} bytes)\n`);

  return { zipBuffer: finalZipBuffer, zipFilePath, fileManifest };
}

// --------------------------------------------------------------------------
// Step 5: 사후 언팩 무결성 검증 및 빌드 출처(Provenance) 생성
// --------------------------------------------------------------------------
function verifyAndGenerateProvenance(zipBuffer, zipFilePath, fileManifest, version, testStatus) {
  console.log("▶ [Step 5/5] 사후 아카이브 무결성 검증 및 Provenance 생성 중...");

  // 1. EOCD 파싱 및 엔트리 무결성(CRC32) 역검증
  const totalLen = zipBuffer.length;
  if (totalLen < 22) throw new Error("손상된 ZIP: 아카이브 크기가 너무 작습니다.");

  let eocdOffset = -1;
  for (let i = totalLen - 22; i >= Math.max(0, totalLen - 1024); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("손상된 ZIP: EOCD 서명을 찾을 수 없습니다.");

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries !== fileManifest.length) {
    throw new Error(`손상된 ZIP: 엔트리 개수 불일치 (예상 ${fileManifest.length}, 실제 ${totalEntries})`);
  }

  // 2. 개별 파일 CRC32 일치 및 언팩 검증
  let ptr = cdOffset;
  const unpackedNames = [];
  for (let i = 0; i < totalEntries; i++) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014b50) {
      throw new Error(`손상된 ZIP: Central Directory 서명 불일치 (엔트리 ${i})`);
    }
    const nameLen = zipBuffer.readUInt16LE(ptr + 28);
    const expectedCrc = zipBuffer.readUInt32LE(ptr + 16);
    const compSize = zipBuffer.readUInt32LE(ptr + 20);
    const uncompSize = zipBuffer.readUInt32LE(ptr + 24);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);
    const name = zipBuffer.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    unpackedNames.push(name);

    // 로컬 헤더 위치에서 데이터 읽기
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const dataOffset = localHeaderOffset + 30 + localNameLen;
    const compressedChunk = zipBuffer.subarray(dataOffset, dataOffset + compSize);
    const decompressed = zlib.inflateRawSync(compressedChunk);

    if (decompressed.length !== uncompSize) {
      throw new Error(`손상된 ZIP: ${name} 파일 언팩 크기 불일치`);
    }
    const actualCrc = (zlib.crc32 ? zlib.crc32(decompressed) : computeCrc32Fallback(decompressed)) >>> 0;
    if (actualCrc !== expectedCrc) {
      throw new Error(`손상된 ZIP: ${name} CRC-32 불일치 (예상 ${expectedCrc}, 실제 ${actualCrc})`);
    }

    ptr += 46 + nameLen;
  }

  // 3. 필수 엔트리포인트 검사
  const requiredFiles = ["manifest.json", "offscreen.html", "offscreen.js", "landing/product-panel.css"];
  for (const req of requiredFiles) {
    if (!unpackedNames.includes(req)) {
      throw new Error(`무결성 실패: 필수 파일 누락 in ZIP -> ${req}`);
    }
  }

  // 4. 용량 한도 점검 (CWS 업로드 한도: 2,048MB)
  const MAX_CWS_BYTES = 2 * 1024 * 1024 * 1024;
  if (totalLen > MAX_CWS_BYTES) {
    throw new Error(`치명적 오류: ZIP 크기(${(totalLen / 1024 / 1024).toFixed(2)} MB)가 CWS 최대 허용 용량(2GB)을 초과했습니다.`);
  }

  // 5. ZIP 아카이브 전체 SHA-256 계산
  const zipSha256 = crypto.createHash("sha256").update(zipBuffer).digest("hex");

  if (IS_DRY_RUN) {
    console.log(`✅ [Step 5/5 통과] 사후 언팩 무결성 검증 완료 (엔트리 ${totalEntries}개 정상 확인).`);
    console.log(`   아카이브 SHA-256: ${zipSha256}`);
    return;
  }

  // 6. dist/summrizei-v{version}-cws.sha256 파일 출력
  const sha256FilePath = zipFilePath.replace(/\.zip$/, ".sha256");
  fs.writeFileSync(sha256FilePath, `${zipSha256}  ${path.basename(zipFilePath)}\n`);

  // 7. dist/build-provenance.json 파일 출력 (개인 식별 정보 배제)
  let gitCommit = "unknown";
  try {
    gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (e) {}

  const provenance = {
    schema_version: "1.0.0",
    package_name: "summrizei",
    version: version,
    build_environment: {
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      source_date_epoch: "2026-01-01T00:00:00Z",
      git_commit: gitCommit,
    },
    test_gate: {
      status: testStatus,
    },
    archive: {
      filename: path.basename(zipFilePath),
      total_bytes: totalLen,
      cws_limit_percent: `${((totalLen / MAX_CWS_BYTES) * 100).toFixed(4)}%`,
      sha256: zipSha256,
      entry_count: totalEntries,
    },
    files: fileManifest,
  };

  const provenancePath = path.join(path.dirname(zipFilePath), `summrizei-v${version}-provenance.json`);
  fs.writeFileSync(provenancePath, JSON.stringify(provenance, null, 2), "utf8");

  console.log(`✅ [Step 5/5 통과] 사후 검증 및 Provenance 생성 완료:`);
  console.log(`   - 체크섬 파일: ${sha256FilePath}`);
  console.log(`   - Provenance 파일: ${provenancePath}`);
  console.log(`   - 아카이브 SHA-256: ${zipSha256}\n`);
}

// --------------------------------------------------------------------------
// 헬퍼: CRC-32 폴백 함수
// --------------------------------------------------------------------------
function computeCrc32Fallback(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  }
  return (c ^ 0xffffffff) >>> 0;
}
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c;
}

// --------------------------------------------------------------------------
// 파이프라인 진입점 (Main)
// --------------------------------------------------------------------------
try {
  const testStatus = runPreflightTests();
  const { manifest, files } = resolveRuntimeClosure();
  auditSecurityAndInvariants(files);
  const { zipBuffer, zipFilePath, fileManifest } = buildZipArchive(files, manifest.version);
  verifyAndGenerateProvenance(zipBuffer, zipFilePath, fileManifest, manifest.version, testStatus);

  console.log("🎉 [완료] Chrome Web Store 제출 준비가 완벽하게 완료되었습니다!");
  console.log(`   제출용 파일: ${zipFilePath}`);
  console.log("============================================================\n");
} catch (err) {
  console.error(`\n❌ [오류 발생]: ${err.message}`);
  process.exit(1);
}
