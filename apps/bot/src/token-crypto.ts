export type TokenKeyEnv = {
  TOKEN_ENCRYPTION_KEYS: string;
  TOKEN_ACTIVE_KEY_ID: string;
  TOKEN_CONTEXT: string;
};

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value));
}

async function key(env: TokenKeyEnv, id: string): Promise<CryptoKey> {
  const keys: unknown = JSON.parse(env.TOKEN_ENCRYPTION_KEYS);
  if (!keys || typeof keys !== "object" || !Object.hasOwn(keys, id)) throw new Error("TOKEN_KEY_MISSING");
  const encoded = (keys as Record<string, unknown>)[id];
  if (typeof encoded !== "string") throw new Error("TOKEN_KEY_INVALID");
  const raw = bytes(encoded);
  if (raw.byteLength !== 32) throw new Error("TOKEN_KEY_INVALID");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function aad(env: TokenKeyEnv, kind: "access" | "refresh", id: string): Uint8Array<ArrayBuffer> {
  if (!env.TOKEN_CONTEXT || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("TOKEN_CONTEXT_INVALID");
  return new TextEncoder().encode(JSON.stringify(["sleepless-oauth-v1", env.TOKEN_CONTEXT, kind, id]));
}

export async function encryptToken(env: TokenKeyEnv, kind: "access" | "refresh", plaintext: string): Promise<string> {
  if (!plaintext || plaintext.length > 16_384) throw new Error("TOKEN_VALUE_INVALID");
  const id = env.TOKEN_ACTIVE_KEY_ID;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(env, kind, id) },
    await key(env, id), new TextEncoder().encode(plaintext),
  );
  return JSON.stringify({ v: 1, kid: id, iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
}

export async function decryptToken(env: TokenKeyEnv, kind: "access" | "refresh", ciphertext: string): Promise<string> {
  const envelope = JSON.parse(ciphertext) as { v: unknown; kid: string; iv: string; data: string };
  if (envelope.v !== 1 || typeof envelope.kid !== "string") throw new Error("TOKEN_CIPHERTEXT_INVALID");
  const iv = bytes(envelope.iv);
  if (iv.byteLength !== 12) throw new Error("TOKEN_CIPHERTEXT_INVALID");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad(env, kind, envelope.kid) },
    await key(env, envelope.kid), bytes(envelope.data),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
