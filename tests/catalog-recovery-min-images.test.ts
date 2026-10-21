import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const gate = new URL("../scripts/catalog-recovery-photo-gate.mjs", import.meta.url).pathname;

function runGate(env: Record<string, string>) {
  return spawnSync(process.execPath, [gate], { env: { ...process.env, ...env }, encoding: "utf8" });
}

test("recovery input photo gate counts CatalogImage objects and fails closed below five", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-photo-gate-"));
  const input = path.join(dir, "korea.json");
  fs.writeFileSync(input, JSON.stringify({ offers: [
    { id: "ok", sourceOfferId: "1", market: "korea", sourceId: "encar_direct", images: [1, 2, 3, 4, 5].map((id) => ({ url: `https://img/${id}`, mimeType: "image/jpeg" })) },
    { id: "bad", sourceOfferId: "2", market: "korea", sourceId: "kbchachacha_korea_open", images: ["https://img/a", "https://img/b", "https://img/c", "https://img/d"] },
  ] }));
  const result = runGate({ RECOVERY_PHOTO_GATE_MARKET: "korea", RECOVERY_PHOTO_GATE_INPUT: input, RECOVERY_PHOTO_GATE_REPORT: path.join(dir, "report.json"), CATALOG_REBUILD_MIN_IMAGES_PER_OFFER: "5" });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  assert.equal(report.belowMinimum, 1);
  assert.equal(report.sourceStats.encar_direct.min, 5);
  assert.equal(report.sourceStats.kbchachacha_korea_open.min, 4);
});

test("recovery dry-run photo gate requires the combined target minimum", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-photo-dry-"));
  const input = path.join(dir, "dry.json");
  fs.writeFileSync(input, JSON.stringify({ dryRun: true, byMarket: { korea: { count: 12085, imageStats: { min: 3, max: 30, average: 20.98 } } } }));
  const result = runGate({ RECOVERY_PHOTO_GATE_MARKET: "korea", RECOVERY_PHOTO_GATE_DRY_RUN_REPORT: input, RECOVERY_PHOTO_GATE_REPORT: path.join(dir, "report.json"), RECOVERY_MIN_IMAGES_PER_OFFER: "5" });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8"));
  assert.equal(report.observedMinimum, 3);
  assert.equal(report.minimumImages, 5);
});
