export type OAuthEnv = { X_CLIENT_ID: string; X_CLIENT_SECRET?: string };
export type RefreshedTokens = { accessToken: string; refreshToken?: string; expiresIn: number };

export class OAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OAuthError";
  }
}

/** Exactly one request: a lost response may already have consumed the refresh token. */
export async function exchangeRefreshToken(env: OAuthEnv, refreshToken: string): Promise<RefreshedTokens> {
  if (!env.X_CLIENT_ID) throw new OAuthError("OAUTH_CONFIG_MISSING");
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (env.X_CLIENT_SECRET) {
    headers.set("Authorization", `Basic ${btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`)}`);
  } else {
    body.set("client_id", env.X_CLIENT_ID);
  }
  let response: Response;
  try {
    response = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST", headers, body: body.toString(), signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    // Keep transport diagnostics safe: Fetch errors must never include request bodies.
    const reason = error instanceof DOMException ? error.name
      : error instanceof TypeError ? "TYPE_ERROR" : "UNKNOWN_EXCEPTION";
    console.error(JSON.stringify({ event: "oauth_transport_failure", reason }));
    throw new OAuthError("OAUTH_RESULT_UNKNOWN");
  }
  // Never include X's response body (which can contain credentials) in an error.
  if (!response.ok) throw new OAuthError(`OAUTH_HTTP_${response.status}`);
  try {
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 16_384
      || typeof value.expires_in !== "number" || !Number.isSafeInteger(value.expires_in)
      || value.expires_in <= 300 || value.expires_in > 31_536_000
      || typeof value.token_type !== "string" || value.token_type.toLowerCase() !== "bearer"
      || (value.refresh_token !== undefined && (typeof value.refresh_token !== "string"
        || !value.refresh_token || value.refresh_token.length > 16_384))) {
      throw new Error();
    }
    return { accessToken: value.access_token, refreshToken: value.refresh_token as string | undefined, expiresIn: value.expires_in };
  } catch {
    throw new OAuthError("OAUTH_RESPONSE_INVALID");
  }
}
