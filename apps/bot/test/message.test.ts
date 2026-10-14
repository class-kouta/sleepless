import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDailySleeplessMessage, buildSleeplessMessage } from "../src/message/build-message.js";
import { dailySummaryWindowFor, isDailySummaryHour } from "../src/time.js";

const counts = [12, 23, 34, 45, 56, 67, 78, 89].map((postCount, index) => ({
  startAt: new Date(Date.parse("2026-09-25T13:00:00.000Z") + index * 3_600_000).toISOString(),
  endAt: new Date(Date.parse("2026-09-25T14:00:00.000Z") + index * 3_600_000).toISOString(),
  postCount,
}));

test("keeps the existing hourly Japanese post layout", () => {
  assert.equal(buildSleeplessMessage("2026-09-09T21:00:00.000Z", 613),
    "2026年9月10日 6時\n\n直近1時間に、\n\n「眠れない」「ねむれない」\n「眠れぬ」「ねむれぬ」\n「眠れん」「ねむれん」\n「寝れない」「ねれない」\n「寝れぬ」「ねれぬ」\n「寝れん」「ねれん」\n\nという投稿が、合わせて\n\n613件\n\nありました。\n\n今この瞬間、眠れずにいるのはあなただけではないようです。");
});

test("builds the requested daily Japanese post as one long post", () => {
  assert.equal(buildDailySleeplessMessage("2026-09-25T13:00:00.000Z", "2026-09-25T21:00:00.000Z", counts),
    "9月25日22:00〜9月26日6:00に、\nXでは「眠れない」を含む投稿が合計\n\n404件\n\nありました。\n眠れない夜を過ごしていたのは、あなただけではありません。\n\n\n時間帯別の内訳です。\n\n22:00〜23:00：12件\n23:00〜00:00：23件\n00:00〜01:00：34件\n01:00〜02:00：45件\n02:00〜03:00：56件\n03:00〜04:00：67件\n04:00〜05:00：78件\n05:00〜06:00：89件");
});

test("the 07:00 JST run targets the previous 22:00 through current 06:00", () => {
  assert.deepEqual(dailySummaryWindowFor(Date.parse("2026-09-25T22:00:00.000Z")), {
    startAt: "2026-09-25T13:00:00.000Z",
    endAt: "2026-09-25T21:00:00.000Z",
    jstHour: 7,
  });
  assert.equal(isDailySummaryHour(7), true);
  assert.equal(isDailySummaryHour(6), false);
});
