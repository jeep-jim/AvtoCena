import assert from "node:assert/strict";
import test from "node:test";
import { autoGeorgiaImageBelongsToListing, parseAutoGeorgiaStrictListing } from "../apps/web/lib/catalog/auto-georgia-strict-source";

const pageUrl = "https://www.auto.ge/en/auto/index.html";

function fixture(price: string, currency: "$" | "₾") {
  return `
  <html><body>
    <a href="/en/auto/toyota/rav4/toyota-rav4-1172033.html">Toyota, RAV4</a>
    <div>Sale 2024 966 km ${price} ${currency}</div>
    <img src="https://img.auto.ge/cars/1172033/1.jpg" />
  </body></html>`;
}

test("AUTO.GE USD prices keep cents as decimals instead of multiplying by 100", () => {
  const rows = parseAutoGeorgiaStrictListing(fixture("14,000.00", "$"), pageUrl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 14_000);
  assert.equal(rows[0].currency, "USD");
});

test("AUTO.GE grouping separators without cents still parse as whole currency", () => {
  const rows = parseAutoGeorgiaStrictListing(fixture("19,800", "$"), pageUrl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 19_800);
});

test("AUTO.GE GEL decimal prices parse to whole GEL", () => {
  const rows = parseAutoGeorgiaStrictListing(fixture("55,500.00", "₾"), pageUrl);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].price, 55_500);
  assert.equal(rows[0].currency, "GEL");
});

test("AUTO.GE listing-bound gallery accepts only image paths carrying the exact listing id", () => {
  const matching = "https://static.auto.ge/media/ad1172033/photos/1.jpg";
  const foreign = "https://static.auto.ge/media/ad999999/photos/2.jpg";
  assert.equal(autoGeorgiaImageBelongsToListing(matching, "1172033"), true);
  assert.equal(autoGeorgiaImageBelongsToListing(foreign, "1172033"), false);

  const markup = `
    <html><body>
      <a href="/en/auto/toyota/rav4/toyota-rav4-1172033.html">Toyota, RAV4</a>
      <div>Sale 2024 966 km 14,000.00 $</div>
      <img src="${matching}" />
      <img src="${foreign}" />
    </body></html>`;
  const rows = parseAutoGeorgiaStrictListing(markup, pageUrl);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].images, [matching]);
});
