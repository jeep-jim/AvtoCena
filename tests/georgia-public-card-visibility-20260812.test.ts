import assert from "node:assert/strict";
import test from "node:test";
import { hasCredibleOfferContent, isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";

function georgiaOffer(sourceId?: string) {
  return {
    id: "georgia-visible-card",
    sourceId,
    sourceOfferId: "122793623",
    market: "georgia",
    offerType: "fixed",
    status: "active",
    make: "Tesla",
    model: "Model 3",
    year: 2020,
    sourcePrice: 32820,
    sourceCurrency: "GEL",
    images: [{
      id: "",
      url: "https://static.tnet.ge/myauto/photos/2/6/3/9/7/large/122793623_1.jpg?v=3",
      objectKey: "",
      checksum: "",
      size: 0,
      mimeType: "image/jpeg",
    }],
    totalRub: 2068397,
    calculationStatus: "preliminary_power_pending",
    firstSeenAt: "2026-08-12T12:52:08.733Z",
    updatedAt: "2026-08-12T12:52:08.733Z",
    cardProjectionVersion: 1,
    operational: {
      sourceUrl: "https://myauto.ge/en/pr/122793623/for-sale-sedan-tesla-model-3-2020-electric-geo",
      raw: { listingBoundImages: true },
    },
  } as any;
}

test("server-vetted Georgia public DTO remains visible after sourceId is omitted", () => {
  const dto = georgiaOffer();
  assert.equal(dto.sourceId, undefined);
  assert.equal(isCrediblePublicOffer(dto), true);
});

test("server-side full offer validation still enforces Georgia canonical sources", () => {
  assert.equal(hasCredibleOfferContent(georgiaOffer("myauto_georgia_list")), true);
  assert.equal(hasCredibleOfferContent(georgiaOffer("auto_georgia_open")), false);
});
