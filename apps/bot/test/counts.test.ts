import assert from "node:assert/strict";
import { test } from "node:test";
import { SLEEPLESS_QUERY, SLEEPLESS_QUERY_VERSION } from "../src/x/counts.js";

test("combines all sleepless expressions into one Japanese post-count query", () => {
  assert.equal(SLEEPLESS_QUERY,
    '("眠れない" OR "ねむれない" OR "眠れぬ" OR "ねむれぬ" OR "眠れん" OR "ねむれん" OR "寝れない" OR "ねれない" OR "寝れぬ" OR "ねれぬ" OR "寝れん" OR "ねれん") lang:ja -is:retweet');
  assert.equal(SLEEPLESS_QUERY_VERSION, "2");
});
