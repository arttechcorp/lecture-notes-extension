// 합성 슬라이드 영상 HLS 픽스처 생성기 (docs/architecture-v2.md §14.1). 사용법: node tools/make-hls-fixture.mjs <출력 디렉터리>
// 슬라이드 = 4초마다 바뀌는 단색 화면, 오디오 = 사인파. 폰트·실제 강의 없이 결정적으로 만든다(ffmpeg 필요).
// 인코딩 산출물이 저장소에 커밋되지 않도록 저장소 안의 경로는 거부한다.
//   plain/  TS HLS            fmp4/   fMP4 HLS(EXT-X-MAP)     aes/    AES-128(키 URI 있음, 보호 중단 시험용)
//   disc/   DISCONTINUITY(타임스탬프 되감김 + 오디오 44.1k→48k)  iframe/ I-frame 전용 재생목록(BYTERANGE)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLORS = ["ff0000", "00ff00", "0000ff", "ffff00", "ff00ff", "00ffff", "ff8000", "8000ff"];
const SLIDE_SEC = 4, SEG_SEC = 8, GOP_SEC = 2;

// 존재하는 가장 가까운 조상을 realpath로 풀어 심볼릭 링크로 저장소에 들어오는 길도 막는다
function realTarget(p) {
  const rest = []; let cur = path.resolve(p);
  while (!fs.existsSync(cur)) { rest.unshift(path.basename(cur)); cur = path.dirname(cur); }
  return path.join(fs.realpathSync(cur), ...rest);
}
const insideRepo = p => { const r = path.relative(fs.realpathSync(ROOT), realTarget(p)); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

const ffmpeg = args => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });

// 슬라이드 n장을 fps로 이어 붙인 영상 + 사인파 오디오. 키프레임은 GOP_SEC마다 강제(슬라이드 경계 포함).
function encode({ first = 0, slides = 6, fps = 10, hz = 440, rate = 44100, audio = true, tail = [] }) {
  const v = Array.from({ length: slides }, (_, i) => `color=c=0x${COLORS[(first + i) % COLORS.length]}:s=320x180:r=${fps}:d=${SLIDE_SEC}[v${i}]`);
  const graph = [...v, `${v.map((_, i) => `[v${i}]`).join("")}concat=n=${slides}:v=1:a=0[v]`, ...(audio ? [`sine=frequency=${hz}:sample_rate=${rate}:duration=${slides * SLIDE_SEC}[a]`] : [])].join(";");
  ffmpeg(["-filter_complex", graph, "-map", "[v]", ...(audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "64k", "-ac", "1"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-force_key_frames", `expr:gte(t,n_forced*${GOP_SEC})`, "-sc_threshold", "0",
    "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact", ...tail]);
}
const hls = (dir, extra = [], enc = {}) => {
  fs.mkdirSync(dir, { recursive: true });
  encode({ ...enc, tail: ["-f", "hls", "-hls_time", String(SEG_SEC), "-hls_playlist_type", "vod", ...extra, path.join(dir, "index.m3u8")] });
};

export function makeFixtures(out) {
  hls(path.join(out, "plain"), ["-hls_segment_filename", path.join(out, "plain", "seg%d.ts")]);
  hls(path.join(out, "fmp4"), ["-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4", "-hls_segment_filename", path.join(out, "fmp4", "seg%d.m4s")]);

  // AES-128: 키는 시험용 상수다(비밀 아님). 재생목록에 EXT-X-KEY와 키 URI가 들어간다.
  const aes = path.join(out, "aes"); fs.mkdirSync(aes, { recursive: true });
  fs.writeFileSync(path.join(aes, "enc.key"), Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"));
  fs.writeFileSync(path.join(aes, "enc.keyinfo"), `enc.key\n${path.join(aes, "enc.key")}\n0f0e0d0c0b0a09080706050403020100\n`);
  hls(aes, ["-hls_key_info_file", path.join(aes, "enc.keyinfo"), "-hls_segment_filename", path.join(aes, "seg%d.ts")]);

  // DISCONTINUITY: 서로 따로 인코딩한 두 조각(둘 다 PTS가 ~1.4초에서 시작한다)을 이어 붙인다. 뒷조각은 오디오 설정도 다르다.
  const parts = [["a", { slides: 4 }], ["b", { first: 4, slides: 2, hz: 880, rate: 48000 }]];
  const disc = path.join(out, "disc"), lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEG_SEC}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  parts.forEach(([name, enc], i) => {
    hls(path.join(disc, name), ["-hls_segment_filename", path.join(disc, name, "seg%d.ts")], enc);
    if (i) lines.push("#EXT-X-DISCONTINUITY");
    for (const l of fs.readFileSync(path.join(disc, name, "index.m3u8"), "utf8").split("\n")) if (l.startsWith("#EXTINF") || /\.ts$/.test(l)) lines.push(l.endsWith(".ts") ? `${name}/${l}` : l);
  });
  fs.writeFileSync(path.join(disc, "index.m3u8"), [...lines, "#EXT-X-ENDLIST", ""].join("\n"));

  // I-frame 전용: GOP 간격(0.5fps)의 프레임마다 PAT/PMT를 가진 한 장짜리 TS를 만들고, 하나의 파일로 이어 BYTERANGE로 가리킨다.
  const ifr = path.join(out, "iframe"); fs.mkdirSync(ifr, { recursive: true });
  encode({ fps: 1 / GOP_SEC, audio: false, tail: ["-g", "1", "-f", "hls", "-hls_time", "1", "-hls_flags", "iframes_only", "-hls_segment_filename", path.join(ifr, "f%d.ts"), path.join(ifr, "tmp.m3u8")] });
  const frames = fs.readdirSync(ifr).filter(f => /^f\d+\.ts$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))).map(f => ({ f, bytes: fs.readFileSync(path.join(ifr, f)) }));
  let off = 0;
  const body = frames.flatMap(({ bytes }) => { const l = [`#EXTINF:${GOP_SEC.toFixed(6)},`, `#EXT-X-BYTERANGE:${bytes.length}@${off}`, "frames.ts"]; off += bytes.length; return l; });
  fs.writeFileSync(path.join(ifr, "frames.ts"), Buffer.concat(frames.map(x => x.bytes)));
  fs.writeFileSync(path.join(ifr, "index.m3u8"), ["#EXTM3U", "#EXT-X-VERSION:4", `#EXT-X-TARGETDURATION:${GOP_SEC}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-I-FRAMES-ONLY", ...body, "#EXT-X-ENDLIST", ""].join("\n"));
  for (const { f } of frames) fs.rmSync(path.join(ifr, f));
  fs.rmSync(path.join(ifr, "tmp.m3u8"), { force: true });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) { console.error("사용법: node tools/make-hls-fixture.mjs <출력 디렉터리>"); process.exit(2); }
  if (insideRepo(out)) { console.error("저장소 안에는 픽스처를 쓰지 않습니다: " + out); process.exit(2); }
  makeFixtures(path.resolve(out));
  for (const dir of fs.readdirSync(out)) for (const f of fs.readdirSync(path.join(out, dir), { recursive: true })) {
    const p = path.join(out, dir, f); if (fs.statSync(p).isFile()) console.log(`${dir}/${f}\t${fs.statSync(p).size}`);
  }
}
