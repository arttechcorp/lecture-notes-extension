// landing/hero-mockup.html + demo-panel.html 의 마크업을 옮긴 것. 스타일은 랜딩 CSS를 그대로 쓴다.
// 움직이는 값은 전부 timeline.ts 의 순수 함수에서 나온다 — 타이머/CSS transition 없음.
import { useCurrentFrame } from 'remotion';
import { slides } from './slides';
import { noteTitle, note } from './content';
import { renderNote } from './markdown';
import { captureStateAt, formatTime, inkDashOffsets, noteCursorAt, NOTE_END_FRAME } from './timeline';

const Slide: React.FC<{ index: number; inkSeconds: number }> = ({ index, inkSeconds }) => {
  const slide = slides[index];
  const offsets = inkDashOffsets(inkSeconds, slide.ink.length);
  return (
    <div className="lecture-slide">
      <div className="lecture-title">{slide.title}</div>
      <p className="lecture-subtitle">{slide.subtitle}</p>
      <div dangerouslySetInnerHTML={{ __html: slide.body }} />
      <span className="lecture-page">{slide.page}</span>
      <svg className="lecture-ink" viewBox="0 0 960 540">
        {slide.ink.map((d, i) => (
          <path key={i} data-ink="" pathLength={1} d={d} style={{ strokeDashoffset: offsets[i] }} />
        ))}
      </svg>
    </div>
  );
};

// product-panel.css 의 노트/캡처 스타일은 전부 #stageLive · #stageDone 로 한정돼 있다. id 를 그대로 둬야 맞는다.
const CapturePanel: React.FC<{ state: ReturnType<typeof captureStateAt> }> = ({ state }) => (
  <div id="stageLive">
    <div className="statusline">
      <span className="pill live">
        <span className="pulse" />
        캡처 중
      </span>
      <span className="sub">{formatTime(state.elapsed)}</span>
    </div>
    <div className="counters">
      <div className="counter">
        <b>{state.slideCount}</b>
        <span>슬라이드</span>
      </div>
      <div className="counter">
        <b>{state.voiceCount}</b>
        <span>음성 줄</span>
      </div>
      <div className="counter">
        <b>{state.queueCount}</b>
        <span>처리 대기</span>
      </div>
    </div>
    <div className="feed">
      <div className="head">
        <span>지금 인식 중</span>
        <span>최근 3줄</span>
      </div>
      <div id="feedLines">
        {state.feed.map((line, i) => (
          <div key={i}>
            <span className="t">{line.time}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const NotePanel: React.FC<{ frame: number; state: ReturnType<typeof captureStateAt> }> = ({ frame, state }) => {
  const cursor = noteCursorAt(frame);
  const generating = cursor < note.length;
  // 노트가 다 써진 뒤에는 길이를 재지 않고 정해진 만큼 천천히 흘려 읽힌다.
  const scroll = generating ? 0 : Math.min(560, (frame - NOTE_END_FRAME) * 4);
  return (
    <div id="stageDone">
      <div className="statusline">
        <span className="pill ok">{generating ? '노트 생성 중' : '노트 완성'}</span>
        <span className="sub">{`화면 ${state.slideCount}개 · 음성 ${state.voiceCount}줄`}</span>
      </div>
      <h2 className="result-title">{noteTitle}</h2>
      <div className="note-toolbar">
        <div className="note-modes" role="group">
          <button type="button" aria-pressed="true">
            읽기
          </button>
          <button type="button" aria-pressed="false" disabled>
            편집
          </button>
        </div>
        <button className="note-copy" type="button" disabled={generating}>
          복사
        </button>
      </div>
      <div className="note-surface">
        <article
          className="note-document"
          style={{ transform: `translateY(${-scroll}px)` }}
          dangerouslySetInnerHTML={{ __html: renderNote(note.slice(0, cursor), noteTitle) }}
        />
      </div>
      <p className="detail result-help">AI가 작성한 예시 초안입니다. 자동 재생을 멈추고 읽거나 복사할 수 있습니다.</p>
    </div>
  );
};

export const Mockup: React.FC = () => {
  const frame = useCurrentFrame();
  const state = captureStateAt(frame);
  const live = state.stage === 'live';

  return (
    <figure className="mock" data-state={state.stage} style={{ margin: 0 }}>
      <div className="mock-window" style={{ ['--lecture-progress' as string]: `${state.lectureProgress}%` }}>
        <div className="mock-canvas">
          <div className="mock-titlebar">
            <span className="mock-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="mock-tab">
              <span className="mock-favicon">L</span>
              {noteTitle}
              <span className="mock-tab-close">×</span>
            </span>
            <span className="mock-new-tab">+</span>
          </div>
          <div className="mock-urlbar">
            <span className="mock-navigation">
              ←<span>→</span>↻
            </span>
            <span className="mock-url">
              <span className="mock-url-icon" />
              <b>letslearn.org</b>
              <span>/classroom/finance</span>
            </span>
            <span className="mock-extension">
              S<span className="mock-extension-dot" />
            </span>
            <span className="mock-sidebar-icon" />
          </div>
          <div className="mock-body">
            <div className="lecture">
              <div className="lec-topbar">
                <span className="lec-platform">LetsLearn.</span>
                <span className="lec-div" />
                <span className="lec-course">{noteTitle}</span>
                <span className="lec-chapter">기업재무 · 04</span>
              </div>
              <div className="lec-stage">
                <div className="lecture-screen">
                  <Slide index={state.slideIndex} inkSeconds={state.inkSeconds} />
                  <div className="capture-frame" style={{ opacity: state.scanning ? 1 : 0 }}>
                    <span>화면 인식 중</span>
                  </div>
                </div>
                <div className="lecture-caption">{state.caption}</div>
              </div>
              <div className="lec-controls">
                <span className="lec-time">
                  <span>{state.lectureTime}</span> / 22:20
                </span>
                <span className="lec-progress">
                  <i className="lec-buffer" />
                  <i className="lec-knob" />
                </span>
                <span className="lec-wave">
                  {Array.from({ length: 7 }, (_, i) => (
                    <i key={i} style={{ height: live ? 6 + ((i * 5 + frame) % 11) : 4 }} />
                  ))}
                </span>
                <span className="lec-rate">1×</span>
              </div>
            </div>
            <div className="demo-panel">
              <div className="topbar">
                <div>
                  <h1>
                    Summr<span>i</span>zei<span className="brand-dot">.</span>
                  </h1>
                </div>
              </div>
              <nav className="stage-steps">
                <span className={live ? 'active' : ''}>02 캡처</span>
                <i />
                <span className={live ? '' : 'active'}>03 노트</span>
              </nav>
              {live ? <CapturePanel state={state} /> : <NotePanel frame={frame} state={state} />}
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
};
