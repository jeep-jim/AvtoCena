import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const core = fs.readFileSync(new URL("../apps/web/lib/catalog/knowledge-core.ts", import.meta.url), "utf8");

test("marketplace source_exact extraction is not authoritative horsepower evidence", () => {
  const start = core.indexOf("function sourcePowerAuthoritative");
  const end = core.indexOf("\n}\n", start) + 3;
  assert.ok(start >= 0 && end > start);
  const block = core.slice(start, end);
  assert.doesNotMatch(block, /source_exact\|/);
  assert.match(block, /homolog/);
  assert.match(block, /type\.\?approval/);
  assert.match(block, /coc/);
  assert.match(block, /registration/);
  assert.match(block, /official/);
  assert.match(block, /source_exact means only that the marketplace field was extracted exactly/);
});
