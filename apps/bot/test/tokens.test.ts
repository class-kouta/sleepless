import assert from "node:assert/strict";
import { after, before, beforeEach, test, type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { decryptToken, encryptToken } from "../src/token-crypto.js";
import { initializeSql, recoverSql, rekeySql } from "../src/token-admin-sql.js";
import { assertTokenCurrent, getAccessToken, reportTokenFailure, TokenError, type TokenEnv, type TokenState } from "../src/tokens.js";
import { createManagedPost } from "../src/token-post.js";
import worker from "../src/index.js";

const mf = new Miniflare({
  modules: true, compatibilityDate: "2026-03-01", d1Databases: ["DB"],
  script: "export default { fetch() { return new Response('test'); } }",
});
let db: D1Database;
let env: TokenEnv;
const oldRefresh = "test-refresh-old-never-log";
const newRefresh = "test-refresh-new-never-log";
const access = "test-access-never-log";

before(async () => {
  db = await mf.getD1Database("DB") as unknown as D1Database;
  for (const name of ["0001_create_bot_runs.sql", "0002_create_sleepless_counts.sql", "0003_create_oauth_token_state.sql"]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await db.batch(sql.split(";").filter((part) => part.trim()).map((part) => db.prepare(part)));
  }
});
after(async () => { await mf.dispose(); });
beforeEach(async () => {
  await db.batch(["oauth_token_state", "oauth_token_events", "bot_runs", "sleepless_counts"].map((name) => db.prepare(`DELETE FROM ${name}`)));
  env = {
    BOT_DB: db, X_CLIENT_ID: "test-client", X_CLIENT_SECRET: "test-client-secret",
    TOKEN_CONTEXT: "sleepless-bot-staging", TOKEN_ACTIVE_KEY_ID: "v1",
    TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 1).toString("base64"), v2: Buffer.alloc(32, 2).toString("base64") }),
  };
});

async function state(): Promise<TokenState> {
  return (await db.prepare("SELECT * FROM oauth_token_state WHERE id = 1").first<TokenState>())!;
}

async function seed(warm = false): Promise<void> {
  await db.prepare(await initializeSql(env, oldRefresh)).run();
  if (warm) await db.prepare("UPDATE oauth_token_state SET access_ciphertext = ?, expires_at = ? WHERE id = 1")
    .bind(await encryptToken(env, "access", access), Date.now() + 7_200_000).run();
}

function response(refresh: string | undefined = newRefresh): Response {
  return Response.json({ access_token: access, refresh_token: refresh, expires_in: 7200, token_type: "bearer" });
}

function mockFetch(t: TestContext, implementation: typeof fetch) {
  return t.mock.method(globalThis, "fetch", implementation);
}

/** Inject failures around real SQLite execution, without emulating SQL or CAS behavior. */
function faultDatabase(predicate: (sql: string) => boolean, afterCommit = false): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        function wrap(statement: D1PreparedStatement): D1PreparedStatement {
          return new Proxy(statement, {
            get(inner, name) {
              if (name === "bind") return (...values: unknown[]) => wrap(inner.bind(...values));
              if (name === "run") return async () => {
                if (predicate(sql)) {
                  if (afterCommit) await inner.run();
                  throw new Error("simulated D1 response loss");
                }
                return inner.run();
              };
              const value = Reflect.get(inner, name);
              return typeof value === "function" ? value.bind(inner) : value;
            },
          });
        }
        return wrap(target.prepare(sql));
      };
    },
  });
}

test("AES-GCM encrypts with fresh IVs and rejects tampering, wrong kind, context and key", async () => {
  const first = await encryptToken(env, "refresh", oldRefresh);
  const second = await encryptToken(env, "refresh", oldRefresh);
  assert.notEqual(first, second);
  assert.ok(!first.includes(oldRefresh));
  assert.equal(await decryptToken(env, "refresh", first), oldRefresh);
  await assert.rejects(decryptToken(env, "access", first));
  await assert.rejects(decryptToken({ ...env, TOKEN_CONTEXT: "sleepless-bot-production" }, "refresh", first));
  await assert.rejects(decryptToken({ ...env, TOKEN_ENCRYPTION_KEYS: JSON.stringify({ v1: Buffer.alloc(32, 3).toString("base64") }) }, "refresh", first));
  const tampered = JSON.parse(first);
  tampered.data = (tampered.data[0] === "A" ? "B" : "A") + tampered.data.slice(1);
  await assert.rejects(decryptToken(env, "refresh", JSON.stringify(tampered)));
});

test("initialization stores only ciphertext and cannot overwrite existing state", async () => {
  const sql = await initializeSql(env, oldRefresh);
  assert.ok(!sql.includes(oldRefresh));
  await db.prepare(sql).run();
  await assert.rejects(db.prepare(sql).run());
  assert.equal((await state()).generation, 1);
  assert.equal((await state()).access_ciphertext, null);
});

