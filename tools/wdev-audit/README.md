# w/dev 점검 재현 스크립트

`docs/wdev-issues-for-kiwook.md`의 이슈를 재현하는 프로브다. **`w/dev` 체크아웃의 루트에서** 돌린다. 이 브랜치(`b/visual-suppression`)에는 v2 `lib/`가 없어 여기서는 돌지 않는다.

```sh
# w/dev 체크아웃 루트에서
cp <이 폴더>/*.js .
node probe2.js    # 이슈 1: 수식 화면 대조가 숫자만 비교 (B절)
node probe4.js    # 이슈 2: 반복 텍스트 필터가 점진 노출 슬라이드의 본문을 지움
node probe6.js    # 이슈 4: 재생성이 단계 캐시에서 그대로 나옴
node probe8.js    # 이슈 6: B03 지도 노드·연결에 근거 검사 없음
node probe3c.js   # 이슈 7: 원문 재현 검사가 줄 단위 근거에서 무력
node probe1b.js   # 이슈 10: repairPlan이 제목의 여러 자리 숫자를 지움
```

- 서비스 호출은 없다. `probe-common.js`가 `lib/stages.js`의 refining → validate → assemble → render를 그대로 흉내 낸다.
- `probe6.js`는 `tools/note-fixture/`를 쓴다.
- 텍스트는 모두 합성이다. 실제 강의 내용은 없다.
- 확인 기준: `w/dev` `308d240`(v1.3.6), 2026-10-05.
