// server/index.js(CommonJS, Node)를 Supabase Edge Function(Deno, ESM)이 불러올 수 있는 한 파일로 묶는다.
// 의존성 없이 require("...")·need("이름", "...")의 문자열 경로만 따라가 모듈 함수 표를 만든다. node: 내장 모듈은 ESM 기본 가져오기로 넘긴다.
//   node tools/build-edge.mjs          → supabase/functions/api/server.bundle.js 갱신
//   node tools/build-edge.mjs --check  → 커밋된 묶음이 소스와 같은지만 본다(tools/build-edge.test.mjs가 부른다)
// ponytail: 문자열 리터럴 require만 따라간다. 변수 경로는 need()의 두 번째 인자처럼 리터럴로 적혀 있어야 묶음에 들어간다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(repo, "supabase/functions/api/server.bundle.js");
const ENTRY = "server/index.js";
const SPEC = /\brequire\(\s*"([^"]+)"\s*\)|\bneed\(\s*"[^"]+"\s*,\s*"([^"]+)"\s*\)/g;

const resolve = (from, spec) => {
  const p = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return p.endsWith(".js") ? p : p + ".js";
};

export function build() {
  const mods = new Map(), builtins = new Set(), queue = [ENTRY];
  while (queue.length) {
    const id = queue.shift();
    if (mods.has(id)) continue;
    const src = fs.readFileSync(path.join(repo, id), "utf8");
    mods.set(id, src);
    for (const m of src.matchAll(SPEC)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith("node:")) builtins.add(spec);
      else if (spec.startsWith(".")) queue.push(resolve(id, spec));
      else throw new Error(`${id}: 묶을 수 없는 의존성 ${spec}`);
    }
  }
  builtins.add("node:buffer").add("node:process");
  const names = [...builtins].sort();
  const lines = [
    "// 자동 생성 파일 — 고치지 말 것. 원본은 server/·lib/이고 `node tools/build-edge.mjs`로 다시 만든다.",
    ...names.map((b, i) => `import __b${i} from ${JSON.stringify(b)};`),
    `const __builtins = {${names.map((b, i) => `${JSON.stringify(b)}: __b${i}`).join(", ")}};`,
    'const Buffer = __builtins["node:buffer"].Buffer, process = __builtins["node:process"];',
    "const __defs = {",
    ...[...mods].sort(([a], [b]) => a.localeCompare(b)).map(([id, src]) =>
      `${JSON.stringify(id)}: function (module, exports, require, __filename, __dirname) {\n${src}\n},`),
    "};",
    "const __cache = {};",
    "function __load(id) {",
    "  if (__cache[id]) return __cache[id].exports;",
    "  if (!__defs[id]) throw new Error(\"bundle_missing:\" + id);",
    "  const module = { exports: {} };",
    "  __cache[id] = module;",
    "  const dir = id.includes(\"/\") ? id.slice(0, id.lastIndexOf(\"/\")) : \".\";",
    "  const require = (spec) => {",
    "    if (spec.startsWith(\"node:\")) { if (spec in __builtins) return __builtins[spec]; throw new Error(\"bundle_missing:\" + spec); }",
    "    const parts = [];",
    "    for (const s of (dir + \"/\" + spec).split(\"/\")) { if (s === \"..\") parts.pop(); else if (s && s !== \".\") parts.push(s); }",
    "    const p = parts.join(\"/\");",
    "    return __load(p.endsWith(\".js\") ? p : p + \".js\");",
    "  };",
    "  __defs[id].call(module.exports, module, module.exports, require, id, dir);",
    "  return module.exports;",
    "}",
    `export default __load(${JSON.stringify(ENTRY)});`,
    "",
  ];
  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = build();
  if (process.argv.includes("--check")) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === out;
    console.log(same ? "edge bundle up to date" : "edge bundle is stale: run node tools/build-edge.mjs");
    process.exit(same ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);
  console.log(`wrote ${path.relative(repo, OUT)} (${out.length} bytes)`);
}
