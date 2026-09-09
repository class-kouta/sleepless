import { decryptToken, encryptToken, type TokenKeyEnv } from "./token-crypto.js";

export type AdminTokenState = {
  status: "ready" | "refreshing" | "recovery_required";
  generation: number;
  refresh_ciphertext: string;
  access_ciphertext: string | null;
  lease_expires_at: number | null;
};

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function generation(row: AdminTokenState): number {
  if (!Number.isSafeInteger(row.generation) || row.generation < 1) throw new Error("ADMIN_STATE_INVALID");
  return row.generation;
}

/** Contains ciphertext only. init cannot overwrite an existing token state. */
export async function initializeSql(env: TokenKeyEnv, refreshToken: string): Promise<string> {
  const encrypted = await encryptToken(env, "refresh", refreshToken);
  return `INSERT INTO oauth_token_state
    (id, status, generation, refresh_ciphertext, expires_at, updated_at)
    VALUES (1, 'ready', 1, ${literal(encrypted)}, 0, ${Date.now()}) RETURNING generation;`;
}

/** Explicit recovery advances the generation and cannot race an unexpired refresh lease. */
export async function recoverSql(env: TokenKeyEnv, row: AdminTokenState, refreshToken: string): Promise<string> {
  if (row.status === "refreshing" && (row.lease_expires_at ?? Infinity) > Date.now()) {
    throw new Error("ADMIN_REFRESH_IN_PROGRESS");
  }
  const encrypted = await encryptToken(env, "refresh", refreshToken);
  return `UPDATE oauth_token_state SET status = 'ready', generation = generation + 1,
    refresh_ciphertext = ${literal(encrypted)}, access_ciphertext = NULL, expires_at = 0,
    lease_owner = NULL, lease_expires_at = NULL, error_code = NULL, updated_at = ${Date.now()}
    WHERE id = 1 AND generation = ${generation(row)} AND status = ${literal(row.status)}
      AND (status <> 'refreshing' OR lease_expires_at <= ${Date.now()})
    RETURNING generation;`;
}

/** Re-encryption never calls X. A concurrent refresh wins over this maintenance operation. */
export async function rekeySql(env: TokenKeyEnv, row: AdminTokenState): Promise<string> {
  if (row.status !== "ready") throw new Error("ADMIN_STATE_NOT_READY");
  const refresh = await encryptToken(env, "refresh", await decryptToken(env, "refresh", row.refresh_ciphertext));
  const access = row.access_ciphertext
    ? literal(await encryptToken(env, "access", await decryptToken(env, "access", row.access_ciphertext))) : "NULL";
  return `UPDATE oauth_token_state SET generation = generation + 1,
    refresh_ciphertext = ${literal(refresh)}, access_ciphertext = ${access}, updated_at = ${Date.now()}
    WHERE id = 1 AND status = 'ready' AND generation = ${generation(row)} RETURNING generation;`;
}
