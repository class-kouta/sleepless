import type { CountSnapshot } from "../count-snapshots.js";

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

function jstParts(timestamp: string): { month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = new Map(parts.map(({ type, value }) => [type, value]));
  return { month: Number(values.get("month")), day: Number(values.get("day")), hour: Number(values.get("hour")) };
}

function hourLabel(timestamp: string): string {
  return jstParts(timestamp).hour.toString().padStart(2, "0");
}

export function buildSleeplessMessage(windowEndAt: string, postCount: number): string {
  return `${formatJstDateTime(windowEndAt)}\n\n直近1時間に、\n\n「眠れない」「ねむれない」\n「眠れぬ」「ねむれぬ」\n「眠れん」「ねむれん」\n「寝れない」「ねれない」\n「寝れぬ」「ねれぬ」\n「寝れん」「ねれん」\n「寝れね」「ねれね」\n「寝られない」「ねられない」\n「寝られぬ」「ねられぬ」\n「寝られん」「ねられん」\n\nという投稿が、合わせて\n\n${postCount.toLocaleString("ja-JP")}件\n\nありました。\n\n今この瞬間、眠れずにいるのはあなただけではないようです。`;
}

export function buildDailySleeplessMessage(
  windowStartAt: string,
  windowEndAt: string,
  counts: CountSnapshot[],
): string {
  const start = jstParts(windowStartAt);
  const end = jstParts(windowEndAt);
  const total = counts.reduce((sum, count) => sum + count.postCount, 0);
  const breakdown = counts.map((count) => (
    `${hourLabel(count.startAt)}:00〜${hourLabel(count.endAt)}:00：${count.postCount.toLocaleString("ja-JP")}件`
  )).join("\n");
  return `${start.month}月${start.day}日${start.hour}:00〜${end.month}月${end.day}日${end.hour}:00に、\nXでは「眠れない」を含む投稿が合計\n\n${total.toLocaleString("ja-JP")}件\n\nありました。\n眠れない夜を過ごしていたのは、あなただけではありません。\n\n\n時間帯別の内訳です。\n\n${breakdown}`;
}
