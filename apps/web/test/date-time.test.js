import assert from "node:assert/strict";
import test from "node:test";
import { formatCountPeriod } from "../public/scripts/lib/date-time.js";

test("formats an hourly period as Japanese copy in JST", () => {
  assert.equal(
    formatCountPeriod("2026-10-17T12:00:00.000Z", "2026-10-17T13:00:00.000Z"),
    "2026年10月17日\n21時から22時の間",
  );
});

test("includes both dates for an overnight daily period", () => {
  assert.equal(
    formatCountPeriod("2026-10-16T13:00:00.000Z", "2026-10-16T21:00:00.000Z"),
    "2026年10月16日22時から\n2026年10月17日6時の間",
  );
});
