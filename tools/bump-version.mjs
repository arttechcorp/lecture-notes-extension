#!/usr/bin/env node
// 확장 버전 올리기: manifest.json 의 version 이 유일한 기준이다(서비스 x-client-version·진단 파일·CWS 묶음 이름이 모두 여기서 온다).
//   node tools/bump-version.mjs build|patch|minor|major|X.Y.Z[.W] [--tag]
// - 버전은 X.Y.Z.W 이고 W 가 0 이면 쓰지 않는다(1.3.9 = 1.3.9.0). 올리면 아래 자리는 0 으로 돌아간다.
// - build(W): 버그 수정·내부 변경, 커밋마다 올리는 기본값 / patch(Z): 눈에 띄는 작은 개선 / minor(Y): 기능 추가·노트 결과가 달라지는 변경 / major(X): 대규모 업데이트, 서버 계약·저장 형식이 깨지는 변경
// - Chrome 규칙: 정수 4개까지, 각 0~65535, 앞자리 0 금지.
// - CHANGELOG.md 맨 위에 새 버전 머리를 단다(내용은 사람이 채운다).
// - --tag: main 브랜치에서만, 작업 트리가 깨끗할 때 manifest·CHANGELOG 를 커밋하고 vX.Y.Z 태그를 단다.
// CWS 는 올릴 때마다 더 큰 버전을 요구한다 — 낮추거나 같은 버전은 거절한다.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEG = "(0|[1-9]\\d{0,4})";
const VERSION = new RegExp(`^${SEG}\\.${SEG}\\.${SEG}(?:\\.${SEG})?$`);
const parts = v => { const m = VERSION.exec(v); return m && m.slice(1).map(n => Number(n ?? 0)); };

export function nextVersion(current, how) {
  const cur = parts(current);
  if (!cur) throw new Error(`manifest version 이 X.Y.Z[.W] 가 아니다: ${current}`);
  const [maj, min, pat, bld] = cur;
  const levels = { major: [maj + 1, 0, 0, 0], minor: [maj, min + 1, 0, 0], patch: [maj, min, pat + 1, 0], build: [maj, min, pat, bld + 1] };
  const to = Object.hasOwn(levels, how) ? levels[how] : parts(how);
  if (!to || to.some(n => n > 65535)) throw new Error(`버전 지정이 올바르지 않다: ${how}`);
  const next = (to[3] ? to : to.slice(0, 3)).join(".");
  if (to.reduce((c, n, i) => c || n - cur[i], 0) <= 0) throw new Error(`새 버전 ${next} 이 지금 ${current} 보다 커야 한다(CWS 규칙)`);
  return next;
}

export function addChangelogHead(text, version, date) {
  if (text.includes(`## ${version} `) || text.includes(`## ${version}\n`)) return text;
  const head = `## ${version} — ${date}\n\n- \n\n`;
  const title = "# Changelog\n\n";
  return text.startsWith(title) ? title + head + text.slice(title.length) : title + head + text;
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const how = argv.find(a => !a.startsWith("--")), tag = argv.includes("--tag");
  if (!how) throw new Error("사용법: node tools/bump-version.mjs build|patch|minor|major|X.Y.Z[.W] [--tag]");
  const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  if (tag) {
    if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") throw new Error("--tag 는 main 에서만 단다");
    if (git("status", "--porcelain", "--", "manifest.json", "CHANGELOG.md")) throw new Error("manifest.json·CHANGELOG.md 에 커밋 안 된 변경이 있다");
  }
  const mPath = path.join(root, "manifest.json"), cPath = path.join(root, "CHANGELOG.md");
  const raw = fs.readFileSync(mPath, "utf8"), manifest = JSON.parse(raw);
  const version = nextVersion(manifest.version, how);
  // 다른 줄의 서식은 건드리지 않는다 — version 한 줄만 바꾼다.
  fs.writeFileSync(mPath, raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`));
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(cPath, addChangelogHead(fs.existsSync(cPath) ? fs.readFileSync(cPath, "utf8") : "", version, date));
  if (tag) {
    git("add", "manifest.json", "CHANGELOG.md");
    git("commit", "-m", `chore(release): v${version}`);
    git("tag", "-a", `v${version}`, "-m", `v${version}`);
  }
  console.log(`${manifest.version} → ${version}${tag ? ` (tag v${version})` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}
