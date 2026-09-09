import { decryptToken, encryptToken, type TokenKeyEnv } from "./token-crypto.js";
import { exchangeRefreshToken, OAuthError, type OAuthEnv } from "./x/oauth.js";

export type TokenEnv = TokenKeyEnv & OAuthEnv & { BOT_DB: D1Database; OAUTH_ALERT_WEBHOOK_URL?: string };
export type TokenState = {
  id: number;
  status: "ready" | "refreshing" | "recovery_required";
  generation: number;
  refresh_ciphertext: string;
  access_ciphertext: string | null;
  expires_at: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  error_code: string | null;
};
export type AccessToken = { value: string; generation: number };
const LEASE_MS = 60_000;
const WAIT_MS = 5_000;
const EXPIRY_MARGIN_MS = 300_000;

export class TokenError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "TokenError";
  }
}

async function read(env: TokenEnv): Promise<TokenState> {
  let row: TokenState | null;
  try {
    row = await env.BOT_DB.prepare("SELECT * FROM oauth_token_state WHERE id = 1").first<TokenState>();
  } catch {
    throw new TokenError("TOKEN_STATE_UNAVAILABLE");
  }
  if (!row) throw new TokenError("TOKEN_NOT_INITIALIZED");
  return row;
}

async function event(env: TokenEnv, name: string, generation: number | null, code: string | null = null): Promise<void> {
  console.log(JSON.stringify({ event: name, generation, code }));
  try {
    await env.BOT_DB.prepare(
      "INSERT INTO oauth_token_events (event, generation, error_code, created_at) VALUES (?, ?, ?, ?)",
    ).bind(name, generation, code, Date.now()).run();
  } catch {
    console.error(JSON.stringify({ event: "oauth_audit_write_failed", code: "TOKEN_AUDIT_UNAVAILABLE" }));
  }
}

