import { XApiError } from "./post.js";

const X_RECENT_COUNTS_URL = "https://api.x.com/2/tweets/counts/recent";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const INITIAL_RETRY_DELAY_MS = 250;

export const SLEEPLESS_QUERY = '"眠れない" OR "寝れない" lang:ja';
export const SLEEPLESS_QUERY_VERSION = "1";

type CountsEnv = {
  X_BEARER_TOKEN: string;
};

export class XCountsApiError extends XApiError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "XCountsApiError";
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof XApiError && (error.status === undefined || error.status === 429 || error.status >= 500);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestCount(env: CountsEnv, startAt: string, endAt: string): Promise<number> {
  if (!env.X_BEARER_TOKEN) throw new XCountsApiError("X_BEARER_TOKEN is not configured");

  const url = new URL(X_RECENT_COUNTS_URL);
  url.searchParams.set("query", SLEEPLESS_QUERY);
  url.searchParams.set("start_time", startAt);
  url.searchParams.set("end_time", endAt);
  url.searchParams.set("granularity", "hour");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new XCountsApiError("X Counts API request timed out after 15 seconds");
    }
    throw new XCountsApiError("X Counts API request failed before a response was received");
  }

  if (!response.ok) throw new XCountsApiError("X Counts API returned an error", response.status);

  const body = (await response.json()) as { meta?: { total_tweet_count?: unknown } };
  if (typeof body.meta?.total_tweet_count !== "number" || !Number.isInteger(body.meta.total_tweet_count)
    || body.meta.total_tweet_count < 0) {
    throw new XCountsApiError("X Counts API returned an invalid total count", response.status);
  }
  return body.meta.total_tweet_count;
}

/** Gets the count for the exact scheduled window, retrying transient failures only. */
export async function recentSleeplessPostCount(env: CountsEnv, startAt: string, endAt: string): Promise<number> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestCount(env, startAt, endAt);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) throw error;
      await wait(INITIAL_RETRY_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
