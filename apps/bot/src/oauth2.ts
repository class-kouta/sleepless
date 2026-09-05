import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";

export type OAuth2TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createCodeVerifier(): string {
  return base64Url(randomBytes(64));
}

export function createCodeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function clientId(): string {
  return requiredEnvironment("X_CLIENT_ID");
}

export function redirectUri(): string {
  return requiredEnvironment("X_OAUTH2_REDIRECT_URI");
}

function tokenHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (clientSecret) {
    headers.set("Authorization", `Basic ${Buffer.from(`${clientId()}:${clientSecret}`).toString("base64")}`);
  }
  return headers;
}

async function tokenRequest(parameters: URLSearchParams): Promise<OAuth2TokenResponse> {
  if (!process.env.X_CLIENT_SECRET) parameters.set("client_id", clientId());

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: tokenHeaders(),
    body: parameters,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`Token request failed (HTTP ${response.status}).`);

  const token = (await response.json()) as OAuth2TokenResponse;
  if (!token.access_token) throw new Error("Token response did not include an access token.");
  return token;
}

export async function exchangeAuthorizationCode(code: string, verifier: string): Promise<OAuth2TokenResponse> {
  return tokenRequest(new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  }));
}

export async function refreshAccessToken(): Promise<OAuth2TokenResponse> {
  return tokenRequest(new URLSearchParams({
    refresh_token: requiredEnvironment("X_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  }));
}

export async function saveTokens(token: OAuth2TokenResponse): Promise<void> {
  const path = new URL("../.env", import.meta.url);
  const existing = await readFile(path, "utf8");
  const replacements = new Map<string, string>([["X_USER_ACCESS_TOKEN", token.access_token]]);
  if (token.refresh_token) replacements.set("X_REFRESH_TOKEN", token.refresh_token);

  const seen = new Set<string>();
  const lines = existing.split(/\r?\n/).map((line) => {
    const key = line.slice(0, line.indexOf("="));
    const replacement = replacements.get(key);
    if (replacement === undefined) return line;
    seen.add(key);
    return `${key}=${replacement}`;
  });

  for (const [key, value] of replacements) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }

  await writeFile(path, `${lines.join("\n").replace(/\n+$/, "")}\n`, { mode: 0o600 });
}
