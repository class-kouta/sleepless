const JST_TIME_ZONE = "Asia/Tokyo";

function parts(timestamp) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp)).filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
}

export function formatCurrentTime(date = new Date()) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatJapaneseTime({ hour, minute }) {
  const formattedHour = `${Number(hour)}時`;
  return minute === "00" ? formattedHour : `${formattedHour}${Number(minute)}分`;
}

function formatJapaneseDate({ year, month, day }) {
  return `${year}年${Number(month)}月${Number(day)}日`;
}

export function formatCountPeriod(startAt, endAt) {
  const start = parts(startAt);
  const end = parts(endAt);
  const startDate = formatJapaneseDate(start);
  const endDate = formatJapaneseDate(end);
  const startTime = formatJapaneseTime(start);
  const endTime = formatJapaneseTime(end);

  if (startDate === endDate) {
    return `${startDate}\n${startTime}から${endTime}の間`;
  }

  return `${startDate}${startTime}から\n${endDate}${endTime}の間`;
}
