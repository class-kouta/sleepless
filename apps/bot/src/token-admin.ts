import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { initializeSql, recoverSql, rekeySql, type AdminTokenState } from "./token-admin-sql.js";
import type { TokenKeyEnv } from "./token-crypto.js";

const run = promisify(execFile);
const botDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const wrangler = join(botDirectory, "node_modules/wrangler/bin/wrangler.js");

async function hiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("ADMIN_TTY_REQUIRED");
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(prompt);
  try {
    return (await input.question("")).trim();
  } finally {
    input.close();
    process.stdout.write("\n");
  }
}

type D1Output = { success: boolean; results?: Array<Record<string, unknown>> };

async function main(): Promise<void> {
  const [action, ...args] = process.argv.slice(2);
  if (!action || action === "--help") {
    console.log("Usage: npm run tokens -- <status|init|recover|rekey> --target <production|staging> <--local|--remote> [--persist-to <local-directory>]");
    console.log("recover also requires --confirm-recovery. Credentials are read through hidden prompts or environment variables.");
    return;
  }
  if (!["status", "init", "recover", "rekey"].includes(action)) throw new Error("ADMIN_ARGUMENT_INVALID");
  let target: string | undefined;
  let location: string | undefined;
  let persistTo: string | undefined;
  let confirmRecovery = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--target" && !target) target = args[++index];
    else if (args[index] === "--persist-to" && !persistTo) persistTo = args[++index];
    else if ((args[index] === "--local" || args[index] === "--remote") && !location) location = args[index];
    else if (args[index] === "--confirm-recovery" && !confirmRecovery) confirmRecovery = true;
    else throw new Error("ADMIN_ARGUMENT_INVALID");
  }
  if ((target !== "production" && target !== "staging") || !location) throw new Error("ADMIN_TARGET_REQUIRED");
  if (args.includes("--persist-to") && (!persistTo || location !== "--local")) throw new Error("ADMIN_ARGUMENT_INVALID");
  if (action === "recover" && !confirmRecovery) throw new Error("ADMIN_RECOVERY_CONFIRMATION_REQUIRED");
  const database = target === "production" ? "sleepless-bot" : "sleepless-bot-staging";
  // Do not expose the local token/key environment to Wrangler or its error output.
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(X_|TOKEN_|OAUTH_)/.test(name)));
  childEnv.WRANGLER_SEND_METRICS = "false";
  childEnv.CI = "true";
  const baseArgs = [wrangler, "d1", "execute", database, location, "--env", target === "staging" ? "staging" : "", "--json"];
  if (persistTo) baseArgs.push("--persist-to", persistTo);
  async function execute(sql: string): Promise<D1Output[]> {
    try {
      // Remote --file uses D1's bulk-import API and discards SELECT/RETURNING rows.
      // Use query execution in both environments. SQL contains only ciphertext,
      // never plaintext tokens or encryption keys; no shell is involved.
      const { stdout } = await run(process.execPath, [...baseArgs, "--command", sql], {
        cwd: botDirectory, env: childEnv, maxBuffer: 1_048_576,
      });
      const output = JSON.parse(stdout) as D1Output[];
      if (!Array.isArray(output) || output.some((item) => !item.success)) throw new Error();
      return output;
    } catch {
      // No raw subprocess output: SQL results can contain encrypted credentials.
      throw new Error("ADMIN_D1_RESULT_UNKNOWN_CHECK_STATUS_BEFORE_RETRY");
    }
  }

  function jsonRow(output: D1Output[]): Record<string, unknown> | null {
    const row = output[0]?.results?.[0];
    if (!row) return null;
    // Wrangler formats SQL NULL as the string "null" in ordinary query results.
    // JSON generated inside SQLite preserves nulls and the types of nested fields.
    if (typeof row.state_json !== "string") throw new Error("ADMIN_STATE_INVALID");
    return JSON.parse(row.state_json) as Record<string, unknown>;
  }

  if (action === "status") {
    const result = await execute(`SELECT json_object(
      'status', status, 'generation', generation, 'expires_at', expires_at,
      'lease_expires_at', lease_expires_at, 'error_code', error_code,
      'refresh_key_id', json_extract(refresh_ciphertext, '$.kid'),
      'access_key_id', json_extract(access_ciphertext, '$.kid')) AS state_json
      FROM oauth_token_state WHERE id = 1;`);
    console.log(JSON.stringify({ target, location, state: jsonRow(result) }, null, 2));
    return;
  }
  const existing = await execute(`SELECT json_object('status', status, 'generation', generation,
    'refresh_ciphertext', refresh_ciphertext, 'access_ciphertext', access_ciphertext,
    'lease_expires_at', lease_expires_at) AS state_json FROM oauth_token_state WHERE id = 1;`);
  const row = jsonRow(existing) as AdminTokenState | null;
  if (action === "init" && row) throw new Error("ADMIN_ALREADY_INITIALIZED");
  if (action !== "init" && !row) throw new Error("ADMIN_NOT_INITIALIZED");
  const env: TokenKeyEnv = {
    TOKEN_CONTEXT: `sleepless-bot-${target}`,
    TOKEN_ACTIVE_KEY_ID: process.env.TOKEN_ACTIVE_KEY_ID || "v1",
    TOKEN_ENCRYPTION_KEYS: process.env.TOKEN_ENCRYPTION_KEYS || await hiddenInput(`Key ring JSON for ${target} (hidden): `),
  };
  let sql: string;
  if (action === "rekey") {
    sql = await rekeySql(env, row!);
  } else {
    const token = process.env.X_REFRESH_TOKEN || await hiddenInput(`Fresh refresh token for ${target} (hidden): `);
    sql = action === "init" ? await initializeSql(env, token) : await recoverSql(env, row!, token);
  }
  const changed = await execute(sql);
  const newGeneration = changed[0]?.results?.[0]?.generation;
  if (typeof newGeneration !== "number") throw new Error("ADMIN_STATE_CHANGED_NOT_APPLIED");
  console.log(JSON.stringify({ event: `oauth_admin_${action}_succeeded`, target, location, generation: newGeneration }));
}

main().catch((error: unknown) => {
  const message = error instanceof Error && /^ADMIN_[A-Z0-9_]+$/.test(error.message)
    ? error.message : "ADMIN_OPERATION_FAILED";
  console.error(message);
  process.exitCode = 1;
});
