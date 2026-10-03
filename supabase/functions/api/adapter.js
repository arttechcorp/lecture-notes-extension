// Deno Request → server/index.js 처리기(handle)의 Node 모양 req/res. index.js가 이걸로 Edge Function을 띄운다.
// 여기서는 Deno의 Request/Response를 그 처리기가 쓰는 Node 모양(req.method·url·headers·본문 반복, res.writeHead·end·close)으로 옮기기만 한다.
import { Buffer } from "node:buffer";

// 함수 경로 접두사(/api, 게이트웨이를 거치면 /functions/v1/api)를 떼어 서버가 아는 /v1/... 로 만든다.
const routeOf = (u) => (u.pathname.replace(/^(?:\/functions\/v1)?\/api(?=\/|$)/, "") || "/") + u.search;

export function adapt(handle) {
  return (request) => new Promise((resolve) => {
    const headers = {};
    request.headers.forEach((v, k) => { headers[k] = v; });
    const req = {
      method: request.method, url: routeOf(new URL(request.url)), headers,
      async *[Symbol.asyncIterator]() { if (request.body) for await (const c of request.body) yield Buffer.from(c); },
    };
    const closers = new Set();
    let status = 200, head = {};
    const res = {
      destroyed: false, writableEnded: false,
      writeHead(s, h) { status = s; head = { ...head, ...h }; return res; },
      end(body) {
        if (res.writableEnded) return;
        res.writableEnded = true;
        resolve(new Response(status === 204 ? null : body ?? null, { status, headers: head }));
        for (const f of [...closers]) f();
      },
      on(ev, f) { if (ev === "close") closers.add(f); return res; },
      removeListener(ev, f) { if (ev === "close") closers.delete(f); return res; },
    };
    // 클라이언트가 끊으면 Node의 "close"처럼 알려 처리기가 상류(제공자) 요청을 멈추고 예약을 정리하게 한다.
    // Deno는 응답을 다 보낸 뒤에도 signal을 abort 하므로(legacy 동작) 끝난 응답은 무시한다.
    request.signal?.addEventListener("abort", () => { if (res.writableEnded) return; res.destroyed = true; for (const f of [...closers]) f(); });
    const fallback = () => { if (!res.writableEnded) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "request_rejected", retryable: false } })); } };
    Promise.resolve().then(() => handle(req, res)).then(fallback, fallback);
  });
}
