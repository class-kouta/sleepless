export type PostingWindow = {
  startAt: string;
  endAt: string;
};

type BotRun = {
  status: "processing" | "posted" | "skipped" | "failed";
  lease_expires_at: string | null;
};

export type AcquireResult = "acquired" | "lease_expired" | "already_posted" | "already_processing" | "not_runnable";

const LEASE_DURATION_MS = 10 * 60 * 1000;

export async function acquireRun(
  db: D1Database,
  window: PostingWindow,
  now: Date,
): Promise<AcquireResult> {
  const nowAt = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_MS).toISOString();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO bot_runs (
      window_end_at, window_start_at, status, lease_expires_at, created_at, updated_at
    ) VALUES (?, ?, 'processing', ?, ?, ?)`,
  ).bind(window.endAt, window.startAt, leaseExpiresAt, nowAt, nowAt).run();

  if (inserted.meta.changes === 1) return "acquired";

  const existing = await db.prepare(
    "SELECT status, lease_expires_at FROM bot_runs WHERE window_end_at = ?",
  ).bind(window.endAt).first<BotRun>();
  if (!existing) throw new Error("bot_runs row disappeared after conflict");
  if (existing.status === "posted") return "already_posted";
  if (existing.status !== "processing") return "not_runnable";

  // Do not retry a run whose worker may have reached X but failed before recording it.
  if (!existing.lease_expires_at || existing.lease_expires_at > nowAt) return "already_processing";
  const expired = await db.prepare(
    `UPDATE bot_runs
       SET status = 'failed', error_code = 'PROCESSING_LEASE_EXPIRED', updated_at = ?
       WHERE window_end_at = ? AND status = 'processing' AND lease_expires_at <= ?`,
  ).bind(nowAt, window.endAt, nowAt).run();
  return expired.meta.changes === 1 ? "lease_expired" : "already_processing";
}

export async function markPosted(db: D1Database, windowEndAt: string, postId: string, now: Date): Promise<void> {
  const result = await db.prepare(
    `UPDATE bot_runs
       SET status = 'posted', x_post_id = ?, error_code = NULL, lease_expires_at = NULL, updated_at = ?
       WHERE window_end_at = ? AND status = 'processing'`,
  ).bind(postId, now.toISOString(), windowEndAt).run();
  if (result.meta.changes !== 1) throw new Error("Could not record successful X post");
}

export async function markFailed(db: D1Database, windowEndAt: string, errorCode: string, now: Date): Promise<void> {
  const result = await db.prepare(
    `UPDATE bot_runs
       SET status = 'failed', error_code = ?, lease_expires_at = NULL, updated_at = ?
       WHERE window_end_at = ? AND status = 'processing'`,
  ).bind(errorCode, now.toISOString(), windowEndAt).run();
  if (result.meta.changes !== 1) throw new Error("Could not record failed X post");
}
