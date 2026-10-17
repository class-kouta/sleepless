import assert from "node:assert/strict";
import test from "node:test";

const elements = new Map();
const requestedSelectors = [];

globalThis.document = {
  querySelector(selector) {
    requestedSelectors.push(selector);
    const element = { hidden: true, textContent: "" };
    elements.set(selector, element);
    return element;
  },
};

const { renderCount } = await import("../public/scripts/views/counts.js");

test("renders the count window as the heading without separate target metadata", () => {
  renderCount({
    kind: "hourly",
    isFallback: false,
    postCount: 1284,
    windowStartAt: "2026-10-17T12:00:00.000Z",
    windowEndAt: "2026-10-17T13:00:00.000Z",
  });

  assert.equal(
    elements.get("#count-label").textContent,
    "2026年10月17日\n21時から22時の間\n「眠れない」という投稿が",
  );
  assert.equal(elements.get("#count-value").textContent, "1,284");
  assert.equal(elements.get("#count-suffix").hidden, false);
  assert.equal(requestedSelectors.includes("#count-meta"), false);
});
