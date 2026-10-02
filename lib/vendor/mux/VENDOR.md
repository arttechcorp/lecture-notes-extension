# Bundled mux.js (MPEG-TS to fMP4 transmux)

Used only by `lib/media-demux.js` (paid background media path, pipeline v2 Phase 3) to turn HLS TS segments into fMP4 so audio and video samples can be read in memory. Raw media never touches disk (AGENTS.md section 2); this file does no I/O. No other vendored library is needed: `lib/media-demux.js` reads fMP4 sample tables and writes m4a itself, so mp4box.js is deliberately not bundled (revisit when progressive MP4 with `moov` at the end is implemented).

| Field | Value |
| --- | --- |
| Package | `mux.js` 6.3.0 |
| Source | https://github.com/videojs/mux.js, as published at https://registry.npmjs.org/mux.js/-/mux.js-6.3.0.tgz |
| Tarball integrity (npm `dist.integrity`) | `sha512-/QTkbSAP2+w1nxV+qTcumSDN5PA98P0tjrADijIzQHe85oBK3Akhy9AHlH0ne/GombLMz1rLyvVsmrgRxoPDrQ==` |
| License | Apache-2.0 (Brightcove), full text in `LICENSE` (copied unchanged from the package) |

| File | Upstream path | SHA-256 |
| --- | --- | --- |
| `mux-mp4.min.js` | `package/dist/mux-mp4.min.js` | `2c01f04954bf67cfa0bf2294ff82e34df8f9749958a0fe5e5782e46f8be71e87` |
| `LICENSE` | `package/LICENSE` | `1a3c5bb355ae9ea7f0e8e92836b72189c7acf85a487dd8706d5f1dfff9bf7d3d` |

Files are byte-identical to the npm package. Verify with `npm pack mux.js@6.3.0`, extract, and compare `sha256sum`.

## Why this build

- `mux-mp4.min.js` is the MP4-only UMD build (73 KB): `Transmuxer` (TS and ADTS AAC in, fMP4 out), no FLV. It needs no bundler and sets the global `muxjs` when loaded as a classic script (`<script>`, `importScripts`) or as a side-effect module import. No `eval`, no network, no storage, no DOM use; it only references `window.BigInt` in caption and probe helpers that `lib/media-demux.js` does not call (the Transmuxer path runs fine where `window` is undefined, as in Workers and Node).
- Node: the UMD branch calls `require("global/window")`, which is not installed. Load it like a classic script instead: `vm.runInThisContext(fs.readFileSync(".../mux-mp4.min.js", "utf8"))` (see `lib/media-demux.test.js`).
- Not loaded by any extension page yet, so it is outside the packager's dependency closure. When the media Worker or offscreen page loads it, the packager must see it: `<script src>` in an HTML page is followed, `importScripts("...")` in a worker is not (extend `resolveRuntimeClosure` or list `lib/vendor/mux` there).
- The packager audit (`auditSecurityAndInvariants`) scans `lib/vendor/mux/` for cache, OPFS, IndexedDB and downloads APIs; update the file when a build changes.
