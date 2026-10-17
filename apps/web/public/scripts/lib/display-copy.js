export function companionMessage(kind) {
  if (kind === "daily") {
    return "眠れない夜を過ごしていたのは、\nあなただけではありません。";
  }
  return "今この瞬間、眠れずにいるのは\nあなただけではないようです。";
}

export function fallbackMessage(isFallback) {
  return isFallback
    ? "今夜の集計はまだ届いていません。前夜の合計値を表示しています。"
    : "";
}
