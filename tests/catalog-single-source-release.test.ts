import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("one productive source can release a nonempty market; empty and unattempted sources still fail", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-single-source-"));
  try {
    const offers = JSON.parse(fs.readFileSync("data/catalog/research/five-market-trial-20260907/34083757152/korea/kcar_korea_open/offers-0001.json", "utf8"));
    const sample = offers.find((row: any) => row.totalRub > 0 && row.calculationSnapshot?.customs?.status === "ready");
    assert.ok(sample, "saved calculated fixture must exist");
    // Synthetic market fixture, not a claim that this Korean listing is Georgian.
    const offer = { ...sample, market: "georgia", sourceId: "source_a" };
    fs.writeFileSync(path.join(dir, "catalog-v3-probe-georgia-0.json"), JSON.stringify({ market: "georgia", results: [], requiredSourceIds: ["source_a", "source_b"], requiredActiveSourceIds: ["source_a", "source_b"], activeSourceIds: ["source_a", "source_b"] }));
    const run = (rows: any[], liveSourceIds: string[]) => {
      fs.writeFileSync(path.join(dir, "catalog-rebuild-georgia-0.json"), JSON.stringify({ market: "georgia", offers: rows, liveSourceIds, report: { sources: [{ sourceId: "source_a", mode: "live", pages: 1 }] } }));
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/catalog-validate-source-scale.mjs"], { encoding: "utf8", env: { ...process.env, CATALOG_REBUILD_INPUT_DIR: dir, CATALOG_REBUILD_MARKETS: "georgia", CATALOG_REBUILD_VALIDATION_REPORT: path.join(dir, "report.json"), CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES: "0" } });
      return { result, report: JSON.parse(fs.readFileSync(path.join(dir, "report.json"), "utf8")) };
    };
    const partial = run([offer], ["source_a", "source_b"]);
    assert.equal(partial.result.status, 0, JSON.stringify(partial.report));
    assert.equal(partial.report.ok, true);
    assert.equal(run([], ["source_a", "source_b"]).report.ok, false);
    assert.equal(run([offer], ["source_a"]).report.ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
