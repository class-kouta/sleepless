import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSleeplessMessage } from "../src/message/build-message.js";

test("builds the requested Japanese post layout", () => {
  assert.equal(buildSleeplessMessage("2026-09-09T21:00:00.000Z", 613),
    "2026年9月10日 6時\n直近1時間で、\n「眠れない」「寝れない」という投稿が\n613件ありました。\nあなた以外にも、眠れない人はたくさんいます。");
});
