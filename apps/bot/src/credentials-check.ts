const names = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "X_BEARER_TOKEN",
  "X_CLIENT_ID",
  "X_CLIENT_SECRET",
  "X_OAUTH2_REDIRECT_URI",
] as const;

for (const name of names) {
  const value = process.env[name] ?? "";
  const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  console.log(`${name}: ${value ? "set" : "missing"}; surrounding-whitespace=${value !== value.trim()}; quoted=${isQuoted}`);
}
