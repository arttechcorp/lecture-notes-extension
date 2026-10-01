// 운영자 전용 오프라인 도구: 사용자가 보낸 진단 파일을 복호화하거나 새 운영자 키 쌍을 만든다.
// 개인키는 이 도구가 돌아간 머신을 벗어나지 않는다 — stdout·로그 어디에도 출력하지 않는다.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const { decryptBundle } = createRequire(import.meta.url)("../lib/diagnostics.js");

const USAGE = `사용법:
  node tools/decrypt-diagnostic.mjs <bundle.json> <private.jwk.json>   진단 파일을 복호화해 이벤트를 JSON으로 출력합니다
  node tools/decrypt-diagnostic.mjs --generate-keypair <dir>           새 운영자 키 쌍을 만듭니다`;

const READ_FAIL = Symbol("read-fail");
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch {
    process.stderr.write("파일을 읽을 수 없습니다: " + file + "\n");
    process.exitCode = 1;
    return READ_FAIL;
  }
}

async function generateKeypair(dir) {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicJwk = { kty, crv, x, y };
  // kid에 RFC 7638 thumbprint 입력(멤버 순서 고정)의 해시 앞 8자리를 넣어 키와 식별자를 묶는다.
  const kid = "op-" + new Date().toISOString().slice(0, 7).replace("-", "") + "-" +
    crypto.createHash("sha256").update(JSON.stringify({ crv, kty, x, y })).digest("hex").slice(0, 8);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "private.jwk.json");
  try {
    // wx: 기존 개인키를 절대 덮어쓰지 않는다.
    fs.writeFileSync(file, JSON.stringify({ kty, crv, x, y, d, kid }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  } catch (e) {
    if (e && e.code === "EEXIST") {
      process.stderr.write("개인키 파일이 이미 존재합니다: " + file + " — 기존 키를 보호하기 위해 덮어쓰지 않았습니다.\n");
      process.exitCode = 1;
      return;
    }
    throw e;
  }
  fs.chmodSync(file, 0o600);
  process.stdout.write(JSON.stringify({ kid, publicJwk }, null, 2) + "\n");
  process.stderr.write("개인키를 저장했습니다 (0600): " + file + "\n");
  process.stderr.write("이 파일은 오프라인에 보관하고 절대 커밋하지 마세요.\n");
  process.stderr.write("stdout의 kid와 publicJwk를 lib/diagnostics.js의 OPERATOR_KEYS에 추가하세요.\n");
}

async function main(argv) {
  if (argv[0] === "--generate-keypair") {
    if (argv.length === 2) return generateKeypair(argv[1]);
    process.stderr.write(USAGE + "\n");
    process.exitCode = 2;
    return;
  }
  if (argv.length !== 2) {
    process.stderr.write(USAGE + "\n");
    process.exitCode = 2;
    return;
  }
  const bundle = readJson(argv[0]);
  if (bundle === READ_FAIL) return;
  const privateJwk = readJson(argv[1]);
  if (privateJwk === READ_FAIL) return;
  try {
    process.stdout.write(JSON.stringify(await decryptBundle(bundle, privateJwk), null, 2) + "\n");
  } catch (e) {
    process.stderr.write("오류: " + ((e && e.message) || String(e)) + "\n");
    process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch(e => {
  process.stderr.write("오류: " + ((e && e.message) || String(e)) + "\n");
  process.exitCode = 1;
});
