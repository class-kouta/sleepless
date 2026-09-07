import type { PostingWindow } from "./runs.js";

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
