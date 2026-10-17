import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { countsReadyDelayMs } from "../src/time.js";
import { recentSleeplessPostCount, SLEEPLESS_QUERY, SLEEPLESS_QUERY_VERSION } from "../src/x/counts.js";

test("combines all sleepless expressions into one Japanese post-count query", () => {
  assert.equal(SLEEPLESS_QUERY,
    '("眠れない" OR "ねむれない" OR "眠れぬ" OR "ねむれぬ" OR "眠れん" OR "ねむれん" OR "寝れない" OR "ねれない" OR "寝れぬ" OR "ねれぬ" OR "寝れん" OR "ねれん" OR "寝れね" OR "ねれね" OR "寝られない" OR "ねられない" OR "寝られぬ" OR "ねられぬ" OR "寝られん" OR "ねられん") lang:ja -is:retweet');
  assert.equal(SLEEPLESS_QUERY_VERSION, "3");
});

function mockFetch(t: TestContext, implementation: typeof fetch) {
  return t.mock.method(globalThis, "fetch", implementation);
}

test("waits until 15 seconds after the scheduled hour before requesting counts", () => {
  const scheduled = Date.parse("2026-10-14T13:00:00.000Z");
  assert.equal(countsReadyDelayMs(scheduled, scheduled + 8_000), 7_000);
  assert.equal(countsReadyDelayMs(scheduled, scheduled + 15_000), 0);
  assert.equal(countsReadyDelayMs(scheduled, scheduled + 20_000), 0);
});

test("retries HTTP 400 up to three times and then succeeds", async (t) => {
  let attempts = 0;
  const request = mockFetch(t, async () => {
    attempts += 1;
    if (attempts <= 3) return Response.json({ title: "Invalid Request" }, { status: 400 });
    return Response.json({ meta: { total_tweet_count: 42 } });
  });

  const count = await recentSleeplessPostCount(
    { X_BEARER_TOKEN: "counts-only" },
    "2026-10-14T12:00:00.000Z",
    "2026-10-14T13:00:00.000Z",
  );
  assert.equal(count, 42);
  assert.equal(request.mock.callCount(), 4);
});

test("does not retry non-retryable HTTP 403", async (t) => {
  const request = mockFetch(t, async () => new Response("Forbidden", { status: 403 }));
  await assert.rejects(recentSleeplessPostCount(
    { X_BEARER_TOKEN: "counts-only" },
    "2026-10-14T12:00:00.000Z",
    "2026-10-14T13:00:00.000Z",
  ));
  assert.equal(request.mock.callCount(), 1);
});
