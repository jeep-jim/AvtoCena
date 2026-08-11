import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/catalog-v6-prestige-up-to-30k.yml", "utf8");

test("V6 production publish waits on the shared catalog writer and audits all seven markets", () => {
  assert.match(workflow, /publish:[\s\S]*concurrency:[\s\S]*group: catalog-live-daily-working-markets[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /CATALOG_MAX_OFFERS_PER_MODEL: "20"/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL: "20"/);
});
