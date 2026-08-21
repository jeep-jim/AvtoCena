import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCatalogV2Offer,
  isCompletedJapanAuction,
  isJapanAuctionOffer,
} from "../apps/web/lib/catalog/catalog-v2-policy";

function japanOffer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    market: "japan",
    sourceId: "goonet_japan_exact",
    sourceOfferId: id,
    make: "Toyota",
    model: "Corolla",
    year: 2024,
    sourcePrice: 2_500_000,
    sourceCurrency: "JPY",
    totalRub: 2_100_000,
    powerHp: 125,
    status: "active",
    ...overrides,
  } as any;
}

test("Japan accepts fixed-price dealer listings without an auction result", () => {
  const listing = japanOffer("fixed-price");
  assert.equal(isJapanAuctionOffer(listing), false);
  const classification = classifyCatalogV2Offer(listing);
  assert.equal(classification.eligible, true);
  assert.equal(classification.tier, "priority");
  assert.equal(classification.reason, "affordable_recent");
});

test("Japan still rejects unfinished auction lots and accepts completed results", () => {
  const unfinished = japanOffer("unfinished", {
    sourceId: "jpauc_japan_current_open",
    offerType: "auction",
  });
  assert.equal(isJapanAuctionOffer(unfinished), true);
  assert.equal(isCompletedJapanAuction(unfinished), false);
  assert.equal(classifyCatalogV2Offer(unfinished).reason, "japan_auction_not_completed");

  const completed = japanOffer("completed", {
    sourceId: "jpauc_japan_past_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
  });
  assert.equal(isCompletedJapanAuction(completed), true);
  assert.equal(classifyCatalogV2Offer(completed).tier, "japan_auction");
});

test("Japan includes model year 2010 but rejects older stock", () => {
  assert.equal(classifyCatalogV2Offer(japanOffer("year-2010", { year: 2010 })).eligible, true);
  assert.equal(classifyCatalogV2Offer(japanOffer("year-2009", { year: 2009 })).reason, "year");
});
