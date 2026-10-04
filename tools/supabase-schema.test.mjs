// 파이프라인 v2 DB 계층(supabase/schema.sql + schema-v2.sql) 검증 (docs/architecture-v2.md §12, 테스트 D2·D7·D8).
// 임시 Postgres 클러스터를 띄워 Supabase 표면(auth 스키마, anon/authenticated/service_role)을 흉내 내고 SQL을 실제로 적용한다.
// Postgres 바이너리(initdb·pg_ctl·postgres·psql)가 없거나 root로만 실행 가능하면 건너뛴다. PG_BIN_DIR로 위치를 지정할 수 있다.
// npm 의존성 없이 psql CLI만 쓴다. 클러스터와 임시 폴더는 실패해도 정리한다.
import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_FILES = ["supabase/schema.sql", "supabase/schema-v2.sql"].map((f) => path.join(repo, f));

// ── 바이너리 탐색 ────────────────────────────────────────────────────────────
function unprivilegedWrapper() {
  // initdb/postgres는 root 실행을 거부한다. root면 postgres, nobody 순으로 권한을 내려 실행한다.
  if (spawnSync("setpriv", ["--version"]).status !== 0) return null;
  for (const name of ["postgres", "nobody"]) {
    const uid = spawnSync("id", ["-u", name], { encoding: "utf8" });
    const gid = spawnSync("id", ["-g", name], { encoding: "utf8" });
    if (uid.status === 0 && gid.status === 0) {
      const [u, g] = [Number(uid.stdout), Number(gid.stdout)];
      return { uid: u, gid: g, prefix: ["setpriv", `--reuid=${u}`, `--regid=${g}`, "--init-groups", "--"] };
    }
  }
  return null;
}

function locate() {
  const has = (dir) => Boolean(dir) && ["initdb", "pg_ctl", "postgres"].every((n) => fs.existsSync(path.join(dir, n)));
  const dirs = [process.env.PG_BIN_DIR];
  const cfg = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (cfg.status === 0) dirs.push(cfg.stdout.trim());
  try {
    const versions = fs.readdirSync("/usr/lib/postgresql").filter((v) => /^\d+$/.test(v)).sort((a, b) => b - a);
    for (const v of versions) dirs.push(`/usr/lib/postgresql/${v}/bin`);
  } catch {}
  dirs.push(...(process.env.PATH || "").split(path.delimiter));
  const bin = dirs.find(has);
  if (!bin) return { skip: "Postgres 서버 바이너리(initdb·pg_ctl·postgres)를 찾지 못해 건너뜀 (PG_BIN_DIR로 지정 가능)" };
  const psql = [path.join(bin, "psql"), "psql"].find((c) => spawnSync(c, ["--version"]).status === 0);
  if (!psql) return { skip: "psql을 찾지 못해 건너뜀" };
  let wrap = { prefix: [], uid: null, gid: null };
  if (process.getuid && process.getuid() === 0) {
    wrap = unprivilegedWrapper();
    if (!wrap) return { skip: "root로 실행 중이라 initdb가 거부하고, 권한을 내릴 계정(postgres/nobody)+setpriv도 없어 건너뜀" };
  }
  return { bin, psql, ...wrap };
}

const located = locate();

// ── 클러스터 수명주기 ────────────────────────────────────────────────────────
let cluster = null;
const children = new Set();

function pgCommand(name, args) {
  const cmd = [...located.prefix, path.join(located.bin, name), ...args];
  return spawnSync(cmd[0], cmd.slice(1), { cwd: cluster.root, encoding: "utf8" });
}

function cleanupSync() {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
  if (!cluster) return;
  const { root, data } = cluster;
  cluster = null;
  try {
    const cmd = [...located.prefix, path.join(located.bin, "pg_ctl"), "-D", data, "-m", "immediate", "-w", "stop"];
    spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: "utf8", timeout: 30_000 });
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}

if (!located.skip) {
  process.on("exit", cleanupSync);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { cleanupSync(); process.exit(1); });
}

function startCluster() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lne-pg-"));
  const data = path.join(root, "data");
  cluster = { root, data, env: null };
  if (located.uid !== null) fs.chownSync(root, located.uid, located.gid);
  fs.chmodSync(root, 0o700);

  const init = pgCommand("initdb", ["-D", data, "-U", "supabase_admin", "--auth=trust", "--no-sync", "--locale=C", "-E", "UTF8"]);
  assert.equal(init.status, 0, `initdb 실패: ${init.stderr}`);

  // 소켓만 연다(TCP 없음). 포트는 소켓 파일 이름에만 쓰이지만 무작위로 고른다.
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 20000 + crypto.randomInt(40000);
    const opts = `-p ${port} -k '${root}' -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c shared_buffers=16MB -c max_connections=100`;
    const start = pgCommand("pg_ctl", ["-D", data, "-l", path.join(root, "pg.log"), "-w", "-t", "60", "-o", opts, "start"]);
    if (start.status === 0) {
      cluster.env = {
        ...process.env,
        PGHOST: root, PGPORT: String(port), PGUSER: "postgres", PGDATABASE: "app",
        PGCLIENTENCODING: "UTF8", PGCONNECT_TIMEOUT: "10",
      };
      return;
    }
    lastError = `${start.stderr}\n${fs.existsSync(path.join(root, "pg.log")) ? fs.readFileSync(path.join(root, "pg.log"), "utf8") : ""}`;
  }
  throw new Error(`Postgres 시작 실패: ${lastError}`);
}

// ── psql 도우미 ──────────────────────────────────────────────────────────────
const PSQL_ARGS = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replaceAll("'", "''")}'`);

function prelude({ as, claims } = {}) {
  let s = "";
  if (as) s += `set role ${as};\n`;
  if (claims) s += `set request.jwt.claims = ${lit(JSON.stringify(claims))};\n`;
  return s;
}

function psql(sql, opts = {}) {
  const { user = "postgres", db = "app", allowError = false } = opts;
  const r = spawnSync(located.psql, [...PSQL_ARGS, "-U", user, "-d", db, "-f", "-"], {
    input: prelude(opts) + sql, env: cluster.env, encoding: "utf8", timeout: 60_000,
  });
  if (r.status !== 0 && !allowError) throw new Error(`psql 실패 (${r.status}): ${r.stderr}\n--- sql ---\n${sql}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
}
const q = (sql, opts) => psql(sql, opts).out;
const qj = (sql, opts) => JSON.parse(q(sql, opts));
const fails = (sql, opts, pattern) => {
  const r = psql(sql, { ...opts, allowError: true });
  assert.equal(r.ok, false, `실패해야 하는데 성공했다: ${sql}`);
  assert.match(r.err, pattern);
};

function applyFile(file) {
  const r = spawnSync(located.psql, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "app", "-f", file], {
    env: cluster.env, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(r.status, 0, `${path.basename(file)} 적용 실패: ${r.stderr}`);
  return r.stderr; // 자체 점검 DO 블록의 NOTICE
}

// Supabase가 기본으로 깔아 주는 표면의 최소 흉내: auth 스키마, 세 역할, public의 기본 권한(= 함수 실행권 포함).
// 테이블 기본 권한은 일부러 anon/authenticated에만 준다: service_role 접근이 스키마의 명시적 grant 덕분인지 확인하려는 것(더 엄격한 환경).
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role postgres login createrole createdb;
grant anon, authenticated, service_role to postgres;
create database app owner postgres;
\\c app
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
create schema auth authorization supabase_admin;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, created_at timestamptz not null default now());
create function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable
  as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable
  as $$ select auth.jwt() ->> 'role' $$;
grant usage on schema auth to anon, authenticated, service_role, postgres;
grant all on auth.users to postgres;
grant execute on all functions in schema auth to anon, authenticated, service_role, postgres;
`;

// ── 테스트 데이터 도우미 ─────────────────────────────────────────────────────
const MONTH = "2031-03-01"; // 실제 달과 겹치지 않는 고정 월: 월 경계에서 흔들리지 않고, 전역 월 잔액도 따로 논다
const ADMIN = { email: "jihwanbu26@gmail.com" };
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const SVC = { as: "service_role" };

function newUser(plan = "free") {
  const id = crypto.randomUUID();
  q(`insert into auth.users (id, email) values ('${id}', '${id}@example.com');
     insert into profiles (user_id, plan) values ('${id}', '${plan}');`);
  return id;
}

function reserve(user, requestId, cost, { digest = sha(requestId), month = MONTH, minutes = 0 } = {}) {
  return q(`select reserve_usage(p_user => ${lit(user)}, p_request_id => ${lit(requestId)}, p_digest => ${lit(digest)},
            p_cost_micros => ${cost}, p_month => ${lit(month)}, p_minutes => ${minutes})`, SVC);
}

function settle(user, requestId, cost, status, extra = {}) {
  const { stage = "vision", ...rest } = extra;
  const named = Object.entries(rest).map(([k, v]) => `, p_${k} => ${lit(v)}`).join("");
  return q(`select settle_usage(p_user => ${lit(user)}, p_request_id => ${lit(requestId)},
            p_actual_cost_micros => ${cost === null ? "null::bigint" : cost}, p_status => ${lit(status)}, p_stage => ${lit(stage)}${named})`, SVC);
}

const balance = (user, month = MONTH) =>
  qj(`select coalesce((select row_to_json(m) from (select requests, minutes, cost_micros::int8 as cost_micros from monthly_usage
        where user_id = ${lit(user)} and month = ${lit(month)}) m), '{"requests":0,"minutes":0,"cost_micros":0}')::text`);
const globalUsed = (scope, period) =>
  Number(q(`select coalesce((select cost_micros from global_usage where scope = ${lit(scope)} and period = ${lit(period)}), 0)`));
const ledger = (user) => qj(`select coalesce(json_agg(e order by id), '[]') from usage_events e where user_id = ${lit(user)}`);
const sumLedger = (user) => Number(q(`select coalesce(sum(cost_micros), 0) from usage_events where user_id = ${lit(user)}`));

// 여러 psql 프로세스를 동시에 출발시킨다. 조언 락으로 문을 걸어 두고 전원이 락 대기에 들어온 것을 확인한 뒤 한꺼번에 푼다
// (프로세스 기동 시간차로 우연히 직렬화되어 테스트가 의미 없이 통과하는 것을 막는다).
function startPsql(sql, { keepStdin = false } = {}) {
  const child = spawn(located.psql, [...PSQL_ARGS, "-U", "postgres", "-d", "app", "-f", "-"], { env: cluster.env, stdio: ["pipe", "pipe", "pipe"] });
  children.add(child);
  let out = "", err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => { children.delete(child); resolve({ code, out, err }); });
  });
  child.stdin.write(sql);
  if (!keepStdin) child.stdin.end();
  return { child, done, output: () => out };
}

