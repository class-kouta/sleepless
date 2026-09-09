import { assertTokenCurrent, getAccessToken, rejectAccessToken, TokenError } from "./tokens.js";
import { createPost, XApiError, type WorkerEnv } from "./x/post.js";

export async function createManagedPost(env: WorkerEnv, text: string): Promise<{ id: string }> {
  const token = await getAccessToken(env);
  await assertTokenCurrent(env, token);
  try {
    return await createPost({ X_USER_ACCESS_TOKEN: token.value }, text);
  } catch (error) {
    if (error instanceof XApiError && error.status === 401) {
      await rejectAccessToken(env, token);
      throw new TokenError("TOKEN_POST_401");
    }
    throw error;
  }
}
