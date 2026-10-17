const JST_TIME_ZONE = "Asia/Tokyo";

function parts(timestamp) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: JST_TIME_ZONE,
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

export function formatPeriod(startAt, endAt, includeDate) {
  const start = parts(startAt);
  const end = parts(endAt);
  const startTime = `${start.hour}:${start.minute}`;
  const endTime = `${end.hour}:${end.minute}`;
  if (!includeDate) return `${startTime}–${endTime} JST`;
  return `${start.month}/${start.day} ${startTime}–${end.month}/${end.day} ${endTime} JST`;
}
