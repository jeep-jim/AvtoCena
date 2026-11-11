import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const routeSource = readFileSync(
  path.join(repoRoot, "apps/web/app/(crm)/api/crm/settings/markets/route.ts"),
  "utf8",
);

test("market settings redirects stay on the browser's public origin", () => {
  assert.match(routeSource, /headers: \{ Location: path \}/);
  assert.doesNotMatch(routeSource, /new URL\("\/crm\/settings", request\.url\)/);
  assert.doesNotMatch(routeSource, /new URL\("\/login", request\.url\)/);
});

test("market settings invalidates effective values after saving", () => {
  assert.match(routeSource, /invalidateEffectiveMarketsCache\(\);/);
});
