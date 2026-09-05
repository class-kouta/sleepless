import { Client, OAuth1 } from "@xdevplatform/xdk";

const X_API_BASE_URL = "https://api.x.com";

type OAuthCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export class XApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new XApiError(`Required environment variable is missing: ${name}`);
  }

  return value;
}

function oauthCredentials(): OAuthCredentials {
  return {
    apiKey: requiredEnvironment("X_API_KEY"),
    apiSecret: requiredEnvironment("X_API_SECRET"),
    accessToken: requiredEnvironment("X_ACCESS_TOKEN"),
    accessTokenSecret: requiredEnvironment("X_ACCESS_TOKEN_SECRET"),
  };
}

function oauthClient(): Client {
  const credentials = oauthCredentials();
  return new Client({
    oauth1: new OAuth1({
      ...credentials,
      callback: "http://localhost:3000/callback",
    }),
    timeout: 15_000,
  });
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null) {
      const record = body as { detail?: unknown; title?: unknown; errors?: Array<{ detail?: unknown; title?: unknown }> };
      const error = record.errors?.[0];
      const detail = error?.detail ?? error?.title ?? record.detail ?? record.title;
      if (typeof detail === "string") return detail;
    }
  } catch {
    // Keep the status-based error below if the response is not JSON.
  }

  return response.statusText || "Unknown X API error";
}

async function xFetch(url: URL, init: RequestInit, authorization: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: authorization },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new XApiError("X API request timed out after 15 seconds");
    }

    throw new XApiError("X API request failed before a response was received");
  }

  if (!response.ok) {
    throw new XApiError(await errorMessage(response), response.status);
  }

  return response;
}

export async function createTestPost(): Promise<{ id: string; text: string }> {
  const oauth2AccessToken = process.env.X_USER_ACCESS_TOKEN;
  if (oauth2AccessToken) {
    const url = new URL("/2/tweets", X_API_BASE_URL);
    const response = await xFetch(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Sleepless Bot テスト投稿" }),
      },
      `Bearer ${oauth2AccessToken}`,
    );
    const body = (await response.json()) as { data?: { id?: string; text?: string } };
    if (!body.data?.id || !body.data.text) {
      throw new XApiError("X API returned a successful response without post data", response.status);
    }
    return { id: body.data.id, text: body.data.text };
  }

  try {
    const body = await oauthClient().posts.create({ text: "Sleepless Bot テスト投稿" });
    if (!body.data?.id || !body.data.text) {
      throw new XApiError("X API returned a successful response without post data");
    }

    return { id: body.data.id, text: body.data.text };
  } catch (error) {
    if (error instanceof XApiError) throw error;

    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined;
    const message = error instanceof Error ? error.message : "X API post request failed";
    throw new XApiError(message, status);
  }
}

export async function recentPostCounts(query: string): Promise<number> {
  const bearerToken = requiredEnvironment("X_BEARER_TOKEN");
  const url = new URL("/2/tweets/counts/recent", X_API_BASE_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("granularity", "hour");

  const response = await xFetch(url, { method: "GET" }, `Bearer ${bearerToken}`);
  const body = (await response.json()) as { meta?: { total_tweet_count?: number } };
  if (typeof body.meta?.total_tweet_count !== "number") {
    throw new XApiError("X API returned a successful response without a total count", response.status);
  }

  return body.meta.total_tweet_count;
}