test("valid access token is reused without an OAuth request", async (t) => {
  await seed(true);
  const request = mockFetch(t, async () => { throw new Error("unexpected network"); });
  assert.deepEqual(await getAccessToken(env), { value: access, generation: 1 });
  assert.equal(request.mock.callCount(), 0);
});

test("expired/missing access token rotates both ciphertexts and advances generation", async (t) => {
  await seed();
  const request = mockFetch(t, async (url, options) => {
    assert.equal(url, "https://api.x.com/2/oauth2/token");
    assert.equal(options?.method, "POST");
    assert.equal(new Headers(options?.headers).get("Authorization"), `Basic ${btoa("test-client:test-client-secret")}`);
    assert.equal(new URLSearchParams(options?.body as string).get("refresh_token"), oldRefresh);
    assert.equal((await state()).status, "refreshing");
    return response();
  });
  assert.deepEqual(await getAccessToken(env), { value: access, generation: 2 });
  const row = await state();
  assert.equal(row.status, "ready");
  assert.equal(row.lease_owner, null);
  assert.equal(await decryptToken(env, "refresh", row.refresh_ciphertext), newRefresh);
  assert.equal(await decryptToken(env, "access", row.access_ciphertext!), access);
  assert.ok(row.expires_at > Date.now() + 7_000_000);
  assert.equal(request.mock.callCount(), 1);
});

test("public clients send client_id; omitted refresh token preserves stored token", async (t) => {
  await seed();
  env.X_CLIENT_SECRET = undefined;
  const before = (await state()).refresh_ciphertext;
  mockFetch(t, async (_url, options) => {
    assert.equal(new Headers(options?.headers).get("Authorization"), null);
    assert.equal(new URLSearchParams(options?.body as string).get("client_id"), env.X_CLIENT_ID);
    return Response.json({ access_token: access, expires_in: 7200, token_type: "bearer" });
  });
  await getAccessToken(env);
  assert.equal((await state()).refresh_ciphertext, before);
});

for (const failure of ["network", "timeout", "500", "429", "401", "invalid_grant", "malformed", "missing_expiry", "short_expiry"]) {
  test(`${failure} stops subsequent windows without reusing the refresh token`, async (t) => {
    await seed();
    const logs: string[] = [];
    t.mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
    t.mock.method(console, "error", (...args: unknown[]) => { logs.push(args.join(" ")); });
    const request = mockFetch(t, async () => {
      if (failure === "network") throw new Error(oldRefresh);
      if (failure === "timeout") throw new DOMException(oldRefresh, "TimeoutError");
      if (failure === "invalid_grant") return Response.json({ error: "invalid_grant", detail: oldRefresh }, { status: 400 });
      if (failure === "malformed") return new Response(oldRefresh);
      if (failure === "missing_expiry") return Response.json({ access_token: access, token_type: "bearer" });
      if (failure === "short_expiry") return Response.json({ access_token: access, expires_in: 30, token_type: "bearer" });
      return new Response(oldRefresh, { status: Number(failure) });
    });
    await assert.rejects(getAccessToken(env), TokenError);
    assert.equal((await state()).status, "recovery_required");
    await assert.rejects(getAccessToken(env), /TOKEN_RECOVERY_REQUIRED/);
    assert.equal(request.mock.callCount(), 1);
    for (const value of [oldRefresh, access, env.TOKEN_ENCRYPTION_KEYS]) assert.ok(!logs.join("\n").includes(value));
  });
}

test("parallel callers exchange once and the waiter reads the new generation", async (t) => {
  await seed();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const sent = new Promise<void>((resolve) => { started = resolve; });
  const request = mockFetch(t, async () => { started(); await gate; return response(); });
  const first = getAccessToken(env);
  await sent;
  const second = getAccessToken(env);
  await new Promise((resolve) => setTimeout(resolve, 200));
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ value: access, generation: 2 }, { value: access, generation: 2 }]);
  assert.equal(request.mock.callCount(), 1);
  const audit = await db.prepare("SELECT COUNT(*) AS count FROM oauth_token_events WHERE event = 'oauth_lease_contended'").first<{ count: number }>();
  assert.equal(audit?.count, 1);
});

test("lease waiting is bounded without stealing an active lease", async (t) => {
  await seed();
  await db.prepare("UPDATE oauth_token_state SET status = 'refreshing', lease_owner = 'other', lease_expires_at = ?").bind(Date.now() + 60_000).run();
  const request = mockFetch(t, async () => { throw new Error("unexpected network"); });
  await assert.rejects(getAccessToken(env), /TOKEN_WAIT_TIMEOUT/);
  assert.equal((await state()).lease_owner, "other");
  assert.equal((await state()).status, "refreshing");
  assert.equal(request.mock.callCount(), 0);
});

