import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const script = fs.readFileSync("scripts/catalog-enforce-global-model-cap.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/catalog-global-model-cap.yml", "utf8");
const japanStrictWorkflow = fs.readFileSync(".github/workflows/catalog-japan-strict-merge-publish.yml", "utf8");
const kcarRepairWorkflow = fs.readFileSync(".github/workflows/catalog-kcar-exterior-gallery-repair.yml", "utf8");

const liveWriterWorkflowPaths = [
  ".github/workflows/catalog-live-daily-working-markets.yml",
  ".github/workflows/catalog-live-recovery-uae-kyrgyzstan.yml",
  ".github/workflows/catalog-global-model-cap.yml",
  ".github/workflows/catalog-kcar-exterior-gallery-repair.yml",
  ".github/workflows/catalog-certified-power-apply.yml",
  ".github/workflows/catalog-emergency-restore-japan.yml",
  ".github/workflows/catalog-japan-strict-merge-publish.yml",
  ".github/workflows/catalog-live-recovery-uae-georgia-direct.yml",
  ".github/workflows/catalog-v6-prestige-up-to-30k.yml",
];

const sharedWriterConcurrency = /group:\s*catalog-live-daily-working-markets\s*\n\s*cancel-in-progress:\s*false/;

test("canonical catalog cleanup hard-caps every exact model-year at twenty", () => {
  assert.match(script, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR/);
  assert.match(script, /for \(const market of PUBLIC_CATALOG_MARKETS\)/);
  assert.match(script, /if \(count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR\)/);
  assert.match(script, /process\.env\.CATALOG_GROW_ONLY_MARKETS = ""/);
  assert.match(script, /isCatalogYearAllowed\(offer\?\.year, market\)/);
  assert.match(script, /hasCredibleOfferContent/);
  assert.match(script, /catalog\/import-lock\.json/);
});

test("global cleanup is a manual recovery tool and audits all seven markets", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /CATALOG_PUBLISH_LOCK_WAIT_MS: "7200000"/);
  assert.doesNotMatch(workflow, /gh workflow run catalog-live-recovery-uae-georgia-direct\.yml/);
  assert.match(workflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(workflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/);
});

test("Japan strict writer is dispatch-only and proves all-seven safety after every write", () => {
  assert.match(japanStrictWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(japanStrictWorkflow, /^\s+schedule:/m);
  assert.doesNotMatch(japanStrictWorkflow, /^\s+push:/m);
  assert.doesNotMatch(japanStrictWorkflow, /^\s+workflow_run:/m);
  assert.match(japanStrictWorkflow, /gh run download "\$SOURCE_RUN_ID"/);
  assert.doesNotMatch(japanStrictWorkflow, /actions\/artifacts\/\$artifact_id\/zip/);
  assert.doesNotMatch(japanStrictWorkflow, /CATALOG_MAX_MODELS_PER_MAKE/);
  assert.match(japanStrictWorkflow, /CATALOG_MAX_OFFERS_PER_MODEL_YEAR: "20"/);
  assert.match(japanStrictWorkflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(japanStrictWorkflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/);
});

test("K Car repair post-write audit uses the canonical model-year cap and no stale market floors", () => {
  assert.match(kcarRepairWorkflow, /CATALOG_AUDIT_ASSERT_MARKETS: korea,china,japan,uae,europe,georgia,kyrgyzstan/);
  assert.match(kcarRepairWorkflow, /CATALOG_AUDIT_MAX_PER_MODEL_YEAR: "20"/);
  assert.doesNotMatch(kcarRepairWorkflow, /CATALOG_AUDIT_MIN_COUNTS_JSON/);
  assert.doesNotMatch(kcarRepairWorkflow, /japan\\?\"?:5000/);
});

test("every production catalog writer uses the shared non-cancelling concurrency slot", () => {
  for (const path of liveWriterWorkflowPaths) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, sharedWriterConcurrency, `${path} must use the shared writer slot`);
  }
});
