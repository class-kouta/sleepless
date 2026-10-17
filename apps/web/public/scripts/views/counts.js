import { formatCountPeriod } from "../lib/date-time.js";
import { companionMessage, fallbackMessage } from "../lib/display-copy.js";

const elements = {
  label: document.querySelector("#count-label"),
  value: document.querySelector("#count-value"),
  suffix: document.querySelector("#count-suffix"),
  message: document.querySelector("#companion-message"),
  status: document.querySelector("#count-status"),
};

export function renderCount(data) {
  elements.label.textContent = `${formatCountPeriod(data.windowStartAt, data.windowEndAt)}\n「眠れない」という投稿が`;
  elements.value.textContent = data.postCount.toLocaleString("ja-JP");
  elements.suffix.hidden = false;
  elements.message.textContent = companionMessage(data.kind);
  elements.status.textContent = fallbackMessage(data.isFallback);
}

export function renderCountError() {
  elements.label.textContent = "最新の集計データを\n取得できませんでした";
  elements.value.textContent = "—";
  elements.suffix.hidden = true;
  elements.message.textContent = "眠れない時間を過ごしているのは\nあなただけではありません。";
  elements.status.textContent = "しばらくしてから、もう一度お試しください。";
}
