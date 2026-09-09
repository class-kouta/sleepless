import { recordSnapshotPost, saveCountSnapshot } from "./count-snapshots.js";
import { buildSleeplessMessage } from "./message/build-message.js";
import { acquireRun, markFailed, markPosted } from "./runs.js";
import { isPostingHour, postingWindowFor } from "./time.js";
import { recentSleeplessPostCount, SLEEPLESS_QUERY, SLEEPLESS_QUERY_VERSION, XCountsApiError } from "./x/counts.js";
import { type WorkerEnv, XApiError } from "./x/post.js";
import { createManagedPost } from "./token-post.js";
import { reportTokenFailure, TokenError } from "./tokens.js";

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

function errorCode(error: unknown): string {
  if (error instanceof TokenError) return error.code;
  if (error instanceof XCountsApiError) return `X_COUNTS_${error.status ?? "REQUEST_FAILED"}`;
  if (error instanceof XApiError) return `X_API_${error.status ?? "REQUEST_FAILED"}`;
  return "UNEXPECTED_ERROR";
}

async function runScheduledPost(controller: ScheduledController, env: WorkerEnv): Promise<void> {
  const window = postingWindowFor(controller.scheduledTime);
  if (!isPostingHour(window.jstHour)) {
    console.log(JSON.stringify({ event: "cron_outside_posting_hours", windowEndAt: window.endAt }));
    return;
  }

  const acquired = await acquireRun(env.BOT_DB, window, new Date());
  if (acquired !== "acquired") {
    const log = { event: "cron_run_not_started", reason: acquired, windowEndAt: window.endAt };
    if (acquired === "lease_expired") console.error(JSON.stringify(log));
    else console.log(JSON.stringify(log));
    return;
  }

  try {
    const postCount = await recentSleeplessPostCount(env, window.startAt, window.endAt);
    await saveCountSnapshot(
      env.BOT_DB, window, SLEEPLESS_QUERY_VERSION, SLEEPLESS_QUERY, postCount, new Date(),
    );
    const post = await createManagedPost(env, buildSleeplessMessage(window.jstHour, postCount));
    try {
      await recordSnapshotPost(env.BOT_DB, window.endAt, post.id);
      await markPosted(env.BOT_DB, window.endAt, post.id, new Date());
    } catch (error) {
      // Never resend: X may have accepted the post although recording the result failed.
      console.error(JSON.stringify({ event: "x_post_sent_recording_failed", windowEndAt: window.endAt }));
      throw error;
    }
    console.log(JSON.stringify({ event: "cron_post_succeeded", windowEndAt: window.endAt, postId: post.id, postCount }));
  } catch (error) {
    try {
      await markFailed(env.BOT_DB, window.endAt, errorCode(error), new Date());
    } catch {
      // The existing processing lease prevents automatic retry until it is recorded as failed.
    }
    const status = error instanceof XApiError ? error.status : undefined;
    console.error(JSON.stringify({ event: "cron_post_failed", windowEndAt: window.endAt, xStatus: status ?? null, code: errorCode(error) }));
    if (error instanceof TokenError) await reportTokenFailure(env, error);
  }
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
      const post = await createManagedPost(env, "Sleepless Bot テスト投稿");
      console.log(JSON.stringify({ event: "test_post_succeeded", postId: post.id }));
      return Response.json({ id: post.id }, { status: 201 });
    } catch (error) {
      const status = error instanceof XApiError ? error.status : undefined;
      console.error(JSON.stringify({ event: "test_post_failed", xStatus: status ?? null, code: errorCode(error) }));
      if (error instanceof TokenError) await reportTokenFailure(env, error);
      return Response.json({ error: "Posting to X failed" }, { status: 502 });
    }
  },
  async scheduled(controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledPost(controller, env));
  },
} satisfies ExportedHandler<WorkerEnv>;
