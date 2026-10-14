import type { PostingWindow } from "./runs.js";

export type CountSnapshot = {
  startAt: string;
  endAt: string;
  postCount: number;
};

export class CountSnapshotsError extends Error {
  readonly code = "COUNT_SNAPSHOTS_INCOMPLETE";

  constructor(message: string) {
    super(message);
    this.name = "CountSnapshotsError";
  }
}

export async function saveCountSnapshot(
  db: D1Database,
  window: PostingWindow,
  queryVersion: string,
  queryText: string,
  postCount: number,
  now: Date,
): Promise<void> {
  const result = await db.prepare(
    `INSERT INTO sleepless_counts (
      window_end_at, window_start_at, query_version, query_text, post_count, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(window.endAt, window.startAt, queryVersion, queryText, postCount, now.toISOString()).run();
  if (result.meta.changes !== 1) throw new Error("Could not save count snapshot");
}

export async function loadCountSnapshots(
  db: D1Database,
  window: PostingWindow,
  queryVersion: string,
  queryText: string,
): Promise<CountSnapshot[]> {
  const rows = await db.prepare(
    `SELECT window_start_at, window_end_at, post_count, query_version, query_text
       FROM sleepless_counts
      WHERE window_start_at >= ? AND window_end_at <= ?
      ORDER BY window_start_at`,
  ).bind(window.startAt, window.endAt).all<{
    window_start_at: string;
    window_end_at: string;
    post_count: number;
    query_version: string;
    query_text: string;
  }>();

  if (rows.results.length !== 8) {
    throw new CountSnapshotsError("Eight hourly count snapshots are required for the daily summary");
  }
  const expectedStart = Date.parse(window.startAt);
  for (let index = 0; index < rows.results.length; index += 1) {
    const row = rows.results[index];
    const startAt = new Date(expectedStart + index * 60 * 60 * 1000).toISOString();
    const endAt = new Date(expectedStart + (index + 1) * 60 * 60 * 1000).toISOString();
    if (row.window_start_at !== startAt || row.window_end_at !== endAt
      || row.query_version !== queryVersion || row.query_text !== queryText
      || !Number.isInteger(row.post_count) || row.post_count < 0) {
      throw new CountSnapshotsError("Hourly count snapshots are inconsistent or non-contiguous");
    }
  }
  return rows.results.map((row) => ({
    startAt: row.window_start_at,
    endAt: row.window_end_at,
    postCount: row.post_count,
  }));
}

export async function recordSnapshotPost(
  db: D1Database,
  windowEndAt: string,
  postId: string,
): Promise<void> {
  const result = await db.prepare(
    "UPDATE sleepless_counts SET x_post_id = ? WHERE window_end_at = ? AND x_post_id IS NULL",
  ).bind(postId, windowEndAt).run();
  if (result.meta.changes !== 1) throw new Error("Could not record snapshot post ID");
}
