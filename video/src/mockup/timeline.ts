// hero-mockup.js 의 wall-clock 상태머신(setInterval/rAF)을 프레임 기반 순수 함수로 옮긴 것.
// 같은 frame 을 넣으면 항상 같은 상태가 나와야 한다 — Remotion 은 프레임 단위로 따로 렌더한다.
import { captions, note } from './content';

export const FPS = 30;
/** 원본 데모는 14.4초 캡처라 쇼츠에 길다. 시간축만 배속한다. */
export const DEMO_SPEED = 1.6;
export const CAPTURE_SECONDS = 14.4;
/** 원본: setInterval(generateNoteTick, 24) 에서 24ms 마다 6자 = 250자/초. */
const NOTE_CHARS_PER_SECOND = 6 / 0.024;

/** 캡처 단계가 끝나는 프레임. 이후는 노트 생성 단계. */
export const CAPTURE_END_FRAME = Math.ceil((CAPTURE_SECONDS * FPS) / DEMO_SPEED);
/** 노트 스트리밍이 끝나는 프레임. */
export const NOTE_END_FRAME =
  CAPTURE_END_FRAME + Math.ceil(note.length / ((NOTE_CHARS_PER_SECOND * DEMO_SPEED) / FPS));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const formatTime = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export type CaptureState = {
  stage: 'live' | 'done';
  /** 0.4초 단위로 끊긴 경과 시간 — 카운터/타임코드용 (원본 captureTick 과 동일). */
  elapsed: number;
  /** 끊기지 않은 경과 시간 — 잉크 드로잉처럼 매 프레임 움직여야 하는 값용. */
  elapsedSmooth: number;
  slideIndex: number;
  slideCount: number;
  voiceCount: number;
  queueCount: number;
  scanning: boolean;
  /** 피드에 남는 최근 3줄. */
  feed: { time: string; text: string }[];
  lectureTime: string;
  lectureProgress: number;
  caption: string;
  /** 현재 슬라이드가 뜬 뒤 흐른 시간(초). 잉크 진행률 계산용. */
  inkSeconds: number;
};

export const captureStateAt = (frame: number): CaptureState => {
  const elapsedSmooth = Math.min(CAPTURE_SECONDS, (frame * DEMO_SPEED) / FPS);
  const done = frame >= CAPTURE_END_FRAME;
  // 원본은 0.4초 간격 setInterval 이라 숫자가 계단식으로 올라간다. 그 느낌을 유지한다.
  const elapsed = Math.min(CAPTURE_SECONDS, Math.floor(elapsedSmooth / 0.4 + 1e-9) * 0.4);

  const event = Math.min(captions.length - 1, Math.floor((elapsed + 0.001) / 2.4));
  const slideTurn = Math.floor(event / 2);
  const lastCapture = slideTurn * 4.8;
  const scanning = !done && elapsed - lastCapture < 1.2;

  const feed = [];
  for (let i = Math.max(0, event - 2); i <= event; i++) {
    feed.push({ time: formatTime(727 + i * 2.4), text: captions[i % captions.length] });
  }

  return {
    stage: done ? 'done' : 'live',
    elapsed,
    elapsedSmooth,
    slideIndex: slideTurn % 3,
    slideCount: slideTurn + 1,
    voiceCount: event + 1,
    queueCount: scanning ? 1 : 0,
    scanning,
    feed,
    lectureTime: formatTime(727 + elapsed),
    lectureProgress: Math.min(99, ((727 + elapsed) / 1340) * 100),
    caption: done ? '강의에서 모은 내용이 학습 노트로 정리됩니다.' : captions[event % captions.length],
    inkSeconds: elapsedSmooth - lastCapture,
  };
};

/**
 * 슬라이드 한 장의 잉크 획별 stroke-dashoffset.
 * 원본 paintInk: 0.5초 대기 + 3.6초 필기. 획은 앞에서부터 차례로 그려진다.
 * SVG path 에 pathLength="1" 이 박혀 있어 dashoffset 은 0..1 정규화 값이다.
 * 원본은 획의 실제 길이로 가중했지만, 여기선 획당 동일 시간으로 근사한다.
 * ponytail: 균등 배분 근사. 획 길이 편차가 눈에 띄면 getTotalLength 측정으로 올릴 것.
 */
export const inkDashOffsets = (seconds: number, pathCount: number): number[] => {
  const progress = clamp((seconds - 0.5) / 3.6, 0, 1) * pathCount;
  return Array.from({ length: pathCount }, (_, i) => 1 - clamp(progress - i, 0, 1));
};

/** 노트 스트리밍 커서 — 캡처가 끝난 뒤부터 한 글자씩 늘어난다. */
export const noteCursorAt = (frame: number) => {
  if (frame < CAPTURE_END_FRAME) return 0;
  const chars = ((frame - CAPTURE_END_FRAME) * NOTE_CHARS_PER_SECOND * DEMO_SPEED) / FPS;
  return Math.min(note.length, Math.floor(chars));
};
