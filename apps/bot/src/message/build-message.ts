export function buildSleeplessMessage(jstHour: number, postCount: number): string {
  return `${jstHour}時。\n\nこの1時間で\n「眠れない」「寝れない」という投稿が\n${postCount.toLocaleString("ja-JP")}件ありました。\n\n今夜も、眠れないのはあなただけではありません。`;
}