async function raceAll(calls) {
  const KEY = 7701;
  const holder = startPsql(`select pg_advisory_lock(${KEY});\nselect 'held';\n`, { keepStdin: true });
  const wait = async (cond, what) => {
    for (let i = 0; i < 800; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 25)); }
    throw new Error(`시간 초과: ${what}`);
  };
  try {
    await wait(() => holder.output().includes("held"), "락 보유자 준비");
    const workers = calls.map((call) =>
      startPsql(`set role service_role;\nselect pg_advisory_lock_shared(${KEY});\nselect 'RESULT:' || (${call});\n`));
    await wait(() => Number(q("select count(*) from pg_locks where locktype = 'advisory' and not granted")) === calls.length, "전원 대기");
    holder.child.stdin.end(); // 세션 종료 = 락 해제 → 전원 동시 출발
    const results = await Promise.all(workers.map((w) => w.done));
    return results.map((r) => {
      assert.equal(r.code, 0, `worker 실패: ${r.err}`);
      return r.out.split("\n").find((l) => l.startsWith("RESULT:")).slice(7);
    });
  } finally {
    holder.child.kill("SIGKILL");
  }
}

// ── 테스트 ───────────────────────────────────────────────────────────────────
const NEW_TABLES = {
  plans: "plan monthly_cost_cap_micros monthly_request_cap monthly_minutes_cap placeholder label price_krw edu_price_krw sort",
  global_caps: "scope cap_micros",
  global_usage: "scope period cost_micros",
  profiles: "user_id plan consent_version created_at",
  entitlements: "id user_id plan starts_at ends_at source external_id created_at edu cancel_at_period_end",
  monthly_usage: "user_id month requests minutes cost_micros",
  usage_reservations: "user_id request_id digest month day reserved_cost_micros reserved_minutes status charged_cost_micros created_at settled_at",
  usage_events: "id user_id job_id request_id stage provider model input_tokens output_tokens audio_seconds images cost_micros cost_reported prompt_version schema_version status error_code latency_ms client_version host created_at lecture_seconds slides subject subject_conf",
  vault_objects: "user_id object_id size updated_at storage_path",
  feedback: "user_id job_id rating tags created_at",
  billing_events: "id type user_id received_at merchant_uid amount_krw coupon_code coupon_discount_krw external_id occurred_at",
  provider_slots: "id provider expires_at",
};
const SERVICE_FUNCTIONS = [
  "effective_plan(uuid, timestamptz)",
  "reserve_usage(uuid, text, text, bigint, date, int)",
  "settle_usage(uuid, text, bigint, text, text, text, text, int, int, numeric, int, text, int, text, int, text, text, text, numeric, int, text, numeric)",
  "delete_account_data(uuid)",
  "acquire_provider_slot(text, int, int)",
  "release_provider_slot(uuid)",
];

