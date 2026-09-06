const X_POST_URL = "https://api.x.com/2/tweets";
const REQUEST_TIMEOUT_MS = 15_000;

export type WorkerEnv = {
  X_USER_ACCESS_TOKEN: string;
  TEST_POST_SECRET: string;
};

export class XApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "XApiError";
  }
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      detail?: unknown;
      title?: unknown;
      errors?: Array<{ detail?: unknown; title?: unknown }>;
    };
    const error = body.errors?.[0];
    const message = error?.detail ?? error?.title ?? body.detail ?? body.title;
    if (typeof message === "string") return message;
  } catch {
    // Use the status text if X did not return a JSON error body.
  }
  return response.statusText || "Unknown X API error";
}

export async function createFixedTestPost(env: Pick<WorkerEnv, "X_USER_ACCESS_TOKEN">): Promise<{ id: string }> {
  if (!env.X_USER_ACCESS_TOKEN) throw new XApiError("X_USER_ACCESS_TOKEN is not configured");

  let response: Response;
  try {
    response = await fetch(X_POST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.X_USER_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "Sleepless Bot テスト投稿" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new XApiError("X API request timed out after 15 seconds");
    }
    throw new XApiError("X API request failed before a response was received");
  }

  if (!response.ok) throw new XApiError(await responseMessage(response), response.status);

  const body = (await response.json()) as { data?: { id?: unknown } };
  if (typeof body.data?.id !== "string") {
    throw new XApiError("X API returned a successful response without a post ID", response.status);
  }
  return { id: body.data.id };
}
