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
  return /catalog-market-refresh\.yml|catalog-v3-market-10k-reusable\.yml|catalog-publish-(?:market|source-scale|fresh)\.mjs|catalog-rebuild-source-shard\.mjs/.test(source);
}

test("each scheduled market owns its queue and shares guarded publication through the worker", () => {
 const expected=['china','europe','georgia','korea','uae'].map(m=>`catalog-refresh-${m}.yml`).sort();
 const scheduled=fs.readdirSync(root).filter(n=>/^catalog.*\.ya?ml$/.test(n)&&hasSchedule(text(n))&&writesCatalogMarkets(text(n))).sort();
 assert.deepEqual(scheduled,expected);
 const groups=new Set<string>();
 for(const name of expected){
  const source=text(name);
  const group=source.match(/group: (catalog-refresh-\w+)/)?.[1];assert.ok(group);groups.add(group!);
  assert.match(source,/cancel-in-progress: false/);
  assert.match(source,/uses: \.\/\.github\/workflows\/catalog-market-refresh\.yml/);
 }
 assert.equal(groups.size,5);
 const worker=text('catalog-market-refresh.yml');
 assert.match(worker,/CATALOG_SELLER_INVENTORY: '1'/);
 assert.match(worker,/catalog-storage-preflight/);
 assert.match(worker,/catalogRefreshDue\(\)/);
 assert.ok(worker.includes("CATALOG_INTAKE_RESUME: ${{ matrix.market == 'china' && '1' || '0' }}"));
 assert.doesNotMatch(worker,/group: catalog-six-market/);
 assert.equal(hasSchedule(text('catalog-five-market-full-rebuild.yml')),false);
});
test("Japan independently resumes durable progress and cleanup retains its bounded six-hour schedule", () => {
 const japan=text('proauctions-collect-publish.yml'),cleanup=text('catalog-storage-cleanup.yml');
 assert.match(japan,/catalog-refresh-japan/);
 assert.match(japan,/proauctions-restore-state\.mjs/);
 assert.match(japan,/cron: "0 3 \* \* \*"/);
 assert.match(japan,/PROAUCTIONS_SECONDS: '2400'/);
 assert.match(cleanup,/cron: "0 \*\/6 \* \* \*"/);
 assert.match(cleanup,/catalog-storage-maintenance\.mjs/);
 assert.equal(writesCatalogMarkets(cleanup),false);
 for(const workflow of [text('catalog-market-refresh.yml'),japan,cleanup]){
  const days=[...workflow.matchAll(/retention-days:\s*(\d+)/g)].map(m=>Number(m[1]));
  assert.ok(days.length);assert.deepEqual([...new Set(days)],[14]);
 }
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
