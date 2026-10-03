// 확장 프로그램이 부르는 운영 서비스(/v1/*)를 Supabase Edge Function으로 띄운다. 처리 로직은 server/index.js 그대로이고(server.bundle.js),
// Request/Response 변환은 adapter.js가 한다. 확장의 서비스 URL은 https://<project>.supabase.co/functions/v1/api 이다.
// 비밀값(OPENROUTER_API_KEY 등)은 supabase secrets로만 넣는다(server/README.md "Supabase Edge Function 배포").
import Server from "./server.bundle.js";
import { adapt } from "./adapter.js";

// 워커마다 한 번 만든다. 보관함·사용량은 Supabase(JWT 계정)로 가고, 정적 토큰 계정의 파일 장부만 /tmp(워커 수명)에 둔다.
const server = Server.createServer({ VAULT_DIR: "/tmp/summrizei-data", ...Deno.env.toObject() });
Deno.serve(adapt(server.handle));