describe("파이프라인 v2 DB 스키마", { skip: located.skip }, () => {
  before(() => {
    startCluster();
    const r = spawnSync(located.psql, ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", "-f", "-"],
      { input: SUPABASE_STUB, env: cluster.env, encoding: "utf8" });
    assert.equal(r.status, 0, `Supabase 스텁 적용 실패: ${r.stderr}`);
    // 결정적 한도를 위한 시험 전용 등급(요금 정책 수치와 분리).
    // t_cost: 비용만 제한 / t_req: 요청 수 3 / t_min: 분 10 / t_big: 사실상 무제한
    applyFile(SCHEMA_FILES[0]);
    applyFile(SCHEMA_FILES[1]);
    q(`insert into plans (plan, monthly_cost_cap_micros, monthly_request_cap, monthly_minutes_cap, placeholder) values
         ('t_cost', 1000000, null, null, false),
         ('t_req', 1000000000, 3, null, false),
         ('t_min', 1000000000, null, 10, false),
         ('t_big', 1000000000000, null, null, false)`);
  });

  after(() => cleanupSync());

  test("멱등: schema.sql과 schema-v2.sql을 두 번 더 적용해도 성공하고 운영자가 고친 한도는 그대로", () => {
    q("update plans set monthly_cost_cap_micros = 123456, placeholder = false where plan = 'free'");
    q("update global_caps set cap_micros = 777 where scope = 'month'");
    try {
      const notices = SCHEMA_FILES.map(applyFile).join("\n");
      assert.match(notices, /OK: admin_stats\/admin_mint_codes\/admin_list_codes/);
      assert.match(notices, /OK: v2 테이블 RLS/);
      assert.equal(q("select monthly_cost_cap_micros || ',' || placeholder::text from plans where plan = 'free'"), "123456,false");
      assert.equal(q("select cap_micros from global_caps where scope = 'month'"), "777");
    } finally {
      // 원복: 시드 값으로 되돌려 이후 테스트가 시드 상태를 본다.
      q("update plans set monthly_cost_cap_micros = 300000, placeholder = true where plan = 'free'");
      q("update global_caps set cap_micros = 150000000 where scope = 'month'");
    }
  });

  test("시드: 등급은 free·essential·professional 하나의 표이고, 가격은 확정값·한도는 임시값(placeholder)이다", () => {
    const plans = qj("select json_object_agg(plan, row_to_json(p)) from (select * from plans where plan not like 't\\_%') p");
    assert.deepEqual(Object.keys(plans).sort(), ["essential", "free", "professional"], "옛 'paid' 등급은 없다");
    assert.deepEqual([plans.free.price_krw, plans.essential.price_krw, plans.essential.edu_price_krw, plans.professional.price_krw], [0, 24000, 14000, 28900]);
    assert.equal(plans.free.edu_price_krw, null);
    for (const p of Object.values(plans)) assert.equal(p.placeholder, true);
    assert.ok(plans.professional.monthly_cost_cap_micros > plans.essential.monthly_cost_cap_micros);
    assert.ok(plans.essential.monthly_cost_cap_micros > plans.free.monthly_cost_cap_micros);
    assert.equal(q("select cap_micros is null from global_caps where scope = 'day'"), "t");
    assert.equal(q("select cap_micros from global_caps where scope = 'month'"), "150000000");
    // 옛 두 번째 등급·사용량 표와 Storage를 남기던 탈퇴 RPC는 없다.
    assert.equal(q("select coalesce(to_regclass('public.subscriptions')::text, '') || coalesce(to_regclass('public.usage_monthly')::text, '')"), "");
    assert.equal(q("select count(*) from pg_proc where proname = 'delete_my_account'"), "0");
  });

  test("가격 표(plan_catalog)는 로그인 없이 읽히고 내부 비용 상한은 내보내지 않는다", () => {
    const rows = qj("select json_agg(c) from plan_catalog() c", { as: "anon" });
    assert.deepEqual(rows.map((r) => r.plan).filter((p) => !p.startsWith("t_")), ["free", "essential", "professional"]);
    const pro = rows.find((r) => r.plan === "professional");
    assert.deepEqual(Object.keys(pro).sort(), ["edu_price_krw", "label", "monthly_minutes_cap", "plan", "price_krw"]);
    assert.equal(pro.label, "Pro");
  });

  test("my_account: 로그인만, 서버와 같은 표(등급·한도·이번 달 사용량)를 읽는다", () => {
    fails("select my_account()", { as: "anon" }, /42501|permission denied/);
    fails("select my_account()", { as: "authenticated", claims: {} }, /42501.*not_authenticated/s);
    const u = newUser("free");
    const me = () => qj("select my_account()::text", { as: "authenticated", claims: { sub: u } });
    assert.deepEqual(me(), { plan: "free", status: "active", edu: false, current_period_end: null, cancel_at_period_end: false, minutes_used: 0, minutes_limit: 180 });
    const month = q("select date_trunc('month', now() at time zone 'utc')::date");
    q(`insert into monthly_usage (user_id, month, minutes) values (${lit(u)}, ${lit(month)}, 42)`);
    q(`insert into entitlements (user_id, plan, source, edu, ends_at) values (${lit(u)}, 'essential', 'payment', true, now() + interval '20 days')`);
    const paid = me();
    assert.equal(paid.plan, "essential");
    assert.equal(paid.edu, true);
    assert.ok(paid.current_period_end);
    assert.equal(paid.minutes_used, 42);
    assert.equal(paid.minutes_limit, Number(q("select monthly_minutes_cap from plans where plan = 'essential'")));
  });

  test("delete_account_data: 해지 예약 없는 결제 구독이 있으면 아무것도 지우지 않고 거절한다", () => {
    const u = newUser("free");
    q(`insert into vault_objects (user_id, object_id, size, storage_path) values (${lit(u)}, 'o1', 10, '${u}/o1');
       insert into entitlements (user_id, plan, source, ends_at) values (${lit(u)}, 'essential', 'payment', now() + interval '20 days')`);
    fails(`select delete_account_data(${lit(u)})`, SVC, /active_subscription/);
    assert.equal(q(`select count(*) from vault_objects where user_id = ${lit(u)}`), "1");
    // 해지 예약 뒤(또는 만료 뒤)에는 지운다. 수동 부여는 결제가 아니라 막지 않는다.
    q(`update entitlements set cancel_at_period_end = true where user_id = ${lit(u)}`);
    q(`insert into entitlements (user_id, plan) values (${lit(u)}, 'professional')`);
    assert.equal(qj(`select delete_account_data(${lit(u)})::text`, SVC).entitlements, 2);
  });

  test("결제 웹훅: apply_billing_event 는 service_role 전용이고 같은 이벤트를 한 번만 반영한다", () => {
    const u = newUser("free"), ext = `c1:${u}`;
    const apply = (id, type, ends, extra = {}) => q(`select apply_billing_event(${lit(id)}, ${lit(type)}, ${lit(u)}, ${lit(extra.plan ?? "essential")},
      ${extra.edu ? "true" : "false"}, ${lit(ext)}, now(), ${ends === null ? "null" : `now() + interval '${ends}'`})`, SVC);
    fails(`select apply_billing_event('e0', 'subscription_payment.completed', ${lit(u)}, 'essential', false, ${lit(ext)}, now(), now() + interval '30 days')`,
      { as: "authenticated", claims: { sub: u, role: "authenticated" } }, /permission denied/);
    assert.equal(apply("e1", "subscription_payment.completed", "30 days", { edu: true }), "applied");
    assert.equal(apply("e1", "subscription_payment.completed", "30 days"), "duplicate");
    assert.equal(q(`select effective_plan(${lit(u)})`, SVC), "essential");
    assert.equal(q(`select edu::text from entitlements where external_id = ${lit(ext)}`), "true");
    // 갱신은 같은 줄의 기간을 늘린다(줄이 늘지 않는다)
    assert.equal(apply("e2", "subscription_payment.completed", "60 days"), "applied");
    assert.equal(q(`select count(*) from entitlements where user_id = ${lit(u)}`), "1");
    // 해지 요청은 기간 끝까지 쓰게 두고, 활성 구독이 아니므로 탈퇴를 막지 않는다
    assert.equal(apply("e3", "subscription.cancel_requested", null), "applied");
    assert.equal(q(`select cancel_at_period_end::text from entitlements where external_id = ${lit(ext)}`), "true");
    assert.equal(q(`select effective_plan(${lit(u)})`, SVC), "essential");
    // 해지 완료는 기간을 닫는다
    assert.equal(apply("e4", "subscription.terminated", null), "applied");
    assert.equal(q(`select effective_plan(${lit(u)}, now() + interval '1 minute')`, SVC), "free");
    assert.equal(apply("e5", "subscription_payment.failed", null), "ignored");
    assert.equal(q(`select count(*) from billing_events where user_id = ${lit(u)}`), "4");
    // 결제번호는 원장에 남아 환불 때 계정을 되찾는 열쇠가 된다
    assert.equal(q(`select apply_billing_event('e6', 'subscription_payment.completed', ${lit(u)}, 'essential', false, ${lit(ext)}, now(), now() + interval '30 days', 'ord-9', 2400, 'a0nw8a', 21600)`, SVC), "applied");
    assert.equal(q(`select user_id::text from billing_events where merchant_uid = 'ord-9'`), u);
    assert.equal(q(`select concat_ws(',', amount_krw, coupon_code, coupon_discount_krw) from billing_events where merchant_uid = 'ord-9'`), "2400,a0nw8a,21600");
  });

  test("결제 웹훅: 늦게 온 결제 완료는 이미 반영된 해지·환불을 되돌리지 않는다", () => {
    const u = newUser("free"), ext = `c2:${u}`;
    const at = (id, type, occurred, ends) => q(`select apply_billing_event(${lit(id)}, ${lit(type)}, ${lit(u)}, 'essential', false, ${lit(ext)},
      now(), ${ends ? `now() + interval '${ends}'` : "null"}, null, null, null, null, ${occurred ? lit(occurred) + "::timestamptz" : "null"})`, SVC);
    const row = () => q(`select concat_ws(',', cancel_at_period_end, ends_at > now() + interval '1 day') from entitlements where external_id = ${lit(ext)}`);
    assert.equal(at("o1", "subscription_payment.completed", "2026-10-03T10:00:00Z", "30 days"), "applied");
    assert.equal(at("o2", "subscription.cancel_requested", "2026-10-03T11:00:00Z"), "applied");
    // 10:30에 일어난 갱신 완료가 재시도로 늦게 도착 — 해지 표시를 풀지 않는다
    assert.equal(at("o3", "subscription_payment.completed", "2026-10-03T10:30:00Z", "60 days"), "stale");
    assert.equal(row(), "t,t");
    assert.equal(at("o3", "subscription_payment.completed", "2026-10-03T10:30:00Z", "60 days"), "duplicate");
    // 환불 뒤에 늦게 온 결제 완료도 닫힌 기간을 다시 열지 않는다
    assert.equal(at("o4", "subscription_payment.refunded", "2026-10-03T12:00:00Z"), "applied");
    assert.equal(at("o5", "subscription_payment.completed", "2026-10-03T11:30:00Z", "60 days"), "stale");
    assert.equal(q(`select effective_plan(${lit(u)}, now() + interval '1 minute')`, SVC), "free");
    // 해지·환불보다 나중에 일어난 결제(재구독)는 적용한다
    assert.equal(at("o6", "subscription_payment.completed", "2026-10-04T09:00:00Z", "30 days"), "applied");
    assert.equal(row(), "f,t");
  });

  test("결제 웹훅: 지워진 계정의 이벤트는 unknown_user를 돌려주고 아무것도 쓰지 않는다", () => {
    // 탈퇴 뒤 도착한(또는 ref가 틀린) 이벤트 — FK 위반으로 503·무한 재시도가 되면 안 된다.
    const gone = crypto.randomUUID();
    const apply = id => q(`select apply_billing_event(${lit(id)}, 'subscription_payment.completed', ${lit(gone)}, 'essential', false, 'c:gone', now(), now() + interval '30 days')`, SVC);
    assert.equal(apply("e_gone"), "unknown_user");
    assert.equal(q(`select count(*) from billing_events where id = 'e_gone'`), "0", "원장에도 남기지 않는다 — 재시도는 다시 unknown_user");
    assert.equal(q(`select count(*) from entitlements where user_id = ${lit(gone)}`), "0");
    // 같은 이벤트 id는 태우지 않는다: 나중에 그 계정이 생기면(재가입) 그때 적용된다
    q(`insert into auth.users (id, email) values ('${gone}', '${gone}@example.com')`);
    assert.equal(apply("e_gone"), "applied");
  });

  test("학생가 자격: 확인된 학교 도메인 메일만 참이고 로그인 사용자만 부른다", () => {
    const mk = (email, confirmed) => { const id = crypto.randomUUID(); q(`insert into auth.users (id, email, email_confirmed_at) values ('${id}', ${lit(email)}, ${confirmed ? "now()" : "null"})`); return id; };
    const as = id => ({ as: "authenticated", claims: { sub: id, role: "authenticated" } });
    assert.equal(q(`select edu_eligible()::text`, as(mk("kim@snu.ac.kr", true))), "true");
    assert.equal(q(`select edu_eligible()::text`, as(mk("lee@mit.edu", true))), "true");
    assert.equal(q(`select edu_eligible()::text`, as(mk("park@snu.ac.kr", false))), "false");
    assert.equal(q(`select edu_eligible()::text`, as(mk("choi@gmail.com", true))), "false");
    assert.equal(q(`select edu_eligible()::text`, as(mk("x@ac.kr.evil.com", true))), "false");
    fails(`select edu_eligible()`, { as: "anon" }, /permission denied/);
  });

  test("D2: 새 테이블의 컬럼은 허용 목록과 정확히 같고 제목·URL·본문류 컬럼이 없다", () => {
    const names = Object.keys(NEW_TABLES).map(lit).join(",");
    const rows = q(`select table_name || ' ' || string_agg(column_name, ' ' order by ordinal_position)
                    from information_schema.columns where table_schema = 'public' and table_name in (${names}) group by table_name`)
      .split("\n").map((l) => l.split(" ")).map(([t, ...cols]) => [t, cols.join(" ")]);
    assert.deepEqual(Object.fromEntries(rows), NEW_TABLES);
    const forbidden = /title|url|text|content|body|comment|message|transcript|summary|note|name|path/;
    for (const [table, cols] of Object.entries(NEW_TABLES)) {
      for (const col of cols.split(" ")) {
        if (table === "vault_objects" && col === "storage_path") continue; // §12 명시. 경로는 "<user_id>/<object_id>"만(아래 CHECK)
        assert.doesNotMatch(col, forbidden, `${table}.${col}`);
      }
    }
    assert.match(NEW_TABLES.usage_events, /\bhost\b/);
  });

  test("D2: 문자열 컬럼은 전부 CHECK(문자 집합·길이)나 FK로 묶여 있다", () => {
    const loose = q(`select c.table_name || '.' || c.column_name
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name in (${Object.keys(NEW_TABLES).map(lit).join(",")})
        and c.data_type in ('text', 'ARRAY')
        and not exists (select 1 from pg_constraint k
                        where k.conrelid = ('public.' || c.table_name)::regclass and k.contype in ('c', 'f')
                          and pg_get_constraintdef(k.oid) ~ ('\\m' || c.column_name || '\\M'))`);
    assert.equal(loose, "", `제약 없는 문자열 컬럼: ${loose}`);
  });

  test("D2: 호스트 외 자유 입력은 거부된다 (URL·경로·공백·대문자·포트)", () => {
    const user = newUser("t_big");
    const bad = [
      ["host", "learnus.yonsei.ac.kr/course/view.php?id=1"],
      ["host", "https://learnus.yonsei.ac.kr"],
      ["host", "learnus.yonsei.ac.kr:8080"],
      ["host", "LearnUs.Yonsei.ac.kr"],
      ["model", "Lecture 3 슬라이드 요약"],
      ["error_code", "failed on slide about derivatives"],
      ["job_id", "강의 제목"],
    ];
    let i = 0;
    for (const [key, value] of bad) {
      const id = `smuggle-${i++}`;
      assert.equal(reserve(user, id, 10), "reserved");
      fails(`select settle_usage(p_user => ${lit(user)}, p_request_id => ${lit(id)}, p_actual_cost_micros => 5, p_status => 'ok', p_stage => 'vision', p_${key} => ${lit(value)})`,
        SVC, /23514|check constraint/);
    }
    fails(`select settle_usage(p_user => ${lit(user)}, p_request_id => 'smuggle-0', p_actual_cost_micros => 5, p_status => 'ok', p_stage => 'Slide Title')`, SVC, /23514/);
    // 실패한 정산은 통째로 되돌아가 예약이 열려 있고, 올바른 호스트로는 정산된다.
    assert.equal(q(`select count(*) from usage_reservations where user_id = ${lit(user)} and status = 'reserved'`), String(bad.length));
    assert.equal(settle(user, "smuggle-0", 5, "ok", { host: "learnus.yonsei.ac.kr" }), "settled");
    assert.equal(ledger(user)[0].host, "learnus.yonsei.ac.kr");
    fails(`insert into vault_objects (user_id, object_id, size, storage_path) values (${lit(user)}, 'o1', 1, '강의/제목.pdf')`, SVC, /23514/);
    fails(`insert into feedback (user_id, job_id, rating, tags) values (${lit(user)}, 'j1', 5, array['한 줄 평 입니다'])`, SVC, /23514/);
  });

  test("provider_slots: p_max까지 잡히고, 반납·만료로 풀리고, provider끼리 따로 센다", () => {
    const acq = (p, max = 2, ttl = 60000) => q(`select acquire_provider_slot(${lit(p)}, ${max}, ${ttl})`, SVC);
    const full = (p, max = 2) => q(`select acquire_provider_slot(${lit(p)}, ${max}, 60000) is null`, SVC);

    // p_max까지 각각 다른 uuid, 그 다음은 null.
    const a = acq("slot-a"), b = acq("slot-a");
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.match(b, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.notEqual(a, b);
    assert.equal(full("slot-a"), "t");

    // 하나를 놓으면 정확히 하나가 풀린다 — 다음은 다시 null.
    q(`select release_provider_slot(${lit(a)})`, SVC);
    const c = acq("slot-a");
    assert.notEqual(c, b);
    assert.equal(full("slot-a"), "t");
    // 없는 id를 놓아도 오류가 아니다(멱등).
    q("select release_provider_slot(gen_random_uuid())", SVC);

    // 만료된 슬롯은 다음 획득이 회수한다.
    q(`update provider_slots set expires_at = now() - interval '1 second' where provider = 'slot-a'`);
    assert.match(acq("slot-a"), /^[0-9a-f]{8}-/);
    assert.equal(q(`select count(*) from provider_slots where provider = 'slot-a'`), "1");

    // provider가 다르면 상한을 따로 센다.
    assert.match(acq("slot-b", 1), /^[0-9a-f]{8}-/);
    assert.equal(full("slot-b", 1), "t");

    // 인자 검사.
    fails("select acquire_provider_slot('bad', 0, 60000)", SVC, /invalid_slot_args/);
    fails("select acquire_provider_slot('bad', 2, 999)", SVC, /invalid_slot_args/);
    fails("select acquire_provider_slot('bad', 2, 600001)", SVC, /invalid_slot_args/);
    fails("insert into provider_slots (provider, expires_at) values ('빈 칸', now() + interval '1 minute')", SVC, /23514/);

    // anon/authenticated는 두 함수를 못 부른다.
    for (const role of ["anon", "authenticated"]) {
      fails("select acquire_provider_slot('x', 1, 60000)", { as: role }, /42501|permission denied/);
      fails("select release_provider_slot(gen_random_uuid())", { as: role }, /42501|permission denied/);
    }
  });

  test("경계: 새 테이블은 모두 RLS 켜짐, 정책 0개, anon/authenticated 접근 차단", () => {
    const names = Object.keys(NEW_TABLES);
    const rows = q(`select c.relname || ' ' || c.relrowsecurity || ' ' || (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
                    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (${names.map(lit).join(",")}) order by 1`).split("\n");
    assert.equal(rows.length, names.length);
    for (const row of rows) assert.match(row, /^\w+ true 0$/, row);

    // 모든 테이블에 행을 만들어 두고 소유자에겐 보이지만 anon/authenticated에겐 0행인지 본다.
    const w = newUser("t_big");
    assert.equal(reserve(w, "rls-1", 100), "reserved");
    assert.equal(settle(w, "rls-1", 90, "ok", { host: "example.com" }), "settled");
    assert.equal(reserve(w, "rls-2", 100), "reserved");
    q(`insert into entitlements (user_id, plan) values (${lit(w)}, 'essential');
       insert into vault_objects (user_id, object_id, size, storage_path) values (${lit(w)}, 'o1', 10, '${w}/o1');
       insert into feedback (user_id, job_id, rating) values (${lit(w)}, 'j1', 4)`);
    for (const table of names) {
      assert.ok(Number(q(`select count(*) from ${table}`)) > 0, `${table}에 행이 없어 검증이 무의미`);
      for (const role of ["anon", "authenticated"]) {
        assert.equal(q(`select count(*) from ${table}`, { as: role, claims: { sub: w, email: "x@example.com" } }), "0", `${role}가 ${table}를 읽었다`);
      }
    }
    fails(`insert into profiles (user_id, plan) values (gen_random_uuid(), 'essential')`, { as: "authenticated", claims: { sub: w } }, /42501|row-level security/);
    // UPDATE/DELETE는 정책이 없으면 오류 없이 0행에 적용된다.
    for (const role of ["anon", "authenticated"]) {
      assert.equal(q("update plans set monthly_cost_cap_micros = 0 returning 1", { as: role }), "", `${role}가 plans를 고쳤다`);
      assert.equal(q(`delete from usage_events returning 1`, { as: role }), "", `${role}가 원장을 지웠다`);
    }
    assert.equal(q("select count(*) from plans where monthly_cost_cap_micros = 0"), "0");
  });

  test("경계: 서버 전용 함수는 anon/authenticated가 실행할 수 없고 service_role만 된다", () => {
    for (const fn of SERVICE_FUNCTIONS) {
      for (const role of ["anon", "authenticated", "public"]) {
        const sql = role === "public"
          ? `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${fn}'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE')`
          : `select has_function_privilege('${role}', '${fn}', 'execute')`;
        assert.equal(q(sql), "f", `${role}가 ${fn}를 실행할 수 있다`);
      }
      assert.equal(q(`select has_function_privilege('service_role', '${fn}', 'execute')`), "t");
    }
    const user = newUser();
    fails(`select reserve_usage(${lit(user)}, 'x1', '${sha("x1")}', 1)`, { as: "authenticated", claims: { sub: user } }, /42501.*permission denied/s);
    fails(`select delete_account_data(${lit(user)})`, { as: "anon" }, /42501.*permission denied/s);
    fails(`select settle_usage(${lit(user)}, 'x1', 1, 'ok', 'vision')`, { as: "authenticated", claims: { sub: user } }, /42501.*permission denied/s);
  });

  test("D7: 한도 안이면 reserved, 한도(경계 포함)를 넘으면 quota_exceeded — 거절은 흔적을 남기지 않는다", () => {
    const user = newUser("t_cost"); // 상한 1,000,000
    assert.equal(reserve(user, "cap-1", 600_000), "reserved");
    assert.equal(reserve(user, "cap-2", 400_000), "reserved"); // 정확히 상한
    const before = globalUsed("month", MONTH);
    assert.equal(reserve(user, "cap-3", 1), "quota_exceeded");
    assert.deepEqual(balance(user), { requests: 2, minutes: 0, cost_micros: 1_000_000 });
    assert.equal(globalUsed("month", MONTH), before, "거절된 예약이 전역 잔액을 올렸다");
    assert.equal(q(`select count(*) from usage_reservations where user_id = ${lit(user)} and request_id = 'cap-3'`), "0");
    // 상한보다 큰 단건은 처음부터 거절된다.
    assert.equal(reserve(newUser("t_cost"), "cap-big", 1_000_001), "quota_exceeded");
  });

  test("D7: 등급 한도는 plans 데이터에서 읽는다 (프로필 없음 → free, 값을 바꾸면 즉시 반영)", () => {
    const orphan = crypto.randomUUID();
    q(`insert into auth.users (id, email) values ('${orphan}', 'orphan@example.com')`); // profiles 없음
    const freeCap = Number(q("select monthly_cost_cap_micros from plans where plan = 'free'"));
    assert.equal(q(`select effective_plan(${lit(orphan)})`, SVC), "free");
    assert.equal(reserve(orphan, "free-1", freeCap + 1), "quota_exceeded");
    assert.equal(reserve(orphan, "free-2", freeCap), "reserved");
    q("update plans set monthly_cost_cap_micros = monthly_cost_cap_micros + 5 where plan = 'free'");
    try {
      assert.equal(reserve(orphan, "free-3", 5), "reserved");
      assert.equal(reserve(orphan, "free-4", 1), "quota_exceeded");
    } finally {
      q("update plans set monthly_cost_cap_micros = monthly_cost_cap_micros - 5 where plan = 'free'");
    }
    // 존재하지 않는 사용자는 FK로 막힌다(닫힌 채 실패).
    fails(`select reserve_usage(gen_random_uuid(), 'ghost-1', '${sha("g")}', 1)`, SVC, /23503|foreign key/);
    // p_month를 생략하면 UTC 이번 달.
    const user = newUser("t_big");
    assert.equal(q(`select reserve_usage(p_user => ${lit(user)}, p_request_id => 'cur-1', p_digest => '${sha("cur-1")}', p_cost_micros => 1)`, SVC), "reserved");
    assert.equal(q(`select month = date_trunc('month', now() at time zone 'utc')::date from monthly_usage where user_id = ${lit(user)}`), "t");
  });

  test("D7: 요청 수 한도와 분(minutes) 한도, 환불로 자리가 풀린다", () => {
    const byReq = newUser("t_req"); // 요청 3회
    for (const i of [1, 2, 3]) assert.equal(reserve(byReq, `req-${i}`, 1), "reserved");
    assert.equal(reserve(byReq, "req-4", 1), "quota_exceeded");
    assert.equal(settle(byReq, "req-3", null, "error", { error_code: "provider_busy" }), "settled");
    assert.equal(reserve(byReq, "req-5", 1), "quota_exceeded", "정산(환불 아님)은 요청 수를 풀지 않는다");
    // 환불은 푼다
    const byReq2 = newUser("t_req");
    for (const i of [1, 2, 3]) reserve(byReq2, `r-${i}`, 1);
    assert.equal(settle(byReq2, "r-3", null, "refunded", { error_code: "provider_busy" }), "refunded");
    assert.equal(reserve(byReq2, "r-4", 1), "reserved");

    const byMin = newUser("t_min"); // 10분
    assert.equal(reserve(byMin, "m-1", 1, { minutes: 6 }), "reserved");
    assert.equal(reserve(byMin, "m-2", 1, { minutes: 5 }), "quota_exceeded");
    assert.equal(reserve(byMin, "m-3", 1, { minutes: 4 }), "reserved");
    assert.equal(balance(byMin).minutes, 10);
    assert.equal(settle(byMin, "m-3", null, "refunded"), "refunded");
    assert.equal(balance(byMin).minutes, 6);
  });

  test("멱등: 같은 requestId는 duplicate, 본문 digest가 다르면 digest_mismatch, 이중 청구 없음, 사용자별 독립", () => {
    const a = newUser("t_cost");
    const b = newUser("t_cost");
    assert.equal(reserve(a, "idem-1", 100_000), "reserved");
    assert.equal(reserve(a, "idem-1", 100_000), "duplicate");
    assert.equal(reserve(a, "idem-1", 999_999), "duplicate", "재시도의 비용 값은 보지 않는다");
    assert.equal(reserve(a, "idem-1", 100_000, { digest: sha("다른 본문") }), "digest_mismatch");
    assert.deepEqual(balance(a), { requests: 1, minutes: 0, cost_micros: 100_000 });
    assert.equal(reserve(b, "idem-1", 100_000), "reserved", "다른 사용자의 같은 requestId는 충돌하지 않는다");
    // 정산 뒤에도 중복으로 판정된다(서버의 completed 작업과 같다).
    assert.equal(settle(a, "idem-1", 50_000, "ok"), "settled");
    assert.equal(reserve(a, "idem-1", 100_000), "duplicate");
    // 한도 초과로 거절된 요청은 기록되지 않아 같은 id로 다시 시도할 수 있다.
    assert.equal(reserve(a, "idem-2", 2_000_000), "quota_exceeded");
    assert.equal(reserve(a, "idem-2", 100_000), "reserved");
    // 입력 검증
    fails(`select reserve_usage(${lit(a)}, 'bad id', '${sha("x")}', 1)`, SVC, /23514/);
    fails(`select reserve_usage(${lit(a)}, 'idem-9', 'not-a-sha', 1)`, SVC, /23514/);
    fails(`select reserve_usage(${lit(a)}, 'idem-9', '${sha("x")}', -1)`, SVC, /22023|invalid_reservation/);
  });

  test("동시성: 병렬 reserve가 한도를 절대 넘기지 않는다 (정확히 한도/비용 건만 성공)", async () => {
    const user = newUser("t_cost"); // 상한 1,000,000 / 건당 100,000 → 정확히 10건
    const before = globalUsed("month", MONTH);
    const N = 24;
    const results = await raceAll(Array.from({ length: N }, (_, i) =>
      `select reserve_usage(${lit(user)}, 'race-${i}', '${sha(`race-${i}`)}', 100000, ${lit(MONTH)}, 0)`));
    const count = (s) => results.filter((r) => r === s).length;
    assert.equal(count("reserved"), 10, results.join(","));
    assert.equal(count("quota_exceeded"), N - 10, results.join(","));
    assert.deepEqual(balance(user), { requests: 10, minutes: 0, cost_micros: 1_000_000 });
    assert.equal(q(`select count(*) from usage_reservations where user_id = ${lit(user)}`), "10");
    assert.equal(globalUsed("month", MONTH) - before, 1_000_000, "전역 잔액이 사용자 잔액과 어긋났다");
  });

  test("동시성: 같은 requestId를 동시에 보내면 정확히 한 건만 reserved, 나머지는 duplicate", async () => {
    const user = newUser("t_big");
    const results = await raceAll(Array.from({ length: 12 }, () =>
      `select reserve_usage(${lit(user)}, 'same-id', '${sha("same")}', 250000, ${lit(MONTH)}, 0)`));
    assert.equal(results.filter((r) => r === "reserved").length, 1, results.join(","));
    assert.equal(results.filter((r) => r === "duplicate").length, 11, results.join(","));
    assert.deepEqual(balance(user), { requests: 1, minutes: 0, cost_micros: 250_000 });
  });

  test("전역 상한: 월/일 상한은 합산해서 막고, 거절은 사용자 잔액까지 되돌리며, null은 무제한", () => {
    const M2 = "2031-04-01";
    const a = newUser("t_big");
    const b = newUser("t_big");
    try {
      q("update global_caps set cap_micros = 1000000 where scope = 'month'");
      assert.equal(reserve(a, "g-1", 700_000, { month: M2 }), "reserved");
      assert.equal(reserve(b, "g-2", 400_000, { month: M2 }), "quota_exceeded");
      assert.equal(q(`select count(*) from monthly_usage where user_id = ${lit(b)}`), "0", "거절된 호출의 사용자 잔액이 남았다");
      assert.equal(q(`select count(*) from usage_reservations where user_id = ${lit(b)}`), "0");
      assert.equal(reserve(b, "g-3", 300_000, { month: M2 }), "reserved"); // 정확히 상한
      assert.equal(globalUsed("month", M2), 1_000_000);
      // 정산이 실제 비용으로 낮추면 전역 여유가 생긴다.
      assert.equal(settle(a, "g-1", 100_000, "ok"), "settled");
      assert.equal(globalUsed("month", M2), 400_000);
      assert.equal(reserve(b, "g-4", 600_000, { month: M2 }), "reserved");

      q("update global_caps set cap_micros = null where scope = 'month'");
      assert.equal(reserve(a, "g-5", 900_000_000, { month: M2 }), "reserved");

      q("update global_caps set cap_micros = null where scope = 'month'");
      const today = "(now() at time zone 'utc')::date";
      q(`update global_caps set cap_micros = coalesce((select cost_micros from global_usage where scope = 'day' and period = ${today}), 0) + 50 where scope = 'day'`);
      assert.equal(reserve(a, "g-6", 100, { month: M2 }), "quota_exceeded");
      assert.equal(reserve(a, "g-7", 50, { month: M2 }), "reserved");
    } finally {
      q("update global_caps set cap_micros = 150000000 where scope = 'month'; update global_caps set cap_micros = null where scope = 'day'");
    }
  });

  test("정산: 보고된 비용은 예약을 실제 비용으로 바꾸고 원장에 메타데이터가 남는다", () => {
    const user = newUser("t_cost");
    const g0 = globalUsed("month", MONTH);
    assert.equal(reserve(user, "s-1", 500_000, { minutes: 5 }), "reserved");
    assert.equal(globalUsed("month", MONTH) - g0, 500_000);
    const meta = {
      stage: "vision", provider: "openrouter", model: "google/gemini-2.5-flash-lite", input_tokens: 1200, output_tokens: 300,
      audio_seconds: 12.5, images: 2, prompt_version: "v1", schema_version: 1, latency_ms: 850,
      client_version: "0.4.1", host: "learnus.yonsei.ac.kr", job_id: "job-1",
    };
    assert.equal(settle(user, "s-1", 120_000, "ok", meta), "settled");
    assert.deepEqual(balance(user), { requests: 1, minutes: 5, cost_micros: 120_000 });
    assert.equal(globalUsed("month", MONTH) - g0, 120_000);
    const [row] = ledger(user);
    const { id, created_at, ...rest } = row;
    assert.ok(Number.isInteger(id) && created_at);
    assert.deepEqual(rest, {
      user_id: user, job_id: "job-1", request_id: "s-1", stage: "vision", provider: "openrouter", model: "google/gemini-2.5-flash-lite",
      input_tokens: 1200, output_tokens: 300, audio_seconds: 12.5, images: 2, cost_micros: 120_000, cost_reported: true,
      prompt_version: "v1", schema_version: 1, status: "ok", error_code: null, latency_ms: 850, client_version: "0.4.1", host: "learnus.yonsei.ac.kr",
      lecture_seconds: null, slides: null, subject: null, subject_conf: null,
    });
    assert.equal(q(`select status || ',' || charged_cost_micros from usage_reservations where user_id = ${lit(user)} and request_id = 's-1'`), "settled,120000");

    // 실제 비용이 예약보다 크면 이미 쓴 돈이라 그대로 반영한다(한도를 살짝 넘을 수 있다).
    assert.equal(reserve(user, "s-2", 100_000), "reserved");
    assert.equal(settle(user, "s-2", 150_000, "ok"), "settled");
    assert.equal(balance(user).cost_micros, 270_000);
    assert.equal(sumLedger(user), 270_000, "원장 합계와 잔액이 어긋났다");
  });

  test("정산: 작업 id·호스트·강의 길이·슬라이드 수·분야가 원장에 남고, 나쁜 host·subject는 CHECK가 거절한다", () => {
    const user = newUser("t_big");
    assert.equal(reserve(user, "job-a", 5000), "reserved");
    assert.equal(settle(user, "job-a", 4000, "ok", { stage: "plan", job_id: "note-abc123", host: "learnus.yonsei.ac.kr", lecture_seconds: 3720.5, slides: 42, subject: "econ_101", subject_conf: 0.87 }), "settled");
    const [row] = ledger(user);
    assert.equal(row.job_id, "note-abc123");
    assert.equal(row.host, "learnus.yonsei.ac.kr");
    assert.equal(Number(row.lecture_seconds), 3720.5);
    assert.equal(row.slides, 42);
    assert.equal(row.subject, "econ_101");
    assert.equal(Number(row.subject_conf), 0.87);
    // 자유 텍스트·범위 밖 값은 CHECK가 막는다 — 실패한 정산은 통째로 되돌아간다.
    for (const [i, [key, value]] of [["host", "learnus.yonsei.ac.kr/x?id=1"], ["host", "LearnUs.yonsei.ac.kr"], ["subject", "미시경제학 입문"], ["subject_conf", "1.5"]].entries()) {
      const id = `job-b${i}`;
      assert.equal(reserve(user, id, 5000), "reserved");
      fails(`select settle_usage(p_user => ${lit(user)}, p_request_id => ${lit(id)}, p_actual_cost_micros => 4000, p_status => 'ok', p_stage => 'plan', p_${key} => ${lit(value)})`, SVC, /23514|check constraint/);
    }
  });

  test("정산: 미보고 비용은 예약을 그대로 유지한다 (공짜로 가정하지 않음), 오류도 마찬가지", () => {
    const user = newUser("t_cost");
    assert.equal(reserve(user, "u-1", 300_000), "reserved");
    assert.equal(settle(user, "u-1", null, "ok", { model: "google/gemini-2.5-flash-lite" }), "settled");
    assert.equal(balance(user).cost_micros, 300_000);
    assert.equal(reserve(user, "u-2", 200_000), "reserved");
    assert.equal(settle(user, "u-2", null, "error", { error_code: "provider_failed_or_invalid_output", latency_ms: 4000 }), "settled");
    assert.deepEqual(balance(user), { requests: 2, minutes: 0, cost_micros: 500_000 });
    const [first, second] = ledger(user);
    assert.deepEqual([first.cost_micros, first.cost_reported, first.status], [300_000, false, "ok"]);
    assert.deepEqual([second.cost_micros, second.cost_reported, second.status, second.error_code], [200_000, false, "error", "provider_failed_or_invalid_output"]);
    // 비용이 보고된 오류(출력 검증 실패 등)는 실제 비용으로 정산된다.
    assert.equal(reserve(user, "u-3", 200_000), "reserved");
    assert.equal(settle(user, "u-3", 40_000, "error", { error_code: "provider_failed_or_invalid_output" }), "settled");
    assert.equal(balance(user).cost_micros, 540_000);
    assert.equal(sumLedger(user), 540_000);
  });

  test("정산: 환불은 예약을 풀고 같은 requestId로 다시 예약할 수 있다", () => {
    const user = newUser("t_cost");
    const g0 = globalUsed("month", MONTH);
    assert.equal(reserve(user, "f-1", 400_000, { minutes: 3 }), "reserved");
    assert.equal(settle(user, "f-1", null, "refunded", { error_code: "provider_busy", latency_ms: 10_000 }), "refunded");
    assert.deepEqual(balance(user), { requests: 0, minutes: 0, cost_micros: 0 });
    assert.equal(globalUsed("month", MONTH), g0);
    assert.equal(q(`select count(*) from usage_reservations where user_id = ${lit(user)}`), "0");
    const [row] = ledger(user);
    assert.deepEqual([row.status, row.cost_micros, row.cost_reported, row.error_code], ["refunded", 0, true, "provider_busy"]);
    assert.equal(reserve(user, "f-1", 400_000), "reserved", "환불 뒤 같은 requestId 재시도");
    // 환불에 비용을 실을 수 없다.
    fails(`select settle_usage(${lit(user)}, 'f-1', 5, 'refunded', 'vision')`, SVC, /22023|refund_with_cost/);
    assert.equal(balance(user).cost_micros, 400_000);
  });

  test("정산: 두 번째 정산은 원장에 쓰지 않고, 없는 요청은 not_found", () => {
    const user = newUser("t_cost");
    assert.equal(reserve(user, "d-1", 100_000), "reserved");
    assert.equal(settle(user, "d-1", 60_000, "ok"), "settled");
    assert.equal(settle(user, "d-1", 10_000, "ok"), "already_settled");
    assert.equal(settle(user, "d-1", null, "refunded"), "already_settled", "정산 뒤 환불은 불가");
    assert.equal(settle(user, "never-reserved", 1, "ok"), "not_found");
    assert.equal(settle(newUser("t_cost"), "d-1", 1, "ok"), "not_found", "다른 사용자의 요청은 정산할 수 없다");
    assert.equal(ledger(user).length, 1);
    assert.equal(balance(user).cost_micros, 60_000);
    fails(`select settle_usage(${lit(user)}, 'd-1', 1, 'weird', 'vision')`, SVC, /22023|invalid_settlement/);
  });

  test("동시성: 같은 요청을 동시에 정산하면 원장에 한 줄만 남는다", async () => {
    const user = newUser("t_cost");
    assert.equal(reserve(user, "dd-1", 100_000), "reserved");
    const results = await raceAll(Array.from({ length: 6 }, () =>
      `select settle_usage(${lit(user)}, 'dd-1', 30000, 'ok', 'vision')`));
    assert.equal(results.filter((r) => r === "settled").length, 1, results.join(","));
    assert.equal(results.filter((r) => r === "already_settled").length, 5, results.join(","));
    assert.equal(ledger(user).length, 1);
    assert.equal(balance(user).cost_micros, 30_000);
  });

  test("원장은 추가 전용: UPDATE/DELETE는 service_role·소유자 모두 거부, user_id→null만 허용", () => {
    const user = newUser("t_big");
    reserve(user, "ao-1", 10);
    settle(user, "ao-1", 10, "ok");
    const [{ id }] = ledger(user);
    for (const ctx of [SVC, {}]) {
      fails(`update usage_events set cost_micros = 0 where id = ${id}`, ctx, /usage_events_append_only/);
      fails(`update usage_events set user_id = null, cost_micros = 0 where id = ${id}`, ctx, /usage_events_append_only/);
      fails(`update usage_events set user_id = gen_random_uuid() where id = ${id}`, ctx, /usage_events_append_only|23503/);
      fails(`delete from usage_events where id = ${id}`, ctx, /usage_events_append_only/);
    }
    assert.equal(q(`update usage_events set user_id = null where id = ${id} returning 1`, SVC), "1");
    assert.equal(q(`select user_id is null from usage_events where id = ${id}`), "t");
  });

  test("admin_usage: 비관리자(anon·일반 사용자)는 거부, 관리자는 단계·모델별 집계를 받는다", () => {
    const user = newUser("t_big");
    const model = "test/admin-model";
    const plan = [[100, "ok"], [200, "ok"], [300, "ok"], [400, "ok"], [1000, "ok"], [500, "error"], [0, "refunded"]];
    plan.forEach(([latency, status], i) => {
      assert.equal(reserve(user, `au-${i}`, 1000), "reserved");
      const cost = status === "refunded" ? null : 1000 * (i + 1);
      assert.equal(settle(user, `au-${i}`, cost, status, {
        stage: "stt", provider: "groq", model, latency_ms: latency, input_tokens: 10, output_tokens: 5,
        ...(status === "error" ? { error_code: "provider_failed_or_invalid_output" } : {}),
      }), status === "refunded" ? "refunded" : "settled");
    });

    const stranger = { sub: crypto.randomUUID(), email: "nobody@example.com", role: "authenticated" };
    fails("select admin_usage()", { as: "authenticated", claims: stranger }, /42501.*not_admin/s);
    fails("select admin_usage()", { as: "authenticated" }, /42501.*not_admin/s); // 클레임 없음
    fails("select admin_usage()", { as: "anon" }, /42501.*permission denied/s);
    fails("select admin_usage(0)", { as: "authenticated", claims: { ...ADMIN, role: "authenticated" } }, /22023|days_out_of_range/);

    const out = qj("select admin_usage(7)::text", { as: "authenticated", claims: { ...ADMIN, role: "authenticated" } });
    assert.deepEqual(Object.keys(out).sort(), ["by_stage_model", "daily", "global", "since"]);
    const row = out.by_stage_model.find((r) => r.model === model);
    // 환불 제외 6건의 지연 [100,200,300,400,500,1000] → p50 350, p95 875(선형 보간). 비용 = 1+2+3+4+5+6 = 21,000
    assert.equal(row.stage, "stt");
    assert.equal(row.provider, "groq");
    assert.equal(row.requests, 7);
    assert.equal(row.errors, 1);
    assert.equal(row.refunds, 1);
    assert.equal(row.cost_micros, 1000 * (1 + 2 + 3 + 4 + 5 + 6));
    assert.equal(Number(row.error_rate), 0.1667);
    assert.equal(Number(row.p50_latency_ms), 350);
    assert.equal(Number(row.p95_latency_ms), 875);
    assert.equal(row.input_tokens, 70);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const day = out.daily.find((d) => d.day === today) ?? out.daily.find((d) => d.day === yesterday);
    assert.ok(day && day.requests >= 7, JSON.stringify(out.daily));
    assert.ok(out.global.some((g) => g.scope === "month" && "cap_micros" in g));
  });

  test("admin_grant_plan: 비관리자는 거부, 관리자는 부여하고 실효 등급·한도가 바뀐다", () => {
    const user = newUser("free");
    const admin = { ...ADMIN, role: "authenticated" };
    const stranger = { sub: user, email: "nobody@example.com", role: "authenticated" };
    fails(`select admin_grant_plan(${lit(user)}, 'essential')`, { as: "authenticated", claims: stranger }, /42501.*not_admin/s);
    fails(`select admin_grant_plan(${lit(user)}, 'essential')`, { as: "anon" }, /42501.*permission denied/s);
    assert.equal(q("select count(*) from entitlements where user_id = " + lit(user)), "0");

    const freeCap = Number(q("select monthly_cost_cap_micros from plans where plan = 'free'"));
    const paidCap = Number(q("select monthly_cost_cap_micros from plans where plan = 'essential'"));
    assert.equal(reserve(user, "gp-1", freeCap + 1), "quota_exceeded");

    const id = q(`select admin_grant_plan(${lit(user)}, 'essential')`, { as: "authenticated", claims: admin });
    assert.match(id, /^\d+$/);
    assert.equal(q(`select source || ',' || (ends_at is null) from entitlements where id = ${id}`), "manual,true");
    assert.equal(q(`select effective_plan(${lit(user)})`, SVC), "essential");
    assert.equal(reserve(user, "gp-2", freeCap + 1), "reserved", "유료 한도로 올라갔다");
    assert.equal(reserve(user, "gp-3", paidCap), "quota_exceeded");

    fails(`select admin_grant_plan(${lit(user)}, 'no_such_plan')`, { as: "authenticated", claims: admin }, /22023|unknown_plan/);
    fails(`select admin_grant_plan(${lit(user)}, 'essential', now(), now() - interval '1 day')`, { as: "authenticated", claims: admin }, /23514/);

    // 기간: 만료·미래 부여는 실효가 아니고, 가장 큰 한도가 이긴다(강등 없음).
    const other = newUser("free");
    q(`select admin_grant_plan(${lit(other)}, 'essential', now() - interval '3 days', now() - interval '1 day')`, { as: "authenticated", claims: admin });
    assert.equal(q(`select effective_plan(${lit(other)})`, SVC), "free", "만료된 부여");
    q(`select admin_grant_plan(${lit(other)}, 'essential', now() + interval '1 day', null)`, { as: "authenticated", claims: admin });
    assert.equal(q(`select effective_plan(${lit(other)})`, SVC), "free", "아직 시작 전인 부여");
    const paidUser = newUser("essential");
    q(`insert into entitlements (user_id, plan) values (${lit(paidUser)}, 'free')`);
    assert.equal(q(`select effective_plan(${lit(paidUser)})`, SVC), "essential", "프로필이 essential이면 낮은 부여가 겹쳐도 강등되지 않는다");
    // 결제 웹훅 재전송 멱등: (source, external_id) 유일
    q(`insert into entitlements (user_id, plan, source, external_id) values (${lit(user)}, 'essential', 'payment', 'pay_1')`);
    fails(`insert into entitlements (user_id, plan, source, external_id) values (${lit(user)}, 'essential', 'payment', 'pay_1')`, {}, /23505|duplicate key/);
  });

  test("D8: delete_account_data는 개인 행을 지우고 원장은 user_id만 비우며 집계는 남는다", () => {
    const model = "test/deid-model";
    const u = newUser("t_big");
    const v = newUser("t_big");
    const seed = (user) => {
      for (const i of [1, 2]) {
        reserve(user, `del-${i}`, 5000);
        settle(user, `del-${i}`, 4000, "ok", { stage: "judge", provider: "openrouter", model, host: "example.com", latency_ms: 100 * i });
      }
      reserve(user, "del-open", 7000); // 정산 못 한 예약
      q(`insert into vault_objects (user_id, object_id, size, storage_path) values (${lit(user)}, 'o1', 10, '${user}/o1');
         insert into feedback (user_id, job_id, rating, tags) values (${lit(user)}, 'j1', 5, array['good','fast']);
         insert into entitlements (user_id, plan) values (${lit(user)}, 'essential')`);
    };
    seed(u);
    seed(v);
    const admin = { ...ADMIN, role: "authenticated" };
    const agg = () => qj("select admin_usage(7)::text", { as: "authenticated", claims: admin }).by_stage_model.find((r) => r.model === model);
    const before = agg();
    assert.equal(before.requests, 4);

    const counts = qj(`select delete_account_data(${lit(u)})::text`, SVC);
    assert.deepEqual(counts, {
      usage_reservations: 3, monthly_usage: 1, feedback: 1, vault_objects: 1, entitlements: 1, profiles: 1, usage_events_deidentified: 2,
    });
    for (const table of ["profiles", "entitlements", "monthly_usage", "usage_reservations", "vault_objects", "feedback"]) {
      assert.equal(q(`select count(*) from ${table} where user_id = ${lit(u)}`), "0", table);
    }
    assert.equal(q(`select count(*) from usage_events where user_id = ${lit(u)}`), "0");
    // 행은 남고 user_id만 null: 집계는 그대로.
    assert.equal(q(`select count(*) from usage_events where user_id is null and model = ${lit(model)} and request_id like 'del-%'`), "2");
    assert.deepEqual(agg(), before);
    // 다른 사용자는 그대로.
    assert.equal(q(`select count(*) from vault_objects where user_id = ${lit(v)}`), "1");
    assert.equal(ledger(v).length, 2);
    // 재실행은 무해하다(0건).
    const again = qj(`select delete_account_data(${lit(u)})::text`, SVC);
    assert.ok(Object.values(again).every((n) => n === 0), JSON.stringify(again));
    // 삭제 뒤 늦은 정산은 not_found.
    assert.equal(settle(u, "del-open", 1, "ok"), "not_found");

    // auth 사용자 삭제(앱 계층의 마지막 단계, 또는 RPC 없이 삭제된 경우)도 같은 결과: 개인 행은 cascade, 원장은 set null.
    q(`delete from auth.users where id = ${lit(v)}`);
    for (const table of ["profiles", "entitlements", "monthly_usage", "usage_reservations", "vault_objects", "feedback"]) {
      assert.equal(q(`select count(*) from ${table} where user_id = ${lit(v)}`), "0", table);
    }
    assert.equal(q(`select count(*) from usage_events where model = ${lit(model)} and user_id is null`), "4");
    assert.deepEqual(agg(), before);
  });

  test("분석 뷰: exam_period 달력, job_facts 작업 묶기, user_monthly — anon/authenticated 는 못 읽는다", () => {
    // 고정 국가 달력 — 각 구간의 경계 날짜만 확인한다.
    for (const [d, want] of [
      ["2026-04-20", "midterm"], ["2026-04-26", "midterm"], ["2026-10-19", "midterm"], ["2026-10-25", "midterm"],
      ["2026-06-08", "final"], ["2026-06-21", "final"], ["2026-12-07", "final"], ["2026-12-20", "final"],
      ["2026-06-22", "vacation"], ["2026-08-31", "vacation"], ["2026-12-21", "vacation"], ["2026-01-15", "vacation"], ["2028-02-29", "vacation"],
      ["2026-03-01", "semester"], ["2026-04-19", "semester"], ["2026-04-27", "semester"], ["2026-06-07", "semester"],
      ["2026-09-01", "semester"], ["2026-10-26", "semester"], ["2026-12-06", "semester"],
    ]) {
      assert.equal(q(`select exam_period(${lit(d)})`), want, d);
    }

    const user = newUser("essential");
    // 캡처 세션(cap9)의 인식 이벤트와 라이브 요약 작업(live-cap9-1, live-cap9-2)은 같은 job_key 로 묶인다.
    const seedJob = (id, status, meta) => {
      assert.equal(reserve(user, id, 5000), "reserved");
      assert.equal(settle(user, id, status === "error" ? 3000 : 4000, status, meta), status === "refunded" ? "refunded" : "settled");
    };
    seedJob("jf-1", "ok", { stage: "stt", job_id: "cap9", audio_seconds: 120 });
    seedJob("jf-2", "ok", { stage: "plan", job_id: "live-cap9-1", lecture_seconds: 3600, slides: 40, subject: "law", subject_conf: 0.8, host: "learnus.yonsei.ac.kr" });
    seedJob("jf-3", "ok", { stage: "plan", job_id: "live-cap9-2", subject: "music", subject_conf: 0.3 });
    seedJob("jf-4", "error", { stage: "vision.full", job_id: "cap9", error_code: "provider_failed" });
    seedJob("jf-5", "ok", { stage: "plan" }); // job_id 없음 → 뷰에서 제외
    seedJob("jf-6", "ok", { stage: "plan", job_id: "regen-9" });
    seedJob("jf-7", "ok", { stage: "plan", job_id: "lowconf", subject: "music", subject_conf: 0.3 });

    const [job] = qj(`select json_agg(j) from (select * from job_facts where job_key = 'cap9') j`, SVC);
    assert.equal(job.plan, "essential");
    assert.equal(job.requests, 4, "세션 id 와 live-<id>-<n> 이 같은 키로 묶인다");
    assert.equal(job.errors, 1);
    assert.equal(Number(job.stt_min), 2);
    assert.equal(Number(job.lecture_min), 60);
    assert.equal(job.slides, 40);
    assert.equal(job.subject, "law", "subject_conf >= 0.6 인 분야만 본다(0.3 은 제외)");
    assert.equal(job.is_regen, false);
    assert.equal(Number(job.cost_krw), Math.round(15000 / 1e6 * 1400));
    assert.equal(job.host, "learnus.yonsei.ac.kr");
    assert.ok(Number.isInteger(job.weekday) && job.weekday >= 1 && job.weekday <= 7);
    assert.ok(Number.isInteger(job.hour) && job.hour >= 0 && job.hour <= 23);
    assert.ok(["midterm", "final", "vacation", "semester"].includes(job.exam_period));
    assert.ok(job.started_at && job.ended_at && job.started_kst);
    const [regen] = qj(`select json_agg(j) from (select * from job_facts where job_key = 'regen-9') j`, SVC);
    assert.equal(regen.is_regen, true);
    const [low] = qj(`select json_agg(j) from (select * from job_facts where job_key = 'lowconf') j`, SVC);
    assert.equal(low.subject, "unknown", "0.6 미만만 있으면 unknown 이다");
    // job_id 없는 행은 뷰에 나타나지 않는다 — cap9 묶음에도 jf-5 는 없다.
    assert.equal(q(`select count(*) from usage_events where user_id = ${lit(user)} and job_id is null`), "1");

    // user_monthly: 월 잔액 행 + 활동 월 평균 분.
    assert.equal(reserve(user, "jf-8", 100, { minutes: 30 }), "reserved");
    const [m] = qj(`select json_agg(m) from (select * from user_monthly where user_id = ${lit(user)}) m`, SVC);
    assert.equal(m.month, MONTH);
    assert.equal(m.minutes, 30);
    assert.equal(m.requests, 8);
    assert.equal(Number(m.avg_minutes_per_active_month), 30, "한 달뿐이면 평균은 그 달 값이다");

    // anon/authenticated 는 두 뷰를 모두 못 읽고 service_role 만 읽는다.
    for (const role of ["anon", "authenticated"]) {
      fails("select * from job_facts", { as: role }, /42501|permission denied/);
      fails("select * from user_monthly", { as: role }, /42501|permission denied/);
    }
    assert.ok(Number(q("select count(*) from job_facts", SVC)) > 0);
    assert.ok(Number(q("select count(*) from user_monthly", SVC)) > 0);
  });
});
