import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { jpaucPhotoVariants, parseJpaucListingRows } from "../apps/web/lib/catalog/jpauc-past-source";

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
  assert.deepEqual(images.map((url) => new URL(url).searchParams.get("number")), ["0", "1", "2"]);
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
  assert.match(workflow, /JAPAN_EXACT_RECENT_LIMIT: "7500"/);
  assert.match(workflow, /recent-00000-07500/);
  assert.match(workflow, /recent-22500-30000/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_CONCURRENCY: "1"/);
  assert.match(workflow, /JAPAN_EXACT_CARVECTOR_PAGE_DELAY_MS: "5000"/);
  assert.match(collector, /"auctionDate", "auctionVenue", "lotNumber", "make", "model", "chassis", "year", "engineCc"/);
  assert.match(recovery, /raw\?\.exactJoinVersion === 1/);
  assert.match(quota, /process\.env\.CATALOG_MAX_OFFERS_PER_MODEL_YEAR \|\| 20/);
  assert.match(quota, /Math\.min\(100/);
  assert.match(workflow, /RECOVERY_PUBLISH_MIN_COUNT: "8700"/);
  assert.match(publisher, /recovery_canonical_preview_count_gate_failed/);
  assert.doesNotMatch(`${workflow}\n${collector}\n${recovery}`, /goo-?net_exchange|goonet-exact-source/i);
});
