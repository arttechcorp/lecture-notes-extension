# 대학 강의 요약노트 양식 연구

현재 시각 버전은 **v3 · SUMMRIZEI 브랜드 디자인**이다. 두 교재의 학습 구조를 유지하고 `landing/design.md`의 미색·무채색·단일 주황 강조·1px 연결 그리드로 갱신했다.

- `index.html`: 지면 6종, 내용 블록 18개, SVG 11종, 강의 예시 3종을 확인하는 갤러리.
- `pages.html`: 지면 6종을 연속해서 읽는 화면.
- `page-design-spec.md`: 최신 디자인·지면 선택·Point 식별·넘침·재사용 규격.
- `assets/brand-tokens.json`: 브랜드 토큰.
- `assets/page-templates.html`: P01–P06 지면 템플릿.
- `assets/templates.html`: B01–B18 내용 블록.
- `assets/manifest.json`: 전체 에셋 참조.
- `design-qa-v3.md`: 현재 검증 범위와 외부 검토 처리.
- `claude-code-handoff.md`: 파이프라인 v2에 연결할 때 추가할 계약 8가지, 현재 구현 상태, Claude Code 전달문.

## 기존 분석과 기획

- `source-analysis.md` / `.html`: 첨부한 LIMIT·IMFACT의 구조와 설명 방식 분석.
- `proposal.md` / `.html`: 대학 강의용 내용 구조와 생성 규칙. **색·서체·도형은 v3 규격을 우선한다.**
- `design-qa-v2.md`: 이전 교재형 디자인의 검증 기록.

저장소의 `output/pdf/lecture-note-page-designs.pdf`가 최신 6쪽 인쇄 시안이다. `lecture-note-page-design-kit.zip`에는 이 폴더와 최신 시안, 이전 통합 기획안 PDF, 백엔드 v2 기획의 현재 사본이 함께 들어 있다. Claude 전달문이 참조하는 제품 코드는 실제 저장소에서 읽어야 한다. `lecture-note-format-guide.pdf`는 v1 연구 기록으로 현재 디자인을 표시하지 않는다. ZIP은 저장소와 같은 상대 경로를 유지하므로 `docs/note-format-study-2026-10-02/index.html`에서 시작한다.

## 재사용

내용 블록은 `assets/note.css` 다음 `assets/page-design.css`를 로드하고 `.study-notes` 안에서 사용한다. 완성 지면은 `page-design.css`와 `.textbook.paper-sheet`를 사용한다. page-templates의 이미지 경로는 이 갤러리 루트 기준이다. 다른 위치에 복제하면 이미지 경로도 함께 조정한다.

모델은 검증된 내용 슬롯만 채운다. 가상 예시·수치·주장·근거는 실제 강의의 확인된 내용으로 교체한다. SVG 글자는 편집 가능하며 로컬 글꼴에 따라 모양이 달라질 수 있다. 폰트 파일은 배포하지 않는다. PDF는 글꼴을 포함한다.

이는 디자인과 프롬프트 설계용 자료다. 실제 노트 생성·렌더링·내보내기에 적용하거나, 다양한 실제 강의에서 학습 효과를 검증한 상태는 아니다. 임의 내용의 자동 페이지 분할도 아직 구현하지 않았다.
