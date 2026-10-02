# 대학 강의 노트 양식 연구 · 2026-10-02

1. `index.html`: 18개 에셋, 좁은 화면, 해설 펼침, 강의 예시 3종.
2. `proposal.md` / `proposal.html`: 상세 기획안. 블록 선택, 내용 규칙, 상황 대응, 프롬프트 계약, 평가 기준.
3. `source-analysis.md` / `source-analysis.html`: IMFACT 28쪽과 LIMIT 10쪽의 페이지 구조·설명 논리 분석.
4. `assets/`: CSS, HTML template 18개, manifest, 편집 가능한 SVG 3개.
5. `examples.json`: 예시 구성 및 경영 계산값.
6. `qa-report.md`: 이번 산출물의 확인 범위와 한계.

PDF 통합본: 저장소 `output/pdf/lecture-note-format-guide.pdf`. 배포 ZIP에서는 최상위의 `lecture-note-format-guide.pdf`.

## 재사용

`assets/note.css`를 읽고 `assets/templates.html`의 필요한 template을 복제한다. 텍스트와 근거를 교체한다. 모든 블록은 `.study-notes` 영역 안에서 사용한다. 화면 제목·배경에 쓰는 글로벌 CSS는 갤러리용이므로 제품에 통합할 때 `.study-notes`와 토큰·인쇄 규칙만 검토하여 옮긴다. 비교표의 `data-label`도 열 제목과 함께 수정한다.

예시 문구·숫자·근거 표시를 실제 강의의 기본값으로 사용하지 않는다. 사용자 콘텐츠는 허용된 슬롯에 안전하게 텍스트로 넣고, 모델이 작성한 임의 HTML을 실행하지 않는다. SVG 글자는 편집 가능한 텍스트다. 다른 컴퓨터에서는 사용 가능한 한국어 글꼴에 따라 모양이 바뀔 수 있다.

원본 PDF·기존 초안·제품 소스·지침 파일은 변경하지 않았다. 최종 생성 프롬프트나 제품 기능을 구현한 결과가 아니다.
