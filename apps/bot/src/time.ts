const JST_TIME_ZONE = "Asia/Tokyo";

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

export function fixedMessage(jstHour: number): string {
  return `${jstHour}時。\n\nまだ眠れない夜を過ごしている人へ。\n\n今夜も、起きているのはあなただけではありません。`;
}
