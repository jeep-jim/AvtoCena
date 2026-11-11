import assert from "node:assert/strict";
import test from "node:test";
import {
  compatibleCarvectorModel,
  enrichPrestigeOfferFromCarvector,
  normalizeCarvectorChassis,
  parseCarvectorStatsHtml,
} from "../scripts/prestige-japan-carvector-power-enrich.mjs";

function html(offers: unknown[]) {
  return `<script id="ng-state" type="application/json">${JSON.stringify({ cache: { b: { data: { result: { __typename: "FindOffersAuctionsResult", offers } } } } })}</script>`;
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    __typename: "OfferAuction",
    kind: "AUCTION_STATS",
    make: { title: "Toyota" },
    model: { title: "COROLLA" },
    chassis: { title: "ZRE212W" },
    modification: { title: "G-X" },
    year: 2020,
    engineVolume: 1800,
    power: 140,
    finishPrice: { JPY: 1_100_000 },
    auctionAt: "2026-08-20T10:00:00Z",
    urlPage: { fullUrl: "/stat/toyota/corolla/00000000-0000-0000-0000-000000000001" },
    ...overrides,
  };
}

function prestige(overrides: Record<string, unknown> = {}) {
  return {
    sourceId: "prestige_japan_auctions_open",
    market: "japan",
    make: "Toyota",
    model: "Corolla Touring",
    year: 2020,
    engineCc: 1800,
    frameNumber: "3BA-ZRE212W",
    sourceTitle: "2020 Toyota Corolla Touring G-X",
    operational: { raw: { fields: { Chassis: "3BA-ZRE212W" } } },
    ...overrides,
  };
}

test("CarVector stats parser keeps only completed public statistics with exact provenance", () => {
  const rows = parseCarvectorStatsHtml(html([
    evidence(),
    evidence({ kind: "AUCTION", urlPage: { fullUrl: "/auction/toyota/corolla/current" } }),
    evidence({ finishPrice: { JPY: 0 } }),
  ]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].powerHp, 140);
  assert.equal(rows[0].chassis, "ZRE212W");
  assert.match(rows[0].sourceUrl, /^https:\/\/carvector\.com\/stat\//);
});

test("regulatory type prefix is removed without truncating the exact chassis", () => {
  assert.equal(normalizeCarvectorChassis("3BA-ZRE212W"), "ZRE212W");
  assert.equal(normalizeCarvectorChassis("DBA-AGH30W-0012345"), "AGH30W");
  assert.equal(normalizeCarvectorChassis("12GR20"), "12GR20");
});

test("body suffix is the only tolerated model-name difference", () => {
  assert.equal(compatibleCarvectorModel("Corolla", "Corolla Touring"), true);
  assert.equal(compatibleCarvectorModel("Corolla", "Crown"), false);
});

test("exact same-year chassis evidence enriches a combustion Prestige lot", () => {
  const rows = parseCarvectorStatsHtml(html([evidence()]));
  const result = enrichPrestigeOfferFromCarvector(prestige(), rows);
  assert.equal(result.reason, "enriched");
  assert.equal(result.offer.powerHp, 140);
  assert.equal(result.offer.powertrainKind, "combustion");
  assert.equal(result.offer.powerDataConfidence, "source_exact");
  assert.equal(result.offer.operational.raw.carvectorEvidenceSourceId, "carvector_japan_stat_open");
});

test("exact make, chassis, year and engine remain sufficient when a body label differs", () => {
  const rows = parseCarvectorStatsHtml(html([evidence({ model: { title: "COROLLA AXIO" } })]));
  const result = enrichPrestigeOfferFromCarvector(prestige(), rows);
  assert.equal(result.reason, "enriched");
  assert.equal(result.offer.operational.raw.carvectorEvidenceModelCompatible, false);
});

test("hybrid evidence and ambiguous power fail closed", () => {
  const hybrid = parseCarvectorStatsHtml(html([evidence({ modification: { title: "HYBRID G" } })]));
  assert.equal(enrichPrestigeOfferFromCarvector(prestige(), hybrid).reason, "no_safe_exact_match");

  const ambiguous = parseCarvectorStatsHtml(html([evidence(), evidence({ power: 145, urlPage: { fullUrl: "/stat/toyota/corolla/00000000-0000-0000-0000-000000000002" } })]));
  assert.equal(enrichPrestigeOfferFromCarvector(prestige(), ambiguous).reason, "ambiguous_power");
});

test("same chassis from another manufacturer cannot enrich the Prestige lot", () => {
  const rows = parseCarvectorStatsHtml(html([evidence({ make: { title: "Honda" } })]));
  assert.equal(enrichPrestigeOfferFromCarvector(prestige(), rows).reason, "no_safe_exact_match");
});

test("source-exact CarVector power replaces an untrusted representative estimate", () => {
  const rows = parseCarvectorStatsHtml(html([evidence()]));
  const result = enrichPrestigeOfferFromCarvector(prestige({ powerHp: 94, powerDataConfidence: "estimated", powerDataSource: "vehicle-model-representative:toyota/corolla" }), rows);
  assert.equal(result.reason, "enriched");
  assert.equal(result.offer.powerHp, 140);
  assert.equal(result.offer.powerDataConfidence, "source_exact");
});

test("a Prestige hybrid is never converted to combustion even when the evidence title is incomplete", () => {
  const rows = parseCarvectorStatsHtml(html([evidence()]));
  const result = enrichPrestigeOfferFromCarvector(prestige({ trim: "Hybrid G" }), rows);
  assert.equal(result.reason, "electrified");
  assert.equal(result.offer.powerHp, undefined);
});
