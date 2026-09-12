// Chrome Web Store 배포용 클린 ZIP 패키징 도구
// 개발용 apikey.env.local, 테스트 파일, 작업 트리 및 git 메타데이터를 원천 배제합니다.

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
const version = manifest.version;
const distDir = path.join(ROOT, "dist");
const stageDir = path.join(distDir, `summrizei-v${version}`);
const zipFile = path.join(distDir, `summrizei-v${version}-cws.zip`);

console.log(`[CWS Packaging] Summrizei v${version} 패키징 준비 시작...`);

// 1. 배포 빌드 폴더 준비
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(stageDir, { recursive: true });

// 2. 포함할 필수 파일 및 폴더 목록
const INCLUDED_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
  "sandbox.html",
];

const INCLUDED_DIRS = [
  "icons",
  "lib",
  "landing",
];

// 복사 함수 (재귀)
function copyDirFiltered(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    // 제외 규칙
    if (
      entry.name.endsWith(".test.js") ||
      entry.name === "apikey.env.local" ||
      entry.name.startsWith(".env") ||
      entry.name === ".DS_Store" ||
      entry.name === "Thumbs.db"
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirFiltered(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 파일 복사
for (const file of INCLUDED_FILES) {
  const src = path.join(ROOT, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(stageDir, file));
  } else {
    console.warn(`[주의] 필수 파일 누락: ${file}`);
  }
}

// 디렉터리 복사
for (const dir of INCLUDED_DIRS) {
  const src = path.join(ROOT, dir);
  if (fs.existsSync(src)) {
    copyDirFiltered(src, path.join(stageDir, dir));
  }
}

// 3. apikey.env.local 절대 미포함 2차 안전 검증
const leakedKey = path.join(stageDir, "apikey.env.local");
if (fs.existsSync(leakedKey)) {
  fs.rmSync(leakedKey, { force: true });
  throw new Error("치명적 오류: apikey.env.local 파일이 패키지에 포함되어 즉시 중단했습니다.");
}

// 4. ZIP 압축 실행 (Windows PowerShell Compress-Archive 활용)
console.log(`[CWS Packaging] 압축 파일 생성 중: ${zipFile}`);
const psCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipFile}' -Force"`;
execSync(psCmd, { stdio: "inherit" });

const stats = fs.statSync(zipFile);
console.log(`✅ [완료] Chrome Web Store 제출용 ZIP 파일이 생성되었습니다:`);
console.log(`   파일 경로: ${zipFile}`);
console.log(`   파일 크기: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
