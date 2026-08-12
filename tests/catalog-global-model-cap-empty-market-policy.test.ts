import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync(new URL("../scripts/catalog-enforce-global-model-cap.mjs", import.meta.url), "utf8");

test("global canonical cleanup fails closed unless an empty market is explicitly allowed", () => {
  assert.match(script, /CATALOG_ALLOW_EMPTY_MARKETS/);
  assert.match(script, /!allowedEmptyMarkets\.has\(market\)/);
  assert.match(script, /catalog_global_model_cap_empty:\$\{market\}/);
  assert.match(script, /unexpected_empty_after_publish/);
  assert.match(script, /allowedEmptyMarkets: \[\.\.\.allowedEmptyMarkets\]/);
});
