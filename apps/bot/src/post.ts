import { createTestPost, XApiError } from "./x.js";

try {
  const post = await createTestPost();
  console.log(`Posted test message successfully (post ID: ${post.id}).`);
} catch (error) {
  if (error instanceof XApiError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    console.error(`Post failed${status}: ${error.message}`);
  } else {
    console.error("Post failed: unexpected error");
  }
  process.exitCode = 1;
}
