import assert from "node:assert/strict";
import test from "node:test";
import { loadDisplayCount } from "../src/counts.js";

function row(startAt, count, overrides = {}) {
  const start = new Date(startAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    window_start_at: start.toISOString(),
    window_end_at: end.toISOString(),
    post_count: count,
    fetched_at: new Date(end.getTime() + 60_000).toISOString(),
    query_version: "3",
    query_text: "query-v3",
    ...overrides,
  };
}

function dbWithResults(results) {
  let index = 0;
  return {
    prepare() {
      const value = results[index++];
      return {
        bind() {
          return {
            first: async () => value,
            all: async () => ({ results: value }),
          };
        },
      };
    },
  };
}

test("uses the latest count from the current night", async () => {
  const latest = row("2026-10-16T13:00:00.000Z", 811);
  const result = await loadDisplayCount(dbWithResults([latest]), new Date("2026-10-16T13:01:00.000Z"));
  assert.equal(result.kind, "hourly");
  assert.equal(result.isFallback, false);
  assert.equal(result.postCount, 811);
});

test("falls back to the previous nightly total when 22:00 data is not ready", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => (
    row(new Date(Date.parse("2026-10-15T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(), index + 1)
  ));
  const result = await loadDisplayCount(dbWithResults([null, rows]), new Date("2026-10-16T13:00:05.000Z"));
  assert.equal(result.kind, "daily");
  assert.equal(result.isFallback, true);
  assert.equal(result.postCount, 36);
});

test("keeps the latest current-night hour when a newer hour is missing", async () => {
  const latest = row("2026-10-16T12:00:00.000Z", 655);
  const result = await loadDisplayCount(dbWithResults([latest]), new Date("2026-10-16T14:05:00.000Z"));
  assert.equal(result.kind, "hourly");
  assert.equal(result.isFallback, false);
  assert.equal(result.postCount, 655);
});

test("sums exactly eight consistent rows for the daytime display", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => (
    row(new Date(Date.parse("2026-10-16T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(), index + 1)
  ));
  const result = await loadDisplayCount(dbWithResults([rows]), new Date("2026-10-17T04:00:00.000Z"));
  assert.equal(result.kind, "daily");
  assert.equal(result.postCount, 36);
  assert.equal(result.windowStartAt, "2026-10-16T13:00:00.000Z");
  assert.equal(result.windowEndAt, "2026-10-16T21:00:00.000Z");
});

test("rejects an incomplete daily window", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => (
    row(new Date(Date.parse("2026-10-16T13:00:00.000Z") + index * 60 * 60 * 1000).toISOString(), 1)
  ));
  await assert.rejects(
    loadDisplayCount(dbWithResults([rows]), new Date("2026-10-17T04:00:00.000Z")),
    { code: "DAILY_COUNTS_INCOMPLETE" },
  );
});
