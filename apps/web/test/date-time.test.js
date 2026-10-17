import assert from "node:assert/strict";
import test from "node:test";
import { formatPeriod, formatUpdatedAt } from "../public/scripts/lib/date-time.js";

test("formats an hourly period in JST", () => {
  assert.equal(
    formatPeriod("2026-10-16T20:00:00.000Z", "2026-10-16T21:00:00.000Z", false),
    "05:00–06:00 JST",
  );
  assert.equal(formatUpdatedAt("2026-10-16T21:01:01.000Z"), "06:01 JST");
});

test("includes dates for an overnight daily period", () => {
  assert.equal(
    formatPeriod("2026-10-16T13:00:00.000Z", "2026-10-16T21:00:00.000Z", true),
    "10/16 22:00–10/17 06:00 JST",
  );
});
