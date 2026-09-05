import { recentPostCounts, XApiError } from "./x.js";

const query = "眠れない lang:ja -is:retweet";

try {
  const count = await recentPostCounts(query);
  console.log(`Recent Post Counts succeeded: ${count} posts for query "${query}".`);
} catch (error) {
  if (error instanceof XApiError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    console.error(`Recent Post Counts failed${status}: ${error.message}`);
  } else {
    console.error("Recent Post Counts failed: unexpected error");
  }
  process.exitCode = 1;
}
