// Probes OpenRouter's public endpoint list for every model pinned in lib/openrouter-client.js.
// provider.only takes per-model endpoint TAGS, not vendor names, and OpenRouter renames them; a pin
// that no longer exists fails the summary request with 400. Run after touching the model list.
// Usage: node tools/openrouter-endpoint-probe.mjs      (no API key, no user data leaves the machine)
import { createRequire } from "node:module";

const NEEDED = ["response_format", "structured_outputs", "reasoning", "max_tokens"];
// Zero Data Retention disables first-party endpoints, and every request we send asks for ZDR.
const FIRST_PARTY = ["anthropic", "openai", "google-ai-studio", "xai"];
const { MODELS } = createRequire(import.meta.url)("../lib/openrouter-client.js");

let failures = 0;
for (const [model, { tags, reasoning, maxTokens }] of Object.entries(MODELS)) {
  const response = await fetch(`https://openrouter.ai/api/v1/models/${model}/endpoints`);
  const endpoints = response.ok ? (await response.json()).data?.endpoints || [] : [];
  console.log(`\n${model}  (핀: ${tags.join(", ")} | reasoning: ${JSON.stringify(reasoning)} | max_tokens: ${maxTokens})`);
  if (!endpoints.length) { console.log(`  ✗ 엔드포인트를 조회하지 못했습니다 (${response.status}). 모델 슬러그를 확인하세요.`); failures++; continue; }
  for (const tag of tags) {
    const endpoint = endpoints.find(e => e.tag === tag);
    if (!endpoint) { console.log(`  ✗ ${tag} — 이 모델에 없는 태그입니다. 사용 가능: ${endpoints.map(e => e.tag).join(", ")}`); failures++; continue; }
    if (FIRST_PARTY.includes(tag.split("/")[0])) { console.log(`  ✗ ${tag} — 1차 공급자 엔드포인트입니다. ZDR을 켜면 비활성화되므로 404만 납니다.`); failures++; continue; }
    const missing = NEEDED.filter(p => !(endpoint.supported_parameters || []).includes(p));
    const capacity = Number(endpoint.max_completion_tokens) || 0;
    const ok = !missing.length && capacity >= maxTokens && endpoint.status === 0;
    if (!ok) failures++;
    const effort = (endpoint.supported_parameters || []).includes("reasoning_effort");
    if (reasoning.effort && !effort) { console.log(`  ! ${tag} — reasoning.effort를 지원하지 않는 엔드포인트입니다.`); failures++; }
    console.log(`  ${ok ? "✓" : "✗"} ${tag} | status=${endpoint.status} | max_out=${capacity} | 미지원 파라미터=${missing.join(",") || "없음"} | reasoning_effort=${effort}`);
  }
}
// ponytail: ZDR eligibility is not in this public payload; provider.zdr:true surfaces as a 404 at request time.
console.log(failures ? `\n${failures}건 문제. provider.only 핀을 고치세요.` : "\n전 모델 정상. (ZDR 적용 여부는 실제 요청에서만 확인됩니다.)");
process.exit(failures ? 1 : 0);
