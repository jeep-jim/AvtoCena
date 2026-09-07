import assert from "node:assert/strict";
import test from "node:test";
import { catalogCandidateObjectExpired, catalogMarketLifecycle, catalogMarketRetentionMs, catalogOfferWithinRetention, observeCatalogOffer, preserveCatalogOfferObservation } from "../apps/web/lib/catalog/refresh-policy";
import { catalogConfirmedWithdrawalIndex, catalogOfferWithdrawnByReport } from "../apps/web/lib/catalog/source-retention";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

const DAY = 86_400_000;
const now = Date.UTC(2026, 8, 7);
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const listing = (overrides: Partial<VehicleOffer> = {}) => ({
  id: "kcar:1", sourceId: "kcar_korea_open", sourceOfferId: "1", market: "korea", status: "active",
  firstSeenAt: ago(100), updatedAt: ago(20), operational: { sourcePublishedAt: ago(100), lastSeenAt: ago(20) },
  ...overrides,
} as VehicleOffer);

test("owner cadence and retention apply to every market without a global Japan override", () => {
  for (const market of ["korea", "europe", "china", "uae", "georgia"]) {
    assert.deepEqual(catalogMarketLifecycle(market), { retentionDays: 14, refreshIntervalDays: 7, cleanupIntervalDays: 7 });
    assert.equal(catalogMarketRetentionMs(market), 14 * DAY);
  }
  assert.deepEqual(catalogMarketLifecycle("japan"), { retentionDays: 30, refreshIntervalDays: 14, cleanupIntervalDays: 30 });
  assert.equal(catalogMarketRetentionMs("japan"), 30 * DAY);
});

test("an old active listing stays when its source confirms it again", () => {
  const old = listing();
  assert.equal(catalogOfferWithinRetention(old, now), false);
  const seen = observeCatalogOffer(old, ago(1));
  assert.equal(seen.firstSeenAt, ago(100));
  assert.equal(catalogOfferWithinRetention(seen, now), true);
  assert.equal(old.operational?.lastSeenAt, ago(20));
});

test("repricing and serializing never refresh the source observation", () => {
  const repriced = { ...preserveCatalogOfferObservation(listing()), updatedAt: ago(0), totalRub: 2_000_000 };
  assert.equal(catalogOfferWithinRetention(repriced, now), false);
  const legacy = listing({ operational: { sourcePublishedAt: ago(100) } });
  const serialized = { ...preserveCatalogOfferObservation(legacy), updatedAt: ago(0) };
  assert.equal(serialized.operational?.lastSeenAt, ago(20));
  assert.equal(catalogOfferWithinRetention(serialized, now), false);
});

test("confirmed sold and removed listings leave the non-Japan active inventory immediately", () => {
  for (const status of ["sold", "removed"] as const) {
    const offer = observeCatalogOffer(listing({ status }), ago(0));
    assert.equal(catalogOfferWithinRetention(offer, now), false);
  }
  assert.equal(catalogOfferWithinRetention(observeCatalogOffer(listing(), ago(14)), now), true);
  assert.equal(catalogOfferWithinRetention(observeCatalogOffer(listing(), ago(14.001)), now), false);
});

test("Japan sold auction history uses the event date and remains for thirty days", () => {
  const offer = listing({ market: "japan", status: "sold", auctionDate: ago(20), updatedAt: ago(0) });
  assert.equal(catalogOfferWithinRetention(offer, now), true);
  assert.equal(catalogOfferWithinRetention({ ...offer, auctionDate: ago(31) }, now), false);
});

test("withdrawal evidence prevents an older active catalog row from being resurrected", () => {
  const old = listing();
  const withdrawal = { id: old.id, market: old.market, sourceId: old.sourceId, sourceOfferId: old.sourceOfferId, status: "sold", observedAt: ago(1) };
  const index = catalogConfirmedWithdrawalIndex([{ report: { confirmedWithdrawals: [withdrawal] } }], "korea");
  assert.equal(catalogOfferWithdrawnByReport(old, index), true);
  assert.equal(catalogOfferWithdrawnByReport(observeCatalogOffer(old, ago(0)), index), false);
  assert.equal(catalogOfferWithdrawnByReport({ ...old, sourceOfferId: "2" }, index), false);
  assert.equal(catalogOfferWithdrawnByReport({ ...old, sourceId: "encar_direct" }, index), false);
  assert.equal(catalogOfferWithdrawnByReport({ ...old, market: "europe" }, index), false);
});

test("withdrawal evidence rejects unapproved sources, ambiguous status, malformed dates and Japan", () => {
  const good = { id: "kcar:1", sourceOfferId: "1", sourceId: "kcar_korea_open", market: "korea", status: "sold", observedAt: ago(1) };
  for (const patch of [{ sourceId: "unknown" }, { market: "china" }, { status: "error" }, { observedAt: "unknown" }, { sourceOfferId: "" }]) {
    assert.equal(catalogConfirmedWithdrawalIndex([{ report: { confirmedWithdrawals: [{ ...good, ...patch }] } }], "korea").size, 0);
  }
  assert.equal(catalogConfirmedWithdrawalIndex([{ report: { confirmedWithdrawals: [good] } }], "japan").size, 0);
});

 test("candidate chunk cleanup waits fourteen days, and thirty for Japan", () => {
  assert.equal(catalogCandidateObjectExpired("catalog/source-candidates/korea/kcar.json", ago(4), now), false);
  assert.equal(catalogCandidateObjectExpired("catalog/source-candidates/korea/kcar.json", ago(15), now), true);
  assert.equal(catalogCandidateObjectExpired("catalog/source-candidates/japan/auction.chunks/0001.json", ago(20), now), false);
  assert.equal(catalogCandidateObjectExpired("catalog/source-candidates/japan/auction.chunks/0001.json", ago(31), now), true);
  assert.equal(catalogCandidateObjectExpired("catalog/manifest.json", ago(100), now), false);
  assert.equal(catalogCandidateObjectExpired("catalog/source-candidates/unknown/data.json", ago(100), now), false);
});
