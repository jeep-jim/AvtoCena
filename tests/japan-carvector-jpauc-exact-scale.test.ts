import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { jpaucPhotoVariants, parseJpaucListingRows } from "../apps/web/lib/catalog/jpauc-past-source";
import { extractCarvectorOffersFromNgState } from "../scripts/lib/carvector-ng-state.mjs";
import { toJapanAuctionDate } from "../scripts/lib/japan-auction-date.mjs";

test("CarVector UTC timestamps are joined on the Japan auction calendar date", () => {
  assert.equal(toJapanAuctionDate("2026-08-25T23:09:00Z"), "2026-08-26");
  assert.equal(toJapanAuctionDate("2026-08-26T04:00:00Z"), "2026-08-26");
  assert.equal(toJapanAuctionDate("2026-08-26"), "2026-08-26");
});

test("CarVector public SSR ng-state yields the exact offers payload", () => {
  const payload = { total: 2, offers: [{ id: "one", lot: "7" }, { id: "two", lot: "8" }] };
  const html = `<html><script id="ng-state" type="application/json">${JSON.stringify({ hash: { b: { data: { result: payload } } } })}</script></html>`;
  assert.deepEqual(extractCarvectorOffersFromNgState(html), payload);
  assert.throws(() => extractCarvectorOffersFromNgState("<html></html>"), /carvector_ng_state_missing/);
  const limited = `<script id="ng-state" type="application/json">${JSON.stringify({ INIT_STATE_PROJECT_CONTEXT: { rateLimited: true, retryAfterSeconds: 30 } })}</script>`;
  assert.throws(() => extractCarvectorOffersFromNgState(limited), /rateLimited=true:retryAfter=30/);
});

