const JST_TIME_ZONE = "Asia/Tokyo";
const COUNTS_READY_DELAY_MS = 15_000;

export type PostingWindow = {
  startAt: string;
  endAt: string;
  jstHour: number;
};

function jstParts(date: Date): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: JST_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/** Returns the scheduled, UTC-aligned one-hour window ending at `scheduledTime`. */
export function postingWindowFor(scheduledTime: number): PostingWindow {
  const scheduled = new Date(scheduledTime);
  scheduled.setUTCMinutes(0, 0, 0);
  const start = new Date(scheduled.getTime() - 60 * 60 * 1000);
  const hour = Number(jstParts(scheduled).hour);
  if (!Number.isInteger(hour)) throw new Error("Could not determine JST hour");

  return {
    startAt: start.toISOString(),
    endAt: scheduled.toISOString(),
    jstHour: hour,
  };
}

export function isPostingHour(jstHour: number): boolean {
  return jstHour >= 22 || jstHour <= 6;
}

/** Wait until the scheduled hour is at least 15 seconds old before querying X. */
export function countsReadyDelayMs(scheduledTime: number, now = Date.now()): number {
  return Math.max(0, scheduledTime + COUNTS_READY_DELAY_MS - now);
}

export function isDailySummaryHour(jstHour: number): boolean {
  return jstHour === 7;
}

/** Returns the previous night's JST 22:00-06:00 count range for the 07:00 summary. */
export function dailySummaryWindowFor(scheduledTime: number): PostingWindow {
  const executionWindow = postingWindowFor(scheduledTime);
  const end = new Date(Date.parse(executionWindow.endAt) - 60 * 60 * 1000);
  const start = new Date(end.getTime() - 8 * 60 * 60 * 1000);
  return { startAt: start.toISOString(), endAt: end.toISOString(), jstHour: executionWindow.jstHour };
}

export function fixedMessage(jstHour: number): string {
  return `${jstHour}時。\n\nまだ眠れない夜を過ごしている人へ。\n\n今夜も、起きているのはあなただけではありません。`;
}
