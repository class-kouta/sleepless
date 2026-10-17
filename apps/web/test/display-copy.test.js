import assert from "node:assert/strict";
import test from "node:test";
import { companionMessage, fallbackMessage } from "../public/scripts/lib/display-copy.js";

test("uses present-tense copy for an hourly count", () => {
  assert.equal(
    companionMessage("hourly"),
    "今この瞬間、眠れずにいるのは\nあなただけではないようです。",
  );
});

test("uses past-tense copy for a daily count", () => {
  assert.equal(
    companionMessage("daily"),
    "眠れない夜を過ごしていたのは、\nあなただけではありません。",
  );
});

test("explains when the previous nightly total is shown", () => {
  assert.equal(
    fallbackMessage(true),
    "今夜の集計はまだ届いていません。前夜の合計値を表示しています。",
  );
  assert.equal(fallbackMessage(false), "");
});
