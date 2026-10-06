// 파생 산출물 전용 온디바이스 암호화 저장소. 원본 오디오·영상은 절대 들어오지 않는다.
(() => {
  const STORES = ["keys", "packages", "blobs", "jobs", "logs"];
  const MAX = 16 * 1024 * 1024;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
  const CORRUPT = "보관 데이터가 손상되었거나 다른 위치의 기록입니다.";
  const c = () => globalThis.crypto?.subtle ? globalThis.crypto : require("node:crypto").webcrypto;
  const encode = v => new TextEncoder().encode(v);
  const aadOf = (store, id, schemaVersion) => encode(JSON.stringify({ store, id, schemaVersion }));
  // 다른 realm에서 복원된 Uint8Array도 받아야 해서 instanceof 대신 ArrayBuffer.isView로 본다.
  const isBytes = x => ArrayBuffer.isView(x) && x.BYTES_PER_ELEMENT === 1;

  function memoryAdapter() {
    const maps = Object.fromEntries(STORES.map(s => [s, new Map()]));
    return {
      get: async (s, id) => maps[s].get(id),
      put: async (s, id, v) => { maps[s].set(id, v); },
      // 두 호출자가 동시에 첫 키를 만들 때 서로 다른 키가 덮어쓰는 경쟁을 막는다.
      putIfAbsent: async (s, id, v) => maps[s].has(id) ? maps[s].get(id) : (maps[s].set(id, v), v),
      delete: async (s, id) => { maps[s].delete(id); },
      entries: async s => [...maps[s].entries()],
      clear: async s => { maps[s].clear(); },
    };
  }

  async function indexedDbAdapter({ name = "summrizei", version = 1 } = {}) {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      // 버전이 올라도 이미 있는 스토어를 다시 만들지 않는다.
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const run = (s, mode, fn) => new Promise((resolve, reject) => {
      const tx = db.transaction(s, mode);
      const req = fn(tx.objectStore(s));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
    return {
      get: (s, id) => run(s, "readonly", os => os.get(id)),
      put: (s, id, v) => run(s, "readwrite", os => os.put(v, id)),
      delete: (s, id) => run(s, "readwrite", os => os.delete(id)),
      // get→put을 한 트랜잭션에 묶어야 동시 호출 사이에 다른 키가 끼어들지 않는다.
      putIfAbsent: (s, id, v) => new Promise((resolve, reject) => {
        const tx = db.transaction(s, "readwrite"), os = tx.objectStore(s);
        let stored;
        const get = os.get(id);
        get.onsuccess = () => {
          stored = get.result === undefined ? v : get.result;
          if (get.result === undefined) os.put(v, id);
        };
        tx.oncomplete = () => resolve(stored);
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
      entries: s => new Promise((resolve, reject) => {
        const tx = db.transaction(s, "readonly");
        const keys = tx.objectStore(s).getAllKeys(), vals = tx.objectStore(s).getAll();
        tx.oncomplete = () => resolve(keys.result.map((k, i) => [k, vals.result[i]]));
        tx.onerror = tx.onabort = () => reject(tx.error);
      }),
      clear: s => run(s, "readwrite", os => os.clear()),
    };
  }

  class Store {
    constructor(adapter, key) { this.adapter = adapter; this.key = key; }

    _checkStore(store) {
      if (store === "keys" || !STORES.includes(store)) throw new TypeError("지원하지 않는 저장소입니다.");
    }
    _checkId(id) {
      if (typeof id !== "string" || !ID_RE.test(id)) throw new TypeError("보관 식별자가 올바르지 않습니다.");
    }

    // 위치(store·id·schemaVersion)를 AAD로 묶어 다른 자리로 복사된 암호문을 걸러낸다.
    async _encrypt(store, id, plain, { schemaVersion = 1, meta = null } = {}) {
      if (plain.byteLength > MAX) throw new Error("암호화 보관 한도 16 MiB를 초과했습니다.");
      const iv = c().getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await c().subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadOf(store, id, schemaVersion), tagLength: 128 }, this.key, plain));
      // meta는 암호문 밖 평문으로 저장되므로 ts·bytes 같은 비내용 수치만 허용한다.
      const record = { v: 1, schemaVersion, iv, ct, meta };
      await this.adapter.put(store, id, record);
      return record;
    }

    async _decrypt(store, id, record) {
      if (!record || record.v !== 1 || !isBytes(record.iv) || record.iv.byteLength !== 12 || !isBytes(record.ct)) throw new Error(CORRUPT);
      try {
        return new Uint8Array(await c().subtle.decrypt({ name: "AES-GCM", iv: record.iv, additionalData: aadOf(store, id, record.schemaVersion), tagLength: 128 }, this.key, record.ct));
      } catch { throw new Error(CORRUPT); }
    }

    async _read(store, id) {
      const record = await this.adapter.get(store, id);
      return record == null ? null : this._decrypt(store, id, record);
    }

    async putJson(store, id, value, opts = {}) {
      this._checkStore(store); this._checkId(id);
      return this._encrypt(store, id, encode(JSON.stringify(value)), opts);
    }
    async getJson(store, id) {
      this._checkStore(store); this._checkId(id);
      const plain = await this._read(store, id);
      return plain == null ? null : JSON.parse(new TextDecoder().decode(plain));
    }
    async putBytes(store, id, bytes, opts = {}) {
      this._checkStore(store); this._checkId(id);
      if (!isBytes(bytes)) throw new TypeError("바이트는 Uint8Array여야 합니다.");
      return this._encrypt(store, id, bytes, opts);
    }
    async getBytes(store, id) {
      this._checkStore(store); this._checkId(id);
      return this._read(store, id);
    }
    async delete(store, id) {
      this._checkStore(store); this._checkId(id);
      await this.adapter.delete(store, id);
    }
    async ids(store) {
      this._checkStore(store);
      return (await this.adapter.entries(store)).map(([id]) => id);
    }

    async appendLogBatch(events, { now = Date.now() } = {}) {
      const id = now.toString(36) + "-" + [...c().getRandomValues(new Uint8Array(4))].map(b => b.toString(16).padStart(2, "0")).join("");
      // bytes는 암호문 길이(평문 + GCM 태그 16바이트) — 프루닝 한도 계산에만 쓴다.
      const plain = encode(JSON.stringify(events));
      await this._encrypt("logs", id, plain, { meta: { ts: now, bytes: plain.byteLength + 16 } });
      return id;
    }

    async readLogs({ since = 0 } = {}) {
      const rows = (await this.adapter.entries("logs"))
        .filter(([, r]) => (r?.meta?.ts ?? 0) >= since)
        .sort((a, b) => (a[1].meta?.ts ?? 0) - (b[1].meta?.ts ?? 0));
      const out = [];
      for (const [id, r] of rows) {
        // 깨진 배치 하나가 나머지 로그 열람까지 막지 못하게 건너뛴다.
        try {
          for (const e of JSON.parse(new TextDecoder().decode(await this._decrypt("logs", id, r)))) out.push(e);
        } catch { continue; }
      }
      return out;
    }

    async pruneLogs({ maxAgeMs = 14 * 24 * 3600 * 1000, maxBytes = 20 * 1024 * 1024, now = Date.now() } = {}) {
      const metaOf = r => ({ ts: r?.meta?.ts ?? 0, bytes: r?.meta?.bytes ?? r?.ct?.byteLength ?? 0 });
      let removed = 0;
      const alive = [];
      for (const [id, r] of await this.adapter.entries("logs")) {
        if (now - metaOf(r).ts > maxAgeMs) { await this.adapter.delete("logs", id); removed++; }
        else alive.push([id, r]);
      }
      alive.sort((a, b) => metaOf(a[1]).ts - metaOf(b[1]).ts);
      let total = alive.reduce((s, [, r]) => s + metaOf(r).bytes, 0);
      for (const [id, r] of alive) {
        if (total <= maxBytes) break;
        await this.adapter.delete("logs", id);
        removed++; total -= metaOf(r).bytes;
      }
      return removed;
    }

    // 암호문 파쇄: 키 저장소까지 전부 지우고 새 기기 키로 다시 시작한다.
    async wipe() {
      // 보관함 폴더 지정(핸들)은 강의 데이터가 아니라 설정이다 — 지우면 다음 노트가 "폴더에 쓸 수 없음"으로 저장되지 않는다(필드).
      // 계정 노트 키도 로그인처럼 남긴다 — 지우면 다음 노트가 "계정 보관함 키가 없어"로 저장되지 않는다(서버에서 다시 받을 수 있는 계정 자격이다).
      const folder = await this.adapter.get("keys", "libraryFolder"), library = await this.adapter.get("keys", "library");
      for (const s of STORES) await this.adapter.clear(s);
      if (folder) await this.adapter.put("keys", "libraryFolder", folder);
      if (library) await this.adapter.put("keys", "library", library);
      this.key = await this.adapter.putIfAbsent("keys", "device", await c().subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]));
    }
  }

  async function createStore(adapter) {
    // 후보 키를 먼저 만들고 putIfAbsent로 넣어 동시 초기화에서도 같은 키를 얻는다.
    const candidate = await c().subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    return new Store(adapter, await adapter.putIfAbsent("keys", "device", candidate));
  }

  const api = { STORES, memoryAdapter, indexedDbAdapter, createStore, Store };
  globalThis.PackageStore = api;
  if (typeof module !== "undefined") module.exports = api;
})();
