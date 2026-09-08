import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(".github/workflows");

function text(name: string) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

function hasSchedule(source: string) {
  return /^\s{2}schedule\s*:/m.test(source) || /^\s{4}-\s*cron\s*:/m.test(source);
}

function writesCatalogMarkets(source: string) {
  return /catalog-v3-market-10k-reusable\.yml|catalog-publish-(?:market|source-scale|fresh)\.mjs|catalog-rebuild-source-shard\.mjs/.test(source);
}

test("only the owner-approved weekly six-market writer has a schedule; legacy writers stay paused", () => {
  const scheduledWriters = fs.readdirSync(root)
    .filter((name) => /^catalog.*\.ya?ml$/i.test(name))
    .filter((name) => {
      const source = text(name);
      return hasSchedule(source) && writesCatalogMarkets(source);
    })
    .sort();
  assert.deepEqual(scheduledWriters, ["catalog-weekly-six-markets.yml"]);

  // Cleanup is paused too, so the frozen catalog cannot lose generations while
  // the new two-week retention contract is being repaired and verified.
  const cleanup = text("catalog-storage-cleanup.yml");
  assert.equal(hasSchedule(cleanup), false);
  assert.equal(writesCatalogMarkets(cleanup), false);
});

test("saved Knowledge CORE source corpus cannot restart its multi-hour crawl on a schedule", () => {
  const source = text("knowledge-source-snapshot.yml");
  assert.doesNotMatch(source, /^\s{2}schedule\s*:/m);
  assert.doesNotMatch(source, /^\s{4}-\s*cron\s*:/m);
});

test("active V3 pipeline owns approved market rules", () => {
  const queue = text("catalog-v3-sequential-queue.yml");
  const reusable = text("catalog-v3-market-10k-reusable.yml");
  assert.match(queue, /korea/);
  assert.match(queue, /china/);
  assert.match(queue, /uae/);
  assert.match(queue, /europe/);
  assert.match(queue, /georgia/);
  assert.doesNotMatch(queue, /kyrgyzstan|Кыргызстан/);
  assert.doesNotMatch(queue, /^  japan:/m);
  assert.match(reusable, /CATALOG_V2_LOW_POWER_MIN_SHARE: "0\.8"/);
  assert.match(reusable, /CATALOG_PRIORITY_MAX_POWER_HP: "160"/);
  // Two photos is the general admission floor; collectors still prefer up to 30
  // and source-specific adapters may require more before publishing a listing.
  assert.match(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "2"/);
  assert.doesNotMatch(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5"/);
  assert.match(reusable, /CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER: "30"/);
  assert.match(reusable, /CATALOG_COLLECTION_IMAGE_LIMIT: "30"/);
});

test("the five-market queue excludes Japan and stops before collection during the pause", () => {
  const queue = text("catalog-v3-sequential-queue.yml");
  assert.doesNotMatch(queue, /^  japan:|run_japan|market: japan/m);
  assert.match(queue, /CATALOG_PRODUCTION_WRITES_PAUSED/);
  assert.match(queue, /process\.exit\(1\)/);
  assert.equal((queue.match(/needs\.plan\.result == 'success'/g) || []).length, 5);
  assert.equal((queue.match(/retention_ms: "1209600000"/g) || []).length, 5);
});

test("Japan marker pushes continue accumulation while explicit dispatch remains the reset path", () => {
  const workflow = text("catalog-v2-japan.yml");
  assert.match(workflow, /push:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /\.github\/market-runs\/japan/);
  assert.match(workflow, /^\s+reset_cursor: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}$/m);
});
