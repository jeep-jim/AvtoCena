import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyCatalogV2Offer,
  isCompletedJapanAuction,
  isJapanAuctionOffer,
} from "../apps/web/lib/catalog/catalog-v2-policy";
import { japanAuctionSoldIdentityVerified } from "../apps/web/lib/catalog/public-priority";
import { compactPublicStorageOffer } from "../apps/web/lib/catalog/storage";

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
  assert.equal(classification.reason, "affordable_low_power");
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
  assert.equal(classifyCatalogV2Offer(completed).tier, "priority");
  assert.equal(classifyCatalogV2Offer(completed).reason, "japan_completed_priority");
});

test("Japan includes model year 2010 but rejects older stock", () => {
  assert.equal(classifyCatalogV2Offer(japanOffer("year-2010", { year: 2010 })).eligible, true);
  assert.equal(classifyCatalogV2Offer(japanOffer("year-2009", { year: 2009 })).reason, "year");
});

test("post-publish audit applies sold identity only to Japanese auctions", () => {
  const audit = readFileSync(new URL("../scripts/catalog-live-postpersist-audit.mjs", import.meta.url), "utf8");
  assert.match(audit, /catalogRequiredSpecificationRejectionReason, japanAuctionSoldIdentityVerified/);
  assert.match(audit, /rows\.filter\(\(offer\) => !japanAuctionSoldIdentityVerified\(offer\)\)/);
});

test("Japan public policy excludes inherited auction results without exact sold provenance", () => {
  assert.equal(japanAuctionSoldIdentityVerified(japanOffer("fixed")), true);
  assert.equal(japanAuctionSoldIdentityVerified(japanOffer("legacy-result", {
    sourceId: "prestige_japan_auctions_open",
    offerType: "fixed",
    catalogKind: "auction_result",
  })), false);
  assert.equal(japanAuctionSoldIdentityVerified(japanOffer("verified-result", {
    sourceId: "prestige_japan_auctions_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    auctionPriceKind: "published_result",
    operational: { raw: { listingBoundImages: true, photoIdentityVerified: true, recoveryExactSourceUrl: true, recoveryExactPhotoIdentity: true } },
  })), true);
});


test("Japan sold provenance survives compact public storage without retaining raw payloads", () => {
  const verified = japanOffer("verified-compact", {
    sourceId: "prestige_japan_auctions_open",
    offerType: "auction",
    catalogKind: "auction_result",
    auctionResult: "sold",
    auctionPriceKind: "published_result",
    images: [],
    operational: { raw: { listingBoundImages: true, photoIdentityVerified: true, recoveryExactSourceUrl: true, recoveryExactPhotoIdentity: true } },
  });
  const compact: any = compactPublicStorageOffer(verified);
  assert.equal(compact.operational.raw, undefined);
  assert.equal(compact.operational.publicJapanSoldIdentityVerified, true);
  assert.equal(japanAuctionSoldIdentityVerified(compact), true);
});
