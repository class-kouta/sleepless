import { CountsUnavailableError, loadDisplayCount } from "./counts.js";

const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/counts/latest") return json({ error: "NOT_FOUND" }, 404);
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
        status: 405,
        headers: { ...JSON_HEADERS, Allow: "GET" },
      });
    }

    try {
      return json(await loadDisplayCount(env.BOT_DB));
    } catch (error) {
      const code = error instanceof CountsUnavailableError ? error.code : "UNEXPECTED_ERROR";
      console.error(JSON.stringify({ event: "counts_api_failed", code }));
      return json({ error: code }, error instanceof CountsUnavailableError ? 503 : 500);
    }
  },
};
