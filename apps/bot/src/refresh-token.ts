import { refreshAccessToken, saveTokens } from "./oauth2.js";

try {
  await saveTokens(await refreshAccessToken());
  console.log("Access token refreshed successfully.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Token refresh failed.");
  process.exitCode = 1;
}
