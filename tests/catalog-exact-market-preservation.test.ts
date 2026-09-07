import assert from "node:assert/strict";
import test from "node:test";
import { persistCatalogOffers } from "../apps/web/lib/catalog/storage";

test("an untouched market survives final quota and duplicate filtering byte-for-byte", async () => {
  // A previous generation can exceed today's quota and contain duplicate offers.
  // Its own refresh must handle those; another market's refresh must preserve it.
  const rows: any[] = Array.from({ length: 25 }, (_, index) => ({
    id: `preserved-${index}`, market: "korea", sourceId: "encar_direct",
    sourceOfferId: "12345678", make: "Hyundai", model: "Avante", year: 2021,
    status: "active", sourcePrice: 18000000, sourceCurrency: "KRW",
    mileageKm: 61000, engineCc: 1598, powerHp: 123, fuel: "petrol",
    transmission: "automatic", drive: "fwd", bodyType: "sedan",
    images: [{ url: "https://ci.encar.com/carpicture/2026/09/07/12345678/001.jpg" }],
    operational: { sourceUrl: "https://www.encar.com/dc/dc_cardetailview.do?carid=12345678" },
  }));
  const snapshot = JSON.stringify(rows);
  const stop = new Error("verified_before_storage_write");
  let checked = false;
  await assert.rejects(persistCatalogOffers(rows, {
    preservePublicOffersByMarket: { korea: rows },
    beforePersistValidate(actual) { assert.equal(JSON.stringify(actual), snapshot); },
    beforePublishValidate(actual) {
      assert.equal(JSON.stringify(actual), snapshot);
      checked = true;
      throw stop;
    },
  }), (error) => error === stop);
  assert.equal(checked, true);
  assert.equal(JSON.stringify(rows), snapshot);
});