export async function reportTokenFailure(env: TokenEnv, error: TokenError): Promise<void> {
  console.error(JSON.stringify({ event: "oauth_operator_action_required", code: error.code }));
  if (!env.OAUTH_ALERT_WEBHOOK_URL) {
    console.error(JSON.stringify({ event: "oauth_alert_not_configured" }));
    return;
  }
  try {
    const url = new URL(env.OAUTH_ALERT_WEBHOOK_URL);
    if (url.protocol !== "https:") throw new Error();
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify({ event: "oauth_operator_action_required", code: error.code, environment: env.TOKEN_CONTEXT }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error();
  } catch {
    console.error(JSON.stringify({ event: "oauth_alert_delivery_failed", code: error.code }));
  }
}

async function stopRefresh(env: TokenEnv, row: TokenState, owner: string, code: string): Promise<void> {
  try {
    const result = await env.BOT_DB.prepare(
      `UPDATE oauth_token_state SET status = 'recovery_required', lease_owner = NULL,
       lease_expires_at = NULL, error_code = ?, updated_at = ?
       WHERE id = 1 AND status = 'refreshing' AND generation = ? AND lease_owner = ?`,
    ).bind(code, Date.now(), row.generation, owner).run();
    if (result.meta.changes === 1) await event(env, "oauth_recovery_required", row.generation, code);
  } catch {
    // The durable refreshing state still prevents reuse when D1 recovers.
    console.error(JSON.stringify({ event: "oauth_recovery_write_failed", code }));
  }
}

async function refresh(env: TokenEnv, row: TokenState, owner: string): Promise<AccessToken> {
  try {
    const refreshToken = await decryptToken(env, "refresh", row.refresh_ciphertext);
    // Check configuration/key usability before sending a request that consumes the token.
    await encryptToken(env, "access", "key-check");
    const current = await read(env);
    if (current.status !== "refreshing" || current.generation !== row.generation
      || current.lease_owner !== owner || (current.lease_expires_at ?? 0) <= Date.now()) {
      throw new TokenError("TOKEN_LEASE_LOST");
    }
    const requestedAt = Date.now();
    const tokens = await exchangeRefreshToken(env, refreshToken);
    const access = await encryptToken(env, "access", tokens.accessToken);
    const refreshCiphertext = tokens.refreshToken
      ? await encryptToken(env, "refresh", tokens.refreshToken) : row.refresh_ciphertext;
    const expiresAt = requestedAt + tokens.expiresIn * 1000;
    if (expiresAt - Date.now() < EXPIRY_MARGIN_MS) throw new TokenError("TOKEN_RESPONSE_EXPIRED");
    let changes: number;
    try {
      const result = await env.BOT_DB.prepare(
        `UPDATE oauth_token_state SET status = 'ready', generation = generation + 1,
         access_ciphertext = ?, refresh_ciphertext = ?, expires_at = ?, lease_owner = NULL,
         lease_expires_at = NULL, error_code = NULL, updated_at = ?
         WHERE id = 1 AND status = 'refreshing' AND generation = ? AND lease_owner = ? AND lease_expires_at > ?`,
      ).bind(access, refreshCiphertext, expiresAt, Date.now(), row.generation, owner, Date.now()).run();
      changes = result.meta.changes;
    } catch {
      throw new TokenError("TOKEN_SAVE_UNKNOWN");
    }
    if (changes !== 1) throw new TokenError("TOKEN_LEASE_LOST");
    await event(env, "oauth_refresh_succeeded", row.generation + 1);
    return { value: tokens.accessToken, generation: row.generation + 1 };
  } catch (error) {
    const code = error instanceof TokenError || error instanceof OAuthError ? error.code : "TOKEN_CRYPTO_FAILED";
    await stopRefresh(env, row, owner, code);
    throw new TokenError(code);
  }
}

/** No static-secret fallback: uncertain token state stops every subsequent posting window. */
export async function getAccessToken(env: TokenEnv): Promise<AccessToken> {
  const deadline = Date.now() + WAIT_MS;
  let contentionRecorded = false;
  for (;;) {
    const row = await read(env);
    if (row.status === "recovery_required") throw new TokenError("TOKEN_RECOVERY_REQUIRED");
    if (row.status === "refreshing") {
      if ((row.lease_expires_at ?? 0) <= Date.now()) {
        await stopRefresh(env, row, row.lease_owner!, "TOKEN_LEASE_EXPIRED");
        throw new TokenError("TOKEN_LEASE_EXPIRED");
      }
    } else if (row.access_ciphertext && row.expires_at - Date.now() >= EXPIRY_MARGIN_MS) {
      try {
        return { value: await decryptToken(env, "access", row.access_ciphertext), generation: row.generation };
      } catch {
        throw new TokenError("TOKEN_CRYPTO_FAILED");
      }
    } else {
      const owner = crypto.randomUUID();
      let changes: number;
      try {
        const result = await env.BOT_DB.prepare(
          `UPDATE oauth_token_state SET status = 'refreshing', lease_owner = ?, lease_expires_at = ?, updated_at = ?
           WHERE id = 1 AND status = 'ready' AND generation = ?`,
        ).bind(owner, Date.now() + LEASE_MS, Date.now(), row.generation).run();
        changes = result.meta.changes;
      } catch {
        throw new TokenError("TOKEN_ACQUIRE_UNKNOWN");
      }
      if (changes === 1) {
        await event(env, "oauth_refresh_started", row.generation, "TOKEN_EXPIRING_OR_MISSING");
        return refresh(env, row, owner);
      }
    }
    if (!contentionRecorded) {
      await event(env, "oauth_lease_contended", row.generation);
      contentionRecorded = true;
    }
    if (Date.now() >= deadline) throw new TokenError("TOKEN_WAIT_TIMEOUT");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Recheck immediately before posting so a recovered/replaced generation is not used. */
export async function assertTokenCurrent(env: TokenEnv, token: AccessToken): Promise<void> {
  const row = await read(env);
  if (row.status !== "ready" || row.generation !== token.generation || row.expires_at <= Date.now()) {
    throw new TokenError("TOKEN_STATE_CHANGED");
  }
}

export async function rejectAccessToken(env: TokenEnv, token: AccessToken): Promise<void> {
  try {
    const result = await env.BOT_DB.prepare(
      `UPDATE oauth_token_state SET status = 'recovery_required', error_code = 'TOKEN_POST_401', updated_at = ?
       WHERE id = 1 AND status = 'ready' AND generation = ?`,
    ).bind(Date.now(), token.generation).run();
    if (result.meta.changes === 1) await event(env, "oauth_recovery_required", token.generation, "TOKEN_POST_401");
  } catch {
    console.error(JSON.stringify({ event: "oauth_recovery_write_failed", code: "TOKEN_POST_401" }));
  }
}
