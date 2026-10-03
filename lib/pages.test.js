// library-page.js·note-page.js·note.html 은 브라우저 전용이다 — 도우미 함수는 eval 로 뽑아 돌리고,
// 다시 만들기 UI 계약(게이트·메시지 모양·동의 링크)은 소스로 막는다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const libJs = fs.readFileSync('library-page.js', 'utf8');
const noteJs = fs.readFileSync('note-page.js', 'utf8');
const noteHtml = fs.readFileSync('note.html', 'utf8');

// fmtDate: Date 객체는 NaN 검사가 안 통하니 getTime() 으로 판정한다 — 잘못된 값은 빈 문자열.
eval(libJs.slice(libJs.indexOf('const fmtDate'), libJs.indexOf('const el =')) + 'globalThis.fmtDate=fmtDate;');
assert.equal(fmtDate('not-a-date'), '', '깨진 createdAt 은 빈 문자열');
assert.equal(fmtDate(''), '');
assert.equal(fmtDate(undefined), '');
assert.ok(fmtDate('2025-01-02T03:04:00Z').length > 0, '정상 ISO 는 지역 시각 문자열');

// safeName: 제목이 없거나 다 지워지면 "note" 가 아니라 패키지 id로 파일명을 짓는다.
const packageId = 'Lx-1';
eval(noteJs.slice(noteJs.indexOf('const safeName'), noteJs.indexOf('function bindToolbar')) + 'globalThis.safeName=safeName;');
assert.equal(safeName(''), 'Lx-1');
assert.equal(safeName(null), 'Lx-1');
assert.equal(safeName('<>:'), 'Lx-1', '제목이 통째로 지워져도 패키지 id');
assert.equal(safeName('미분 강의 3'), '미분 강의 3');

// 다시 만들기 상자: 기본 hidden, 확장 런타임(chrome.runtime.id)이 있을 때만 연다 — localhost 미리보기에서 숨는다.
assert.match(noteHtml, /<section class="regen" id="regenBox" hidden>/);
assert.ok(noteJs.includes('!runtime?.id || !runtime.sendMessage'), 'runtime 없으면 상자를 숨긴다');
// 유료 노트는 옵션 두 개와 "이 옵션으로 다시 만들기", 인식만 끝난 건 옵션 없이 "노트 만들기".
assert.ok(noteJs.includes('data.meta.tier !== "paid"'), '무료 노트는 옵션을 보여주지 않는다');
assert.ok(noteJs.includes('synCb.checked = data.meta.options?.syntheticExamples === true'), '체크 초기값은 저장 메타');
assert.ok(noteHtml.includes('가상 사례 포함') && noteHtml.includes('강의 밖 보강 포함'));
assert.ok(noteHtml.includes('켜면 해당 내용에 라벨이 붙습니다. 강의 밖 보강은 확인이 필요한 내용입니다.'));
assert.ok(noteHtml.includes('외부 요약 처리에 동의해야 합니다(<a href="options.html">설정</a>)'), '동의 안내는 설정으로 간다');
assert.ok(noteJs.includes('"노트 만들기"') && noteJs.includes('"이 옵션으로 다시 만들기"'));
// 보내는 메시지는 background→offscreen 계약 그대로, 내용은 페이지를 지나지 않는다.
assert.ok(noteJs.includes('type: "LIB_REGENERATE"') && noteJs.includes('packageId, options'));
assert.ok(noteJs.includes('recogOnly ? { syntheticExamples: false, externalAugmentation: false }'), '인식만→노트는 옵션을 끄고 보낸다');
assert.ok(noteJs.includes('다시 만드는 중… 몇 분 걸릴 수 있습니다.'));

console.log('pages: fmtDate/safeName helpers and regen contract present');
