import assert from "node:assert/strict";
import test from "node:test";
import { displayPeriodFor, previousDailyPeriodForNight } from "../src/time.js";

test("uses the current night from 22:00 through 06:59 JST", () => {
  assert.deepEqual(displayPeriodFor(new Date("2026-10-16T13:00:00.000Z")), {
    kind: "hourly",
    nightStartAt: "2026-10-16T13:00:00.000Z",
  });
  assert.deepEqual(displayPeriodFor(new Date("2026-10-16T21:59:59.000Z")), {
    kind: "hourly",
    nightStartAt: "2026-10-16T13:00:00.000Z",
  });
});

test("uses the previous 22:00-06:00 window from 07:00 through 21:59 JST", () => {
  assert.deepEqual(displayPeriodFor(new Date("2026-10-16T22:00:00.000Z")), {
    kind: "daily",
    startAt: "2026-10-16T13:00:00.000Z",
    endAt: "2026-10-16T21:00:00.000Z",
  });
  assert.deepEqual(displayPeriodFor(new Date("2026-10-17T12:59:59.000Z")), {
    kind: "daily",
    startAt: "2026-10-16T13:00:00.000Z",
    endAt: "2026-10-16T21:00:00.000Z",
  });
});

test("finds the previous complete night for the 22:00 fallback", () => {
  assert.deepEqual(previousDailyPeriodForNight("2026-10-17T13:00:00.000Z"), {
    kind: "daily",
    startAt: "2026-10-16T13:00:00.000Z",
    endAt: "2026-10-16T21:00:00.000Z",
  });
});
