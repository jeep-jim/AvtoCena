import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(".github/workflows/ops-issue241-invalid-identity-migration-20260815.yml", "utf8");
const migration = fs.readFileSync("scripts/issue241-invalid-identity-migrate.mjs", "utf8");

test("issue241 identity migration is manual, dry-run by default, and serialized with catalog writers", () => {
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n\s*push:/);
  assert.doesNotMatch(workflow, /\n\s*schedule:/);
  assert.match(workflow, /apply:[\s\S]*type: boolean[\s\S]*default: false/);
  assert.match(workflow, /apply:[\s\S]*group: catalog-live-daily-working-markets[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /Refuse to overlap another active writer-capable workflow/);
  assert.match(workflow, /ISSUE241_IDENTITY_APPLY: "0"/);
  assert.match(workflow, /ISSUE241_IDENTITY_APPLY: "1"/);
});

test("issue241 migration preserves the exact planned public rows and fails closed before persistence", () => {
  assert.match(migration, /const publishLockPath = "catalog\/import-lock\.json"/);
  assert.match(migration, /preservePublicOffersByMarket: plan\.publicAfter/);
  assert.match(migration, /beforePersistValidate\(publicOffers\)/);
  assert.match(migration, /prewrite:\$\{market\}:hash_mismatch/);
  assert.match(migration, /postwrite:\$\{market\}:hash_mismatch/);
  assert.match(migration, /postwrite:internal_hash_mismatch/);
  assert.match(migration, /CHINA\.size === 3 && EUROPE_DROP\.size === 2 && GEORGIA\.size === 25 && KYRGYZSTAN\.size === 8/);
  assert.match(migration, /expectedIds\.size === 38/);
});

test("Georgia identity repairs remain canonical AutoPapa only", () => {
  assert.match(migration, /offer\.sourceId === "autopapa_georgia_open"/);
  assert.doesNotMatch(migration, /auto_georgia_open|ss_georgia|mymarket_georgia/i);
});
