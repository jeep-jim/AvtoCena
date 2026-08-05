import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const queue = fs.readFileSync(new URL("../.github/workflows/catalog-v3-sequential-queue.yml", import.meta.url), "utf8");

const order = ["Korea", "Japan", "China", "UAE", "Europe", "Georgia", "Kyrgyzstan"];

test("Catalog V3 dispatches all markets strictly in sequence after success", () => {
  for (const market of order) assert.match(queue, new RegExp(`Catalog V3 · ${market} · 10k`));
  assert.match(queue, /conclusion == 'success'/);
  assert.match(queue, /head_branch == 'main'/);
  assert.match(queue, /actions: write/);
  assert.match(queue, /catalog-v2-japan\.yml/);
  assert.match(queue, /catalog-v2-china\.yml/);
  assert.match(queue, /catalog-v2-uae\.yml/);
  assert.match(queue, /catalog-v2-europe\.yml/);
  assert.match(queue, /catalog-v2-georgia\.yml/);
  assert.match(queue, /catalog-v2-kyrgyzstan\.yml/);
});
