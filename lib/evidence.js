// Only the owning offscreen session holds these texts.
(() => {
  const normalize = text => String(text || "").normalize("NFC").replace(/\s+/g, " ").trim();
  class EvidenceStore {
    constructor() { this.items = []; this.nextId = 1; this.bytes = 0; }
    add({ source, time = 0, t0 = time, t1 = t0, text, confidence = null, bbox = null, epoch = 0, slideId = null, selection = null, selectionReason = null, relatedEvidenceIds = [] }) {
      text = normalize(text); if (!text) return null;
      source = source === "audio" || source === "asr" ? "asr" : "ocr";
      const previous = [...this.items].reverse().find(e => e.source === source && e.epoch === epoch);
      if (source === "ocr" && previous?.slideId === slideId && previous?.text === text && JSON.stringify(previous.bbox) === JSON.stringify(bbox)) {
        previous.t1 = Math.max(previous.t1, t1); return null;
      }
      const item = { id: "ev-" + this.nextId, source, time: t0, t0, t1, text, confidence: Number.isFinite(confidence) ? confidence : null, bbox, epoch, slideId, revision: 1, status: "confirmed" };
      if (["included", "filtered", "uncertain"].includes(selection)) {
        item.selection = selection;
        item.selectionReason = String(selectionReason || "").slice(0, 300);
        item.relatedEvidenceIds = [...new Set(Array.isArray(relatedEvidenceIds) ? relatedEvidenceIds.filter(id => typeof id === "string") : [])].slice(0, 100);
      }
      const bytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
      if (this.bytes + bytes > 15 * 1024 * 1024) throw new Error("근거 메모리 한도에 도달했습니다. 현재까지의 결과를 확인하세요.");
      this.nextId++; this.bytes += bytes; this.items.push(item); return item;
    }
    snapshot() { return this.items.map(e => ({ ...e })).sort((a,b) => a.epoch-b.epoch || a.t0-b.t0); }
    clear() { this.items = []; this.bytes = 0; this.nextId = 1; }
    restore(items) {
      if (!Array.isArray(items)) throw new Error("보관 자료 형식이 잘못되었습니다.");
      const next = new EvidenceStore(), ids = new Set();
      for (const e of items) {
        if (!e || typeof e.text !== "string" || !Number.isFinite(e.t0 ?? e.time) || e.text.length > 1000000) throw new Error("보관 자료 형식이 잘못되었습니다.");
        if (typeof e.id !== "string" || !/^[\w-]{1,128}$/.test(e.id) || ids.has(e.id) || !Number.isFinite(e.t1) || e.t1 < (e.t0 ?? e.time) || !['asr','ocr'].includes(e.source)) throw new Error("보관 근거 식별자 또는 시각이 잘못되었습니다.");
        const box=e.bbox,validBox=box==null||(typeof box==="object"&&[box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.w>0&&box.h>0&&box.x+box.w<=1&&box.y+box.h<=1);
        const validSelection=e.selection==null||(["included","filtered","uncertain"].includes(e.selection)&&typeof e.selectionReason==="string"&&e.selectionReason.length<=300&&Array.isArray(e.relatedEvidenceIds)&&e.relatedEvidenceIds.length<=100&&e.relatedEvidenceIds.every(id=>typeof id==="string"&&/^[\w-]{1,128}$/.test(id)));
        if(!validBox||!validSelection||!Number.isInteger(e.epoch??0)||(e.epoch??0)<0||(e.confidence!=null&&(!Number.isFinite(e.confidence)||e.confidence<0||e.confidence>1)))throw new Error("보관 근거의 좌표 또는 메타데이터가 잘못되었습니다.");
        ids.add(e.id);
        const item = next.add(e); if (item) item.id = e.id;
      }
      if(next.items.some(e=>e.relatedEvidenceIds?.some(id=>!ids.has(id))))throw new Error("보관 근거 연결이 잘못되었습니다.");
      this.items = next.items; this.bytes = next.bytes; this.nextId = next.items.reduce((max,e) => Math.max(max,Number(e.id.match(/^ev-(\d{1,9})$/)?.[1]) || 0),next.items.length) + 1;
    }
  }
  globalThis.EvidenceStore = EvidenceStore;
  if (typeof module !== "undefined") module.exports = { EvidenceStore, normalize };
})();

