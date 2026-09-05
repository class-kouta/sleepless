import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { clientId, createCodeChallenge, createCodeVerifier, exchangeAuthorizationCode, redirectUri, saveTokens } from "./oauth2.js";

const state = randomBytes(32).toString("base64url");
const verifier = createCodeVerifier();
const redirect = new URL(redirectUri());

if (
  redirect.protocol !== "http:" ||
  redirect.hostname !== "127.0.0.1" ||
  redirect.port !== "3000" ||
  redirect.pathname !== "/callback"
) {
  throw new Error("X_OAUTH2_REDIRECT_URI must be http://127.0.0.1:3000/callback for this local command.");
}

const authorizationUrl = new URL("https://x.com/i/oauth2/authorize");
authorizationUrl.search = new URLSearchParams({
  response_type: "code",
  client_id: clientId(),
  redirect_uri: redirectUri(),
  scope: "tweet.read tweet.write users.read offline.access",
  state,
  code_challenge: createCodeChallenge(verifier),
  code_challenge_method: "S256",
}).toString();

const server = createServer(async (request, response) => {
  const callback = new URL(request.url ?? "/", redirectUri());
  if (callback.pathname !== redirect.pathname) {
    response.writeHead(404).end();
    return;
  }

  if (callback.searchParams.get("state") !== state || !callback.searchParams.get("code")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Authorization failed. Return to the terminal and try again.");
    server.close();
    return;
  }

  try {
    await saveTokens(await exchangeAuthorizationCode(callback.searchParams.get("code")!, verifier));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<h1>認可に成功しました。</h1><p>トークンをローカルの .env に保存しました。この画面は閉じて大丈夫です。</p>");
    console.log("Authorization succeeded. Tokens were saved to .env.");
  } catch (error) {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Token exchange failed. Check the terminal for the HTTP status.");
    console.error(error instanceof Error ? error.message : "Token exchange failed.");
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("Open this URL in a browser, sign in as the Bot account, and approve access:");
  console.log(authorizationUrl.toString());
});

setTimeout(() => {
  console.error("Authorization timed out after 10 minutes.");
  server.close();
  process.exitCode = 1;
}, 10 * 60_000).unref();
