const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;

function jstParts(now) {
  const shifted = new Date(now.getTime() + JST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    monthIndex: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

function jstTimeToUtc({ year, monthIndex, day }, hour) {
  return new Date(Date.UTC(year, monthIndex, day, hour) - JST_OFFSET_MS);
}

export function displayPeriodFor(now) {
  const parts = jstParts(now);
  if (parts.hour >= 22 || parts.hour < 7) {
    const dayOffset = parts.hour < 7 ? -1 : 0;
    const nightStart = jstTimeToUtc({ ...parts, day: parts.day + dayOffset }, 22);
    return { kind: "hourly", nightStartAt: nightStart.toISOString() };
  }

  const end = jstTimeToUtc(parts, 6);
  const start = new Date(end.getTime() - 8 * HOUR_MS);
  return { kind: "daily", startAt: start.toISOString(), endAt: end.toISOString() };
}

export function previousDailyPeriodForNight(nightStartAt) {
  const start = new Date(Date.parse(nightStartAt) - 24 * HOUR_MS);
  const end = new Date(start.getTime() + 8 * HOUR_MS);
  return { kind: "daily", startAt: start.toISOString(), endAt: end.toISOString() };
}
