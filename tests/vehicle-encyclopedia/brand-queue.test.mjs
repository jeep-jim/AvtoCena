import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readJson } from "../../scripts/vehicle-encyclopedia/lib.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const report = await readJson(path.join(REPO_ROOT, "data/catalog/vehicle-encyclopedia-v2/reports/brand-queue.json"));

test("brand queue covers every production brand exactly once", () => {
  assert.equal(report.totals.productionBrands, 185);
  assert.equal(report.queue.length, 185);
  assert.equal(new Set(report.queue.map((row) => row.brand)).size, 185);
  assert.equal(report.totals.verified, 5);
  assert.equal(report.totals.inProgress, 20);
  assert.equal(report.totals.queued, 160);
});

test("legacy records remain candidates and checkpoint queues stay bounded", () => {
  assert.equal(report.productionModified, false);
  assert.equal(report.totals.legacyCandidateModels, 4899);
  assert.equal(report.totals.legacyCandidateVariants, 15735);
  assert.equal(report.activeCheckpoint, "checkpoint-03");
  assert.equal(report.nextCheckpoint.length, 15);
  assert.equal(report.checkpoints["checkpoint-02"].length, 15);
  assert.equal(report.checkpoints["checkpoint-03"].length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-02" && row.status === "in-progress").length, 15);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-02" && row.status === "queued").length, 0);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-03" && row.status === "in-progress").length, 5);
  assert.equal(report.queue.filter((row) => row.checkpoint === "checkpoint-03" && row.status === "queued").length, 10);
});
