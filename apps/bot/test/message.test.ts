import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSleeplessMessage } from "../src/message/build-message.js";

test("builds the requested Japanese post layout", () => {
  assert.equal(buildSleeplessMessage("2026-09-09T21:00:00.000Z", 613),
    "2026年9月10日 6時\n\n直近1時間に、\n\n「眠れない」「ねむれない」\n「眠れぬ」「ねむれぬ」\n「眠れん」「ねむれん」\n「寝れない」「ねれない」\n「寝れぬ」「ねれぬ」\n「寝れん」「ねれん」\n\nという投稿が、合わせて\n\n613件\n\nありました。\n\n今この瞬間、眠れずにいるのはあなただけではないようです。");
});