test("expired lease after Worker termination requires recovery, never takeover", async (t) => {
  await seed();
  await db.prepare("UPDATE oauth_token_state SET status = 'refreshing', lease_owner = 'dead-worker', lease_expires_at = ?").bind(Date.now() - 1).run();
  const request = mockFetch(t, async () => { throw new Error("unexpected network"); });
  await assert.rejects(getAccessToken(env), /TOKEN_LEASE_EXPIRED/);
  await assert.rejects(getAccessToken(env), /TOKEN_RECOVERY_REQUIRED/);
  assert.equal(request.mock.callCount(), 0);
});

test("lost acquisition acknowledgement sends no request and leaves a durable lease", async (t) => {
  await seed();
  const request = mockFetch(t, async () => { throw new Error("unexpected network"); });
  env.BOT_DB = faultDatabase((sql) => sql.includes("SET status = 'refreshing'"), true);
  await assert.rejects(getAccessToken(env), /TOKEN_ACQUIRE_UNKNOWN/);
  assert.equal((await state()).status, "refreshing");
  assert.equal(request.mock.callCount(), 0);
});

for (const afterCommit of [false, true]) {
  test(`D1 save ${afterCommit ? "acknowledgement loss preserves committed generation" : "failure stops old token reuse"}`, async (t) => {
    await seed();
    const request = mockFetch(t, async () => response());
    env.BOT_DB = faultDatabase((sql) => sql.includes("SET status = 'ready', generation = generation + 1"), afterCommit);
    await assert.rejects(getAccessToken(env), /TOKEN_SAVE_UNKNOWN/);
    env.BOT_DB = db;
    if (afterCommit) {
      assert.equal((await state()).status, "ready");
      assert.deepEqual(await getAccessToken(env), { value: access, generation: 2 });
    } else {
      assert.equal((await state()).status, "recovery_required");
      await assert.rejects(getAccessToken(env), /TOKEN_RECOVERY_REQUIRED/);
    }
    assert.equal(request.mock.callCount(), 1);
  });
}

test("D1 outage covering save and stop preserves refreshing until expiry", async (t) => {
  await seed();
  const request = mockFetch(t, async () => response());
  env.BOT_DB = faultDatabase((sql) => sql.includes("SET status = 'ready'") || sql.includes("SET status = 'recovery_required'"));
  await assert.rejects(getAccessToken(env), /TOKEN_SAVE_UNKNOWN/);
  assert.equal((await state()).status, "refreshing");
  env.BOT_DB = db;
  await db.prepare("UPDATE oauth_token_state SET lease_expires_at = ?").bind(Date.now() - 1).run();
  await assert.rejects(getAccessToken(env), /TOKEN_LEASE_EXPIRED/);
  assert.equal(request.mock.callCount(), 1);
});

test("a late refresh after explicit recovery neither overwrites new state nor posts", async (t) => {
  await seed();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const sent = new Promise<void>((resolve) => { started = resolve; });
  const request = mockFetch(t, async () => { started(); await gate; return response(); });
  const posting = assert.rejects(createManagedPost({ ...env, X_BEARER_TOKEN: "counts-only" }, "test"), /TOKEN_LEASE_LOST/);
  await sent;
  await assert.rejects(recoverSql(env, await state(), "fresh-authorization"), /ADMIN_REFRESH_IN_PROGRESS/);
  await db.prepare("UPDATE oauth_token_state SET lease_expires_at = ?").bind(Date.now() - 1).run();
  await db.prepare(await recoverSql(env, await state(), "fresh-authorization")).run();
  release();
  await posting;
  assert.equal((await state()).generation, 2);
  assert.equal((await state()).status, "ready");
  assert.equal(await decryptToken(env, "refresh", (await state()).refresh_ciphertext), "fresh-authorization");
  assert.equal(request.mock.callCount(), 1);
});

test("key rotation re-encrypts both tokens, preserves expiry, and fences stale writers", async () => {
  await seed(true);
  const old = await state();
  env.TOKEN_ACTIVE_KEY_ID = "v2";
  const sql = await rekeySql(env, old);
  assert.ok(!sql.includes(access) && !sql.includes(oldRefresh));
  await db.prepare(sql).run();
  assert.equal((await state()).generation, 2);
  assert.equal((await state()).expires_at, old.expires_at);
  env.TOKEN_ENCRYPTION_KEYS = JSON.stringify({ v2: Buffer.alloc(32, 2).toString("base64") });
  assert.equal(await decryptToken(env, "refresh", (await state()).refresh_ciphertext), oldRefresh);
  assert.equal((await getAccessToken(env)).value, access);
  assert.equal((await db.prepare(sql).run()).meta.changes, 0);
  await assert.rejects(assertTokenCurrent(env, { value: access, generation: 1 }), /TOKEN_STATE_CHANGED/);
});

