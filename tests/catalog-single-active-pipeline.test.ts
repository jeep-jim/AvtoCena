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

test("Catalog V3 sequential queue is the only automatically scheduled catalog writer", () => {
  const scheduled = fs.readdirSync(root)
    .filter((name) => /^catalog.*\.ya?ml$/i.test(name))
    .filter((name) => hasSchedule(text(name)))
    .sort();
  assert.deepEqual(scheduled, ["catalog-v3-sequential-queue.yml"]);
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
  assert.match(queue, /kyrgyzstan/);
  assert.match(queue, /japan/);
  assert.match(reusable, /CATALOG_V2_LOW_POWER_MIN_SHARE: "0\.8"/);
  assert.match(reusable, /CATALOG_PRIORITY_MAX_POWER_HP: "160"/);
  assert.match(reusable, /CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "2"/);
});
