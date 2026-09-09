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
  return `${formatJstDateTime(windowEndAt)}\n直近1時間で、\n「眠れない」「寝れない」という投稿が\n${postCount.toLocaleString("ja-JP")}件ありました。\nあなた以外にも、眠れない人はたくさんいます。`;
}
