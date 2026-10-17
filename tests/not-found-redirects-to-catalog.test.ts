import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const notFoundPage = fs.readFileSync("apps/web/app/not-found.tsx", "utf8");

test("every missing public page permanently redirects to the live catalog", () => {
  assert.match(notFoundPage, /import\s*\{\s*permanentRedirect\s*\}\s*from\s*["']next\/navigation["']/);
  assert.match(notFoundPage, /permanentRedirect\(["']\/cars["']\)/);
  assert.doesNotMatch(notFoundPage, /<h[1-6][^>]*>[^<]*404/i);
});
