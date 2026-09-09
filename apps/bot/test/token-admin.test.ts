import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const directory = fileURLToPath(new URL("..", import.meta.url));

test("operator CLI initializes, inspects, rekeys and recovers an isolated local D1", { timeout: 60_000 }, async () => {
  const storage = await mkdtemp(join(tmpdir(), "sleepless-admin-test-"));
  const keys = JSON.stringify({ v1: Buffer.alloc(32, 4).toString("base64"), v2: Buffer.alloc(32, 5).toString("base64") });
  const refresh = "fake-cli-refresh-never-log";
  const childEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(X_|TOKEN_|OAUTH_|CLOUDFLARE_)/.test(name))),
    WRANGLER_SEND_METRICS: "false", CI: "true", TOKEN_ENCRYPTION_KEYS: keys, X_REFRESH_TOKEN: refresh,
  };
  const options = { cwd: directory, env: childEnv, maxBuffer: 1_048_576 };
  async function command(action: string, flags: string[] = [], activeKey = "v1") {
    const output = await run(process.execPath, ["--import", "tsx", "src/token-admin.ts", action,
      "--target", "staging", "--local", "--persist-to", storage, ...flags], {
      ...options, env: { ...childEnv, TOKEN_ACTIVE_KEY_ID: activeKey },
    });
    assert.ok(!output.stdout.includes(refresh) && !output.stdout.includes(keys));
    assert.ok(!output.stderr.includes(refresh) && !output.stderr.includes(keys));
    return JSON.parse(output.stdout);
  }
  try {
    await assert.rejects(command("status"), /ADMIN_D1_RESULT_UNKNOWN_CHECK_STATUS_BEFORE_RETRY/);
    await run(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "sleepless-bot-staging",
      "--local", "--env", "staging", "--persist-to", storage,
      "--file", "migrations/0003_create_oauth_token_state.sql", "--json"], options);
    assert.equal((await command("status")).state, null);
    assert.equal((await command("init")).generation, 1);
    await assert.rejects(command("init"), /ADMIN_ALREADY_INITIALIZED/);
    let status = (await command("status")).state;
    assert.equal(status.status, "ready");
    assert.equal(status.refresh_key_id, "v1");
    assert.equal(status.access_key_id, null);
    assert.ok(!Object.hasOwn(status, "refresh_ciphertext"));
    assert.equal((await command("rekey", [], "v2")).generation, 2);
    assert.equal((await command("status")).state.refresh_key_id, "v2");
    await assert.rejects(command("recover"), /ADMIN_RECOVERY_CONFIRMATION_REQUIRED/);
    assert.equal((await command("recover", ["--confirm-recovery"], "v2")).generation, 3);
    status = (await command("status")).state;
    assert.equal(status.status, "ready");
    assert.equal(status.expires_at, 0);
    assert.equal(status.generation, 3);
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
});
