import { createFixedTestPost, type WorkerEnv, XApiError } from "./x/post.js";

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function secretsMatch(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let index = 0; index < leftHash.length; index += 1) difference |= leftHash[index] ^ rightHash[index];
  return difference === 0;
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/test-post") return new Response("Not Found", { status: 404 });
    if (request.method !== "POST") return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });

    const authorization = request.headers.get("Authorization");
    const suppliedSecret = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!suppliedSecret || !env.TEST_POST_SECRET || !(await secretsMatch(suppliedSecret, env.TEST_POST_SECRET))) {
      return unauthorized();
    }

    try {
      const post = await createFixedTestPost(env);
      console.log(JSON.stringify({ event: "test_post_succeeded", postId: post.id }));
      return Response.json({ id: post.id }, { status: 201 });
    } catch (error) {
      const status = error instanceof XApiError ? error.status : undefined;
      console.error(JSON.stringify({ event: "test_post_failed", xStatus: status ?? null }));
      return Response.json({ error: "Posting to X failed" }, { status: 502 });
    }
  },
} satisfies ExportedHandler<WorkerEnv>;