test("rekey prepared before a concurrent lease cannot replace the token state", async () => {
  await seed(true);
  const sql = await rekeySql({ ...env, TOKEN_ACTIVE_KEY_ID: "v2" }, await state());
  await db.prepare("UPDATE oauth_token_state SET status = 'refreshing', lease_owner = 'other', lease_expires_at = ?").bind(Date.now() + 60_000).run();
  assert.equal((await db.prepare(sql).run()).meta.changes, 0);
  assert.equal((await state()).lease_owner, "other");
});

test("posting 401 blocks later posts and never retries the post or refresh", async (t) => {
  await seed(true);
  const request = mockFetch(t, async () => new Response("Unauthorized", { status: 401 }));
  await assert.rejects(createManagedPost({ ...env, X_BEARER_TOKEN: "counts-only" }, "test"), /TOKEN_POST_401/);
  await assert.rejects(createManagedPost({ ...env, X_BEARER_TOKEN: "counts-only" }, "test"), /TOKEN_RECOVERY_REQUIRED/);
  assert.equal(request.mock.callCount(), 1);
});

test("operator webhook contains only safe fields and never follows redirects", async (t) => {
  const request = mockFetch(t, async (_url, options) => {
    assert.equal(options?.redirect, "error");
    assert.deepEqual(JSON.parse(String(options?.body)), {
      event: "oauth_operator_action_required", code: "TOKEN_RECOVERY_REQUIRED", environment: env.TOKEN_CONTEXT,
    });
    return new Response(null, { status: 204 });
  });
  await reportTokenFailure({ ...env, OAUTH_ALERT_WEBHOOK_URL: "https://alerts.example.test/hook" }, new TokenError("TOKEN_RECOVERY_REQUIRED"));
  assert.equal(request.mock.callCount(), 1);
});

async function scheduled(at: number): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  await worker.scheduled({ scheduledTime: at, cron: "0 * * * *", noRetry() {} },
    { ...env, X_BEARER_TOKEN: "counts-only" }, { waitUntil(task) { tasks.push(task); } } as ExecutionContext);
  await Promise.all(tasks);
}

test("Cron refreshes before posting and duplicate execution does not post twice", async (t) => {
  await seed();
  let refreshes = 0;
  let posts = 0;
  mockFetch(t, async (url, options) => {
    if (String(url).includes("counts/recent")) return Response.json({ meta: { total_tweet_count: 42 } });
    if (String(url).endsWith("oauth2/token")) { refreshes += 1; return response(); }
    assert.equal(new Headers(options?.headers).get("Authorization"), `Bearer ${access}`);
    posts += 1;
    return Response.json({ data: { id: "12345" } });
  });
  const at = Date.parse("2026-09-07T13:00:00Z");
  await scheduled(at);
  await scheduled(at);
  assert.equal(refreshes, 1);
  assert.equal(posts, 1);
  assert.equal((await db.prepare("SELECT status FROM bot_runs").first<{ status: string }>())?.status, "posted");
});

test("failed refresh marks this and subsequent Cron windows failed with safe reasons", async (t) => {
  await seed();
  let refreshes = 0;
  mockFetch(t, async (url) => {
    if (String(url).includes("counts/recent")) return Response.json({ meta: { total_tweet_count: 42 } });
    assert.ok(String(url).endsWith("oauth2/token"));
    refreshes += 1;
    throw new Error(oldRefresh);
  });
  await scheduled(Date.parse("2026-09-07T13:00:00Z"));
  await scheduled(Date.parse("2026-09-07T14:00:00Z"));
  const runs = await db.prepare("SELECT status, error_code FROM bot_runs ORDER BY window_end_at").all();
  assert.deepEqual(runs.results, [
    { status: "failed", error_code: "OAUTH_RESULT_UNKNOWN" },
    { status: "failed", error_code: "TOKEN_RECOVERY_REQUIRED" },
  ]);
  assert.equal(refreshes, 1);
});

test("staging endpoint authenticates first and exposes no token in successful response", async (t) => {
  await seed();
  const request = mockFetch(t, async (url) => String(url).endsWith("oauth2/token")
    ? response() : Response.json({ data: { id: "12345" } }));
  const workerEnv = { ...env, X_BEARER_TOKEN: "counts-only", TEST_POST_SECRET: "test-endpoint-secret" };
  assert.equal((await worker.fetch(new Request("https://bot.test/test-post", { method: "POST" }), workerEnv)).status, 401);
  assert.equal(request.mock.callCount(), 0);
  const result = await worker.fetch(new Request("https://bot.test/test-post", {
    method: "POST", headers: { Authorization: "Bearer test-endpoint-secret" },
  }), workerEnv);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { id: "12345" });
  assert.equal(request.mock.callCount(), 2);
});
