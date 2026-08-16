import assert from "node:assert/strict";
import test from "node:test";
import { guaziChinaExactSource, listingEngineCc } from "../apps/web/lib/catalog/china-exact-sources";

test("Guazi listing identity recovers compact and decimal engine displacement", () => {
  assert.equal(listingEngineCc("https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html"), 1_400);
  assert.equal(listingEngineCc("Used BMW X1 2023 1.5L"), 1_500);
  assert.equal(listingEngineCc("https://en.guazi.com/products/buick-e4-2023-00l-white-40100km-at-2wd-5-seats-j3shshfxpy.html"), undefined);
});

test("Guazi exact normalized offer keeps listing-bound engine displacement", () => {
  const offer = guaziChinaExactSource.normalizeOffer({
    id: "skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz",
    detailUrl: "https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html",
    title: "Used Skoda Superb 2024",
    year: 2024,
    mileageKm: 5_699,
    price: 12_345,
    currency: "USD",
    listingText: "Used Skoda Superb 2024 5,699 km",
  });
  assert.ok(offer);
  assert.equal(offer?.sourceId, "guazi_china_open");
  assert.equal(offer?.engineCc, 1_400);
  assert.equal(offer?.operational?.sourceUrl, "https://en.guazi.com/products/skoda-superb-2024-14l-gray-5699km-at-2wd-5-seats-mg5wftcmmz.html");
});
