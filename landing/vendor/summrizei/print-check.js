// lib/print-check.js
// 파이프라인 v2 조판 검수 및 재조판 엔진 (docs/architecture-v2.md §6.3, docs/note-contract.md §15, 제안서 §6)
// 브라우저 메모리에서 DOM 기하를 검사하고, 최대 2회 순차 교정을 수행한다.
// 원칙:
// 1. 순수 함수 + DOM 어댑터 분리로 Node/브라우저 양쪽 동작.
// 2. 결과는 콘텐츠 없는 코드·수치 목록(텍스트 누출 금지).
// 3. 재조판 시 내용(문장)은 절대 줄이지 않고, 본문 최소 글자 크기(12px)를 지킨다.
// 4. 실패 시 명시적 인쇄 경고와 안전한 기본 배치를 적용한다.

(() => {
  // A4 기준 치수 (96 DPI 환산, margin: 14.3mm)
  // 1mm = 96 / 25.4 ≈ 3.7795px
  // A4: 210mm × 297mm, margin: 14.3mm
  // 본문 가용 폭 = (210 - 2 * 14.3) * 3.7795 ≈ 685.6px (~686px)
  // 본문 가용 높이 = (297 - 2 * 14.3) * 3.7795 ≈ 1014.4px (~1014px)
  const A4 = Object.freeze({
    WIDTH_MM: 210,
    HEIGHT_MM: 297,
    MARGIN_MM: 14.3,
    CONTENT_WIDTH_PX: 686,
    CONTENT_HEIGHT_PX: 1014,
  });

  const MAX_RELAYOUT_ATTEMPTS = 2;
  const MIN_BODY_FONT_SIZE_PX = 12; // 본문 최소 글자 크기(약 9pt)
  const MIN_OCCUPANCY_RATIO = 0.12; // 최소 점유율 임계값 (글자+도형)

  // 검수 코드 정의 (콘텐츠 없는 코드)
  const CODES = Object.freeze({
    OVERFLOW_X: "OVERFLOW_X",
    OVERFLOW_Y: "OVERFLOW_Y",
    KATEX_ERROR: "KATEX_ERROR",
    IMAGE_FAILED: "IMAGE_FAILED",
    IMAGE_INCOMPLETE: "IMAGE_INCOMPLETE",
    HEADING_ORPHAN: "HEADING_ORPHAN",
    ANSWER_SPLIT: "ANSWER_SPLIT",
    TABLE_ROW_CLIPPED: "TABLE_ROW_CLIPPED",
    FONT_SIZE_VIOLATION: "FONT_SIZE_VIOLATION",
    OCCUPANCY_LOW: "OCCUPANCY_LOW",
  });

  /**
   * 브라우저 DOM 컨테이너로부터 검수용 어댑터 모델을 생성한다.
   */
  function createBrowserDomAdapter(container, options = {}) {
    const pageHeight = Number(options.pageHeight) || A4.CONTENT_HEIGHT_PX;
    const pageWidth = Number(options.pageWidth) || A4.CONTENT_WIDTH_PX;
    const win = options.window || (typeof window !== "undefined" ? window : null);
    const doc = options.document || (typeof document !== "undefined" ? document : null);

    if (!container || typeof container.getBoundingClientRect !== "function") {
      throw new Error("유효한 DOM 컨테이너가 필요합니다.");
    }

    const cRect = container.getBoundingClientRect();
    const cTop = cRect.top;
    const cLeft = cRect.left;

    return {
      pageHeight,
      pageWidth,
      getContainerRect: () => ({
        width: container.clientWidth || cRect.width || pageWidth,
        height: container.scrollHeight || cRect.height,
        scrollWidth: container.scrollWidth || pageWidth,
        scrollHeight: container.scrollHeight || pageHeight,
      }),

      // 가로/세로 넘침 검사용 요소 수집
      getOverflowCandidates: () => {
        const sel = ".note-block, .note-table, .equation, .note-fig, .note-chart, pre, img, svg";
        const nodes = Array.from(container.querySelectorAll(sel));
        return nodes.map((el, index) => {
          const r = el.getBoundingClientRect();
          return {
            index,
            tag: el.tagName.toLowerCase(),
            blockId: el.getAttribute("id") || el.closest(".note-block")?.getAttribute("id") || null,
            width: r.width,
            height: r.height,
            scrollWidth: el.scrollWidth || r.width,
            clientWidth: el.clientWidth || r.width,
            right: r.right - cLeft,
          };
        });
      },

      // KaTeX 오류 요소 수집
      getKatexErrors: () => {
        const nodes = Array.from(container.querySelectorAll(".katex-error"));
        return nodes.map((el, index) => ({
          index,
          blockId: el.closest(".note-block")?.getAttribute("id") || null,
        }));
      },

      // 이미지 상태 수집
      getImages: () => {
        const nodes = Array.from(container.querySelectorAll("img"));
        return nodes.map((img, index) => ({
          index,
          blockId: img.closest(".note-block")?.getAttribute("id") || null,
          complete: !!img.complete,
          naturalWidth: Number(img.naturalWidth) || 0,
          naturalHeight: Number(img.naturalHeight) || 0,
          decodeFailed: img.dataset?.decodeFailed === "true",
        }));
      },

      // 제목 고아 검사용 요소 수집
      getHeadings: () => {
        const sel = "h1, h2, h3, h4, .unit-head, .part-title";
        const nodes = Array.from(container.querySelectorAll(sel));
        return nodes.map((el, index) => {
          const r = el.getBoundingClientRect();
          const top = r.top - cTop;
          const bottom = r.bottom - cTop;
          // 다음 유의미한 형제/본문 요소의 top 위치
          let nextContentTop = null;
          let sibling = el.nextElementSibling;
          while (sibling) {
            if (sibling.offsetParent !== null || sibling.getBoundingClientRect().height > 0) {
              nextContentTop = sibling.getBoundingClientRect().top - cTop;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          if (nextContentTop === null && el.parentElement) {
            let parentSib = el.parentElement.nextElementSibling;
            if (parentSib) nextContentTop = parentSib.getBoundingClientRect().top - cTop;
          }
          return {
            index,
            tag: el.tagName.toLowerCase(),
            blockId: el.closest(".note-block")?.getAttribute("id") || null,
            top,
            bottom,
            height: r.height,
            nextContentTop,
          };
        });
      },

      // 답안 분리 검사용 요소 수집
      getAnswerUnits: () => {
        const sel = ".answer, .answer-compact";
        const nodes = Array.from(container.querySelectorAll(sel));
        return nodes.map((el, index) => {
          const r = el.getBoundingClientRect();
          const headEl = el.querySelector(".answer-head, summary, .verdict");
          const firstLineEl = el.querySelector(".answer-body > p:first-child, .answer-rubric, .explanation, p:first-of-type");
          const headRect = headEl ? headEl.getBoundingClientRect() : null;
          const firstRect = firstLineEl ? firstLineEl.getBoundingClientRect() : null;

          return {
            index,
            blockId: el.closest(".note-block")?.getAttribute("id") || el.getAttribute("id") || null,
            top: r.top - cTop,
            bottom: r.bottom - cTop,
            headBottom: headRect ? headRect.bottom - cTop : null,
            firstLineTop: firstRect ? firstRect.top - cTop : null,
          };
        });
      },

      // 표 행 잘림 검사용 요소 수집
      getTableRows: () => {
        const nodes = Array.from(container.querySelectorAll(".note-table tbody tr"));
        return nodes.map((tr, index) => {
          const r = tr.getBoundingClientRect();
          return {
            index,
            blockId: tr.closest(".note-block")?.getAttribute("id") || null,
            top: r.top - cTop,
            bottom: r.bottom - cTop,
            height: r.height,
          };
        });
      },

      // 본문 글자 크기 검사 대상 수집
      getBodyTextNodes: () => {
        const sel = "p, li, td, .note-claim";
        const nodes = Array.from(container.querySelectorAll(sel));
        return nodes.map((el, index) => {
          let fontSize = 14;
          if (win && typeof win.getComputedStyle === "function") {
            const fsStr = win.getComputedStyle(el).fontSize;
            const parsed = parseFloat(fsStr);
            if (!isNaN(parsed)) fontSize = parsed;
          }
          return {
            index,
            tag: el.tagName.toLowerCase(),
            blockId: el.closest(".note-block")?.getAttribute("id") || null,
            fontSize,
          };
        });
      },

      // 페이지별 텍스트 및 시각 영역 점유율 계산용 데이터 수집
      getPageVisuals: (pageCount) => {
        const pages = [];
        const textNodes = Array.from(container.querySelectorAll("p, li, td, .note-claim, h1, h2, h3, h4, span"));
        const shapeNodes = Array.from(container.querySelectorAll("img, svg, canvas, .note-chart, .note-crop"));

        for (let p = 0; p < pageCount; p++) {
          const pTop = p * pageHeight;
          const pBottom = (p + 1) * pageHeight;

          let charCount = 0;
          for (const el of textNodes) {
            const r = el.getBoundingClientRect();
            const top = r.top - cTop;
            if (top >= pTop && top < pBottom) {
              charCount += (el.textContent || "").trim().length;
            }
          }

          let visualAreaPx = 0;
          for (const s of shapeNodes) {
            const r = s.getBoundingClientRect();
            const top = r.top - cTop;
            if (top < pBottom && (r.bottom - cTop) > pTop) {
              const h = Math.min(r.bottom - cTop, pBottom) - Math.max(top, pTop);
              visualAreaPx += (r.width * Math.max(0, h));
            }
          }

          pages.push({ pageIndex: p, charCount, visualAreaPx });
        }
        return pages;
      },
    };
  }

  /**
   * DOM 어댑터 데이터를 바탕으로 기하 및 정적 규칙을 검사하는 순수 함수.
   * Node 테스트 및 브라우저 환경에서 동일하게 실행된다.
   */
  function checkPrintLayout(adapter, options = {}) {
    if (!adapter) throw new Error("DOM 어댑터가 필요합니다.");

    const pageHeight = Number(adapter.pageHeight) || A4.CONTENT_HEIGHT_PX;
    const pageWidth = Number(adapter.pageWidth) || A4.CONTENT_WIDTH_PX;
    const minFontSize = Number(options.minFontSizePx) || MIN_BODY_FONT_SIZE_PX;
    const minOccupancy = Number(options.minOccupancyRatio) || MIN_OCCUPANCY_RATIO;

    const issues = [];
    const containerRect = adapter.getContainerRect();
    const totalHeight = containerRect.height || pageHeight;
    const pageCount = Math.max(1, Math.ceil(totalHeight / pageHeight));

    // 1. 가로 / 세로 Overflow 검사
    const candidates = adapter.getOverflowCandidates ? adapter.getOverflowCandidates() : [];
    let overflowXCount = 0;
    let overflowYCount = 0;

    for (const item of candidates) {
      const isXOverflow = (item.scrollWidth > item.clientWidth + 2) ||
                          (item.right > pageWidth + 4) ||
                          (item.width > pageWidth + 4);
      if (isXOverflow) {
        overflowXCount++;
        issues.push({
          code: CODES.OVERFLOW_X,
          targetTag: item.tag,
          blockId: item.blockId,
          excessPx: Math.round(Math.max(item.scrollWidth - item.clientWidth, item.width - pageWidth)),
        });
      }
    }

    // 2. KaTeX 렌더 오류 (.katex-error)
    const katexErrors = adapter.getKatexErrors ? adapter.getKatexErrors() : [];
    for (const k of katexErrors) {
      issues.push({
        code: CODES.KATEX_ERROR,
        blockId: k.blockId,
      });
    }

    // 3. 미완료 / 실패 이미지
    const images = adapter.getImages ? adapter.getImages() : [];
    let imageFailedCount = 0;
    let imageIncompleteCount = 0;

    for (const img of images) {
      if (img.decodeFailed || (img.complete && img.naturalWidth === 0)) {
        imageFailedCount++;
        issues.push({
          code: CODES.IMAGE_FAILED,
          blockId: img.blockId,
        });
      } else if (!img.complete) {
        imageIncompleteCount++;
        issues.push({
          code: CODES.IMAGE_INCOMPLETE,
          blockId: img.blockId,
        });
      }
    }

    // 4. 제목만 남은 페이지 (heading orphan)
    const headings = adapter.getHeadings ? adapter.getHeadings() : [];
    let headingOrphanCount = 0;

    for (const h of headings) {
      const hPage = Math.floor(h.bottom / pageHeight);
      const pageBottom = (hPage + 1) * pageHeight;
      // 제목의 바닥이 페이지 끝 48px 이내에 위치하거나, 다음 본문이 다음 페이지로 넘어갔는지 검사
      const isNearBottom = (pageBottom - h.bottom) < 48;
      const nextOnNextPage = h.nextContentTop != null && h.nextContentTop >= pageBottom;

      if (isNearBottom || nextOnNextPage) {
        headingOrphanCount++;
        issues.push({
          code: CODES.HEADING_ORPHAN,
          blockId: h.blockId,
          pageIndex: hPage,
        });
      }
    }

    // 5. 정답 첫 줄 분리 (answer first line split)
    const answerUnits = adapter.getAnswerUnits ? adapter.getAnswerUnits() : [];
    let answerSplitCount = 0;

    for (const a of answerUnits) {
      if (a.headBottom != null && a.firstLineTop != null) {
        const headPage = Math.floor(a.headBottom / pageHeight);
        const firstLinePage = Math.floor(a.firstLineTop / pageHeight);
        if (headPage !== firstLinePage) {
          answerSplitCount++;
          issues.push({
            code: CODES.ANSWER_SPLIT,
            blockId: a.blockId,
            headPage,
            firstLinePage,
          });
        }
      }
    }

    // 6. 표 행 잘림 (table row clipped)
    const tableRows = adapter.getTableRows ? adapter.getTableRows() : [];
    let tableRowClippedCount = 0;

    for (const row of tableRows) {
      const topPage = Math.floor(row.top / pageHeight);
      const bottomPage = Math.floor((row.bottom - 1) / pageHeight);
      if (topPage !== bottomPage) {
        tableRowClippedCount++;
        issues.push({
          code: CODES.TABLE_ROW_CLIPPED,
          blockId: row.blockId,
          crossingPage: topPage,
        });
      }
    }

    // 7. 본문 최소 글자 크기 위반
    const textNodes = adapter.getBodyTextNodes ? adapter.getBodyTextNodes() : [];
    let minFontSizeViolationCount = 0;

    for (const tn of textNodes) {
      if (tn.fontSize < minFontSize) {
        minFontSizeViolationCount++;
        issues.push({
          code: CODES.FONT_SIZE_VIOLATION,
          blockId: tn.blockId,
          targetTag: tn.tag,
          fontSizePx: tn.fontSize,
        });
      }
    }

    // 8. 글자 + 도형 점유율 (시각 영역 포함하여 차트 페이지 오판 방지)
    const pageVisuals = adapter.getPageVisuals ? adapter.getPageVisuals(pageCount) : [];
    const pageMetrics = [];
    const pageArea = pageWidth * pageHeight;

    for (const pv of pageVisuals) {
      // 1글자당 추정 지면 면적 (14px 폰트 x 1.7 행간 x 약 10px 폭 ≈ 238px²)
      const estTextArea = pv.charCount * 220;
      const totalVisualArea = estTextArea + pv.visualAreaPx;
      const occupancyRatio = Math.min(1.0, Number((totalVisualArea / pageArea).toFixed(3)));

      pageMetrics.push({
        pageIndex: pv.pageIndex,
        charCount: pv.charCount,
        visualAreaPx: Math.round(pv.visualAreaPx),
        occupancyRatio,
      });

      // 마지막 페이지가 아닌데 점유율이 지나치게 낮고 시각 요소도 거의 없으면 경고
      if (pv.pageIndex < pageCount - 1 && occupancyRatio < minOccupancy) {
        issues.push({
          code: CODES.OCCUPANCY_LOW,
          pageIndex: pv.pageIndex,
          occupancyRatio,
        });
      }
    }

    const ok = issues.length === 0;

    return {
      ok,
      issues,
      metrics: {
        pageCount,
        overflowXCount,
        overflowYCount,
        katexErrorCount: katexErrors.length,
        imageFailedCount,
        imageIncompleteCount,
        headingOrphanCount,
        answerSplitCount,
        tableRowClippedCount,
        minFontSizeViolationCount,
        pages: pageMetrics,
      },
    };
  }

  /**
   * 재조판 단계별 교정 클래스/스타일 적용 순서 (제안서 §6):
   * 1. 불필요한 빈칸 제거 (print-trim-whitespace)
   * 2. 의미 단위 재배치 (print-rearrange-units)
   * 3. 표/긴 설명 허용 지점 분할 (print-allow-splits)
   * 4. 패딩·행간을 디자인 허용 범위 내 조정 (print-tighten-leading)
   * 5. 페이지 추가 (명시적 쪽 넘김 삽입)
   */
  function applyRelayoutStage(container, stageIndex, checkResult) {
    if (!container || !container.classList) return [];
    const applied = [];

    if (stageIndex === 1) {
      // 1단계: 불필요한 빈칸 제거 + 2단계 의미 단위 재배치
      container.classList.add("print-trim-whitespace");
      applied.push("TRIM_WHITESPACE");

      // 가로 overflow 발생 시 사이드 단을 블록으로 내려 가로 압박 완화
      if (checkResult?.metrics?.overflowXCount > 0) {
        container.classList.add("print-rearrange-units");
        applied.push("REARRANGE_UNITS");
      }
    } else if (stageIndex === 2) {
      // 3단계: 표 분할 허용 및 긴 수식 래핑
      container.classList.add("print-allow-splits");
      applied.push("ALLOW_SPLITS");

      // 4단계: 패딩 및 행간 조정 (폰트 크기는 그대로 유지)
      container.classList.add("print-tighten-leading");
      applied.push("TIGHTEN_LEADING");

      // 5단계: 고아 제목이나 잘린 표 행 앞에 명시적 페이지 추가
      if (checkResult?.issues) {
        for (const issue of checkResult.issues) {
          if ((issue.code === CODES.HEADING_ORPHAN || issue.code === CODES.TABLE_ROW_CLIPPED) && issue.blockId) {
            const targetEl = container.querySelector(`#${CSS.escape(issue.blockId)}`);
            if (targetEl && !targetEl.classList.contains("page-break")) {
              targetEl.classList.add("page-break");
              applied.push(`PAGE_BREAK_${issue.blockId}`);
            }
          }
        }
      }
    }

    return applied;
  }

  /**
   * 조판 검수 및 재조판 루프 (최대 MAX_RELAYOUT_ATTEMPTS 회)
   */
  async function checkAndRelayout(container, options = {}) {
    const adapter = createBrowserDomAdapter(container, options);
    let initialCheck = checkPrintLayout(adapter, options);

    if (initialCheck.ok) {
      return {
        ok: true,
        attempts: 0,
        appliedStages: [],
        issues: [],
        metrics: initialCheck.metrics,
      };
    }

    let currentCheck = initialCheck;
    const appliedStages = [];

    for (let attempt = 1; attempt <= MAX_RELAYOUT_ATTEMPTS; attempt++) {
      const stages = applyRelayoutStage(container, attempt, currentCheck);
      appliedStages.push(...stages);

      // DOM 레이아웃 재계산 반영
      if (typeof window !== "undefined" && window.requestAnimationFrame) {
        await new Promise(resolve => window.requestAnimationFrame(resolve));
      }

      currentCheck = checkPrintLayout(adapter, options);
      if (currentCheck.ok) {
        return {
          ok: true,
          attempts: attempt,
          appliedStages,
          issues: [],
          metrics: currentCheck.metrics,
        };
      }
    }

    // 교정 실패 시 명시적 인쇄 경고와 안전한 기본 배치 적용
    container.classList.add("print-safe-fallback");
    let warnBanner = container.querySelector(".print-warning-notice");
    if (!warnBanner && typeof document !== "undefined") {
      warnBanner = document.createElement("div");
      warnBanner.className = "print-warning-notice";
      warnBanner.setAttribute("role", "alert");
      warnBanner.textContent = "일부 서식(표·수식)이 페이지 경계에 걸쳐 있을 수 있습니다.";
      container.prepend(warnBanner);
    }

    return {
      ok: false,
      attempts: MAX_RELAYOUT_ATTEMPTS,
      appliedStages,
      issues: currentCheck.issues,
      metrics: currentCheck.metrics,
      warning: "PRINT_RELAYOUT_EXHAUSTED",
    };
  }

  /**
   * 폰트, 수식, 이미지 완료 상태를 확인하는 준비 신호 대기 함수 (고정 대기 금지)
   */
  async function waitForPrintReady(container, options = {}) {
    if (!container) return { ready: false, failedImages: [] };

    // 1. 폰트 완료 신호 확인
    const doc = options.document || (typeof document !== "undefined" ? document : null);
    if (doc && doc.fonts && typeof doc.fonts.ready?.then === "function") {
      try { await doc.fonts.ready; } catch { /* 무시하고 진행 */ }
    }

    // 2. 이미지 디코드 완료 및 실패 상태 기록 (decode 실패를 흡수하지 않고 기록)
    const images = Array.from(container.querySelectorAll("img"));
    const failedImages = [];

    await Promise.all(images.map(async img => {
      try {
        if (img.complete && img.naturalWidth > 0) return;
        if (typeof img.decode === "function") {
          await img.decode();
        }
      } catch (err) {
        img.dataset.decodeFailed = "true";
        failedImages.push({
          src: img.getAttribute("src") || "",
          error: String(err && err.message ? err.message : err),
        });
      }
    }));

    // 3. KaTeX 수식 완료 및 오류 검사
    const formulaErrors = container.querySelectorAll(".katex-error").length;

    return {
      ready: true,
      fontReady: true,
      failedImages,
      formulaErrors,
    };
  }

  const api = Object.freeze({
    A4,
    MAX_RELAYOUT_ATTEMPTS,
    MIN_BODY_FONT_SIZE_PX,
    MIN_OCCUPANCY_RATIO,
    CODES,
    createBrowserDomAdapter,
    checkPrintLayout,
    applyRelayoutStage,
    checkAndRelayout,
    waitForPrintReady,
  });

  globalThis.PrintCheck = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})();
