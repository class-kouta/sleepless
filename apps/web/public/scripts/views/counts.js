import { formatPeriod } from "../lib/date-time.js";
import { companionMessage, fallbackMessage } from "../lib/display-copy.js";

const elements = {
  label: document.querySelector("#count-label"),
  value: document.querySelector("#count-value"),
  suffix: document.querySelector("#count-suffix"),
  message: document.querySelector("#companion-message"),
  status: document.querySelector("#count-status"),
  meta: document.querySelector("#count-meta"),
};

export function renderCount(data) {
  const daily = data.kind === "daily";
  elements.label.textContent = daily
    ? "昨夜22時から今朝6時までに\n「眠れない」という投稿が"
    : data.isFallback
      ? "前回の1時間で\n「眠れない」という投稿が"
      : "この1時間で\n「眠れない」という投稿が";
  elements.value.textContent = data.postCount.toLocaleString("ja-JP");
  elements.suffix.hidden = false;
  elements.message.textContent = companionMessage(data.kind);
  elements.status.textContent = fallbackMessage(data.isFallback);
  elements.meta.textContent = `対象: ${formatPeriod(data.windowStartAt, data.windowEndAt, daily || data.isFallback)}`;
}

export function renderCountError() {
  elements.label.textContent = "最新の集計データを\n取得できませんでした";
  elements.value.textContent = "—";
  elements.suffix.hidden = true;
  elements.message.textContent = "眠れない時間を過ごしているのは\nあなただけではありません。";
  elements.status.textContent = "しばらくしてから、もう一度お試しください。";
  elements.meta.textContent = "";
}
