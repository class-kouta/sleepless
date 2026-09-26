function formatJstDateTime(windowEndAt: string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date(windowEndAt));
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return `${values.get("year")}年${values.get("month")}月${values.get("day")}日 ${values.get("hour")}時`;
}

export function buildSleeplessMessage(windowEndAt: string, postCount: number): string {
  return `${formatJstDateTime(windowEndAt)}\n\n直近1時間に、\n\n「眠れない」「ねむれない」\n「眠れぬ」「ねむれぬ」\n「眠れん」「ねむれん」\n「寝れない」「ねれない」\n「寝れぬ」「ねれぬ」\n「寝れん」「ねれん」\n\nという投稿が、合わせて\n\n${postCount.toLocaleString("ja-JP")}件\n\nありました。\n\n今この瞬間、眠れずにいるのはあなただけではないようです。`;
}
