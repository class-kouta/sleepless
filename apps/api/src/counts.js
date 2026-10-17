import { displayPeriodFor, previousDailyPeriodForNight } from "./time.js";

const SELECT_FIELDS = `
  window_start_at, window_end_at, post_count, fetched_at, query_version, query_text
`;

export class CountsUnavailableError extends Error {
  constructor(code) {
    super(code);
    this.name = "CountsUnavailableError";
    this.code = code;
  }
}

function hourlyPayload(row, isFallback) {
  return {
    kind: "hourly",
    isFallback,
    windowStartAt: row.window_start_at,
    windowEndAt: row.window_end_at,
    fetchedAt: row.fetched_at,
    postCount: row.post_count,
    queryVersion: row.query_version,
  };
}

function validateCountRow(row) {
  return row
    && Number.isInteger(row.post_count)
    && row.post_count >= 0
    && !Number.isNaN(Date.parse(row.window_start_at))
    && !Number.isNaN(Date.parse(row.window_end_at))
    && !Number.isNaN(Date.parse(row.fetched_at));
}

async function loadHourlyCount(db, period, now) {
  const current = await db.prepare(
    `SELECT ${SELECT_FIELDS}
       FROM sleepless_counts
      WHERE window_end_at >= ? AND window_end_at <= ?
      ORDER BY window_end_at DESC
      LIMIT 1`,
  ).bind(period.nightStartAt, now.toISOString()).first();

  if (validateCountRow(current)) {
    return hourlyPayload(current, false);
  }

  return loadDailyCount(db, previousDailyPeriodForNight(period.nightStartAt), true);
}

function validateDailyRows(rows, period) {
  if (rows.length !== 8) throw new CountsUnavailableError("DAILY_COUNTS_INCOMPLETE");

  const first = rows[0];
  const queryVersion = first.query_version;
  const queryText = first.query_text;
  const startMs = Date.parse(period.startAt);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const expectedStart = new Date(startMs + index * 60 * 60 * 1000).toISOString();
    const expectedEnd = new Date(startMs + (index + 1) * 60 * 60 * 1000).toISOString();
    if (!validateCountRow(row)
      || row.window_start_at !== expectedStart
      || row.window_end_at !== expectedEnd
      || row.query_version !== queryVersion
      || row.query_text !== queryText) {
      throw new CountsUnavailableError("DAILY_COUNTS_INCONSISTENT");
    }
  }

  return {
    kind: "daily",
    isFallback: false,
    windowStartAt: period.startAt,
    windowEndAt: period.endAt,
    fetchedAt: rows.at(-1).fetched_at,
    postCount: rows.reduce((total, row) => total + row.post_count, 0),
    queryVersion,
  };
}

async function loadDailyCount(db, period, isFallback = false) {
  const result = await db.prepare(
    `SELECT ${SELECT_FIELDS}
       FROM sleepless_counts
      WHERE window_start_at >= ? AND window_end_at <= ?
      ORDER BY window_start_at`,
  ).bind(period.startAt, period.endAt).all();
  return { ...validateDailyRows(result.results, period), isFallback };
}

export async function loadDisplayCount(db, now = new Date()) {
  const period = displayPeriodFor(now);
  if (period.kind === "hourly") return loadHourlyCount(db, period, now);
  return loadDailyCount(db, period);
}