test("CarVector evidence merge requires every checkpoint and deduplicates ids", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "japan-evidence-"));
  const input = path.join(root, "chunks");
  const output = path.join(root, "merged.json");
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, "a.json"), JSON.stringify({ evidence: [{ id: "a" }, { id: "shared" }], report: { scope: "a", carvectorTotal: 10 } }));
  fs.writeFileSync(path.join(input, "b.json"), JSON.stringify({ evidence: [{ id: "b" }, { id: "shared" }], report: { scope: "b", carvectorTotal: 10 } }));
  const result = spawnSync(process.execPath, ["scripts/japan-carvector-evidence-merge.mjs"], {
    cwd: process.cwd(), encoding: "utf8",
    env: { ...process.env, JAPAN_EVIDENCE_MERGE_INPUT_DIR: input, JAPAN_EVIDENCE_MERGE_OUTPUT: output, JAPAN_EVIDENCE_EXPECTED_SCOPES: "a,b" },
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(payload.evidence.length, 3);
  assert.equal(payload.report.carvectorEligible, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test("JPAuc exports exact lot identity and three same-lot Aleado image variants", () => {
  const html = `<table><tr data-id="344621799" data-r="1" data-r-total="43">
    <td></td><td></td><td>2026-08-26</td><td>Atsugi | 89</td>
    <td>SUZUKI<br>WAGON R</td><td>Year: 2022 FX</td><td>660 cc | 5BA-MH85S</td>
    <td>AT | 12,345 KM</td><td>Color: WHITE Auc.Grade: 4</td><td>Status: Sold | Start: ¥ 200,000</td>
    <td><img data-original="https://auctions.aleado.com/pic?sys=1&id=344621799&number=0"></td>
  </tr></table>`;
  const rows = parseJpaucListingRows(html);
  assert.equal(rows.length, 1);
  assert.deepEqual({
    id: rows[0].dataId, date: rows[0].date, location: rows[0].location, lot: rows[0].lot,
    make: rows[0].maker, model: rows[0].model, year: rows[0].year, chassis: rows[0].modelCode,
    engineCc: rows[0].engineCc, status: rows[0].sourceStatus,
  }, {
    id: "344621799", date: "2026-08-26", location: "Atsugi", lot: "89",
    make: "SUZUKI", model: "WAGON R", year: 2022, chassis: "5BA-MH85S", engineCc: 660, status: "Sold",
  });
  const images = jpaucPhotoVariants(rows[0].listingImage);
  assert.equal(images.length, 3);
  assert.ok(images.every((url) => new URL(url).hostname.endsWith("aleado.com")));
  assert.deepEqual(images.map((url) => new URL(url).searchParams.get("number")), ["1", "2", "0"]);
});

test("Japan scale workflow is approved-source-only and cannot publish below 8700", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-v6-japan-approved-exact-scale.yml", "utf8");
  const collector = fs.readFileSync("scripts/japan-carvector-jpauc-exact-chunk.mjs", "utf8");
  const recovery = fs.readFileSync("scripts/catalog-live-recovery-japan-jpauc-carvector.mjs", "utf8");
  const quota = fs.readFileSync("apps/web/lib/catalog/inventory-quota.ts", "utf8");
  const publisher = fs.readFileSync("scripts/catalog-live-recovery-publish.mjs", "utf8");
  assert.match(workflow, /offers\.length < 8700/);
  assert.match(workflow, /group: catalog-live-daily-working-markets/);
  assert.match(workflow, /"japan":8700/);
  assert.match(collector, /const SOURCE_ID = "jpauc_japan_past_open"/);
  assert.match(collector, /const EVIDENCE_SOURCE_ID = "carvector_japan_stat_open"/);
  assert.match(collector, /JAPAN_EXACT_RECENT_LIMIT/);
  assert.match(workflow, /JAPAN_EXACT_RECENT_LIMIT: "5000"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_ONLY: "1"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_INPUT: japan-evidence-input\/japan-carvector-evidence\.json/);
  assert.match(workflow, /Join JPAuc once against all exact CarVector evidence/);
  assert.match(workflow, /recent-00000-05000/);
  assert.match(workflow, /recent-25000-30000/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_CONCURRENCY: "1"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_TRANSPORT: ssr/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_SERVER_MIN_PRICE: "1"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_SERVER_MIN_ENGINE_CC: "400"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_PAGE_DELAY_MS: "5000"/);
  assert.doesNotMatch(workflow, /Cool down the shared CarVector rate window/);
  assert.match(workflow, /JAPAN_EXACT_MAX_FALLBACK_PAGES: "0"/);
  assert.match(collector, /"auctionDate", "auctionVenue", "lotNumber", "make", "model", "chassis", "year", "engineCc"/);
  assert.match(recovery, /raw\?\.exactJoinVersion === 1/);
  assert.match(quota, /process\.env\.CATALOG_MAX_OFFERS_PER_MODEL_YEAR \|\| 20/);
  assert.match(quota, /Math\.min\(100/);
  assert.match(workflow, /RECOVERY_PUBLISH_MIN_COUNT: "8700"/);
  assert.match(publisher, /recovery_canonical_preview_count_gate_failed/);
  assert.doesNotMatch(`${workflow}\n${collector}\n${recovery}`, /goo-?net_exchange|goonet-exact-source/i);
});


test("Japan exact resume partitions JPAuc deterministically and reuses complete evidence", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-v6-japan-approved-exact-resume.yml", "utf8");
  const collector = fs.readFileSync("scripts/japan-carvector-jpauc-exact-chunk.mjs", "utf8");
  const merge = fs.readFileSync("scripts/japan-jpauc-exact-parts-merge.mjs", "utf8");
  assert.match(workflow, /run-id: "33264014581"/);
  assert.match(workflow, /max-parallel: 1/);
  assert.match(workflow, /JAPAN_EXACT_GROUP_PART_COUNT: "4"/);
  assert.match(workflow, /JAPAN_EXACT_EXPECTED_PARTS: "0,1,2,3"/);
  assert.match(workflow, /offers\.length < 8700/);
  assert.match(collector, /index % groupPartCount === groupPartIndex/);
  assert.match(merge, /japan_exact_part_coverage_failed/);
});


test("Japan safe-price resume permits only the transparent M1 personal-use scenario", () => {
  const workflow = fs.readFileSync(".github/workflows/catalog-v6-japan-approved-safe-price-resume.yml", "utf8");
  const recovery = fs.readFileSync("scripts/catalog-live-recovery-japan-jpauc-carvector.mjs", "utf8");
  assert.match(workflow, /run-id: "33281414642"/);
  assert.match(workflow, /m1_personal_use_assumption_only/);
  assert.match(workflow, /customs\?\.ageEstimated === false/);
  assert.match(workflow, /offers\.length < 8700/);
  assert.match(recovery, /customs\?\.vehicleCategoryAssumed === true/);
  assert.match(recovery, /snapshot\.estimatedMarketFields\.length === 0/);
  assert.match(recovery, /recoveryCalculationScenario/);
});
