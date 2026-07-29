import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenMarketPage } from "../apps/web/lib/catalog/open-market-sources";

const autoConfig = {
  sourceId: "auto_georgia_open",
  market: "georgia" as const,
  label: "AUTO.GE",
  baseUrl: "https://www.auto.ge",
  currency: "USD",
  detailPattern: /\/(?:en|ru|ka)\/auto\/[^?#]+-\d+\.html(?:[?#]|$)/i,
  listUrls: () => [],
};

const mashinaConfig = {
  sourceId: "mashina_kyrgyzstan_exact",
  market: "kyrgyzstan" as const,
  label: "Mashina.kg",
  baseUrl: "https://www.mashina.kg",
  currency: "USD",
  detailPattern: /\/(?:en\/)?details\/[^?#]+(?:[?#]|$)/i,
  listUrls: () => [],
};

test("AUTO.GE homepage card keeps price, vehicle identity and listing image", () => {
  const rows = parseOpenMarketPage(`
    <article>
      <a href="/en/auto/toyota/rav4/toyota-rav4-1240551.html">
        <img src="https://cdn.auto.ge/cars/rav4-1240551.jpg" alt="Toyota RAV4" />
        <h3>Toyota RAV4 2021</h3>
      </a>
      <span>2021</span><strong>24,500.00 $</strong><span>62 000 km</span><span>2.5 L Hybrid</span>
    </article>`, autoConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Toyota");
  assert.equal(rows[0].year, 2021);
  assert.equal(rows[0].price, 24_500);
  assert.equal(rows[0].currency, "USD");
  assert.ok(rows[0].images.length > 0);
});

test("Mashina current card keeps dollar price and /details route", () => {
  const rows = parseOpenMarketPage(`
    <article>
      <a href="/details/toyota-rav4-69c3564a5c6a8272426281">
        <img src="https://cdn.mashina.kg/vehicle/rav4.jpg" alt="Toyota RAV4" />
        <h3>Toyota RAV4</h3>
      </a>
      <span>$ 24 500</span><span>2019 г.</span><span>2.5 л.</span><span>170 000 км</span><span>гибрид</span>
    </article>`, mashinaConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Toyota");
  assert.equal(rows[0].model, "RAV4");
  assert.equal(rows[0].year, 2019);
  assert.equal(rows[0].price, 24_500);
  assert.equal(rows[0].currency, "USD");
  assert.match(rows[0].detailUrl, /\/details\/toyota-rav4-/);
});
