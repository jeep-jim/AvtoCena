import assert from "node:assert/strict";
import test from "node:test";
import { parseRegionalMassPage } from "../apps/web/lib/catalog/regional-live-overrides";

const autoConfig = {
  sourceId: "auto_georgia_open",
  baseUrl: "https://www.auto.ge",
  fallbackCurrency: "USD" as const,
  detailPattern: /\/(?:en|ru|ka)\/auto\/[^?#]+-\d+\.html(?:[?#]|$)/i,
};

const mashinaConfig = {
  sourceId: "mashina_kyrgyzstan_exact",
  baseUrl: "https://www.mashina.kg",
  fallbackCurrency: "USD" as const,
  detailPattern: /\/(?:en\/)?details\/[^?#]+(?:[?#]|$)/i,
};

test("AUTO.GE homepage card keeps price, vehicle identity and listing image", () => {
  const rows = parseRegionalMassPage(`
    <article>
      <a href="/en/auto/toyota/rav4/toyota-rav4-1240551.html">
        <img src="https://cdn.auto.ge/cars/rav4-1240551.jpg" alt="Toyota RAV4" />
        <h3>Toyota RAV4 2021</h3>
      </a>
      <span>2021</span><strong>24,500.00 $</strong><span>62 000 km</span><span>2.5 L Hybrid</span>
    </article>`, "https://www.auto.ge/en/index.html", autoConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Toyota");
  assert.equal(rows[0].year, 2021);
  assert.equal(rows[0].price, 24_500);
  assert.equal(rows[0].currency, "USD");
  assert.ok(rows[0].images.length > 0);
});

test("Mashina current card keeps dollar price and /details route", () => {
  const rows = parseRegionalMassPage(`
    <article>
      <a href="/details/toyota-rav4-69c3564a5c6a8272426281">
        <img src="https://cdn.mashina.kg/vehicle/rav4.jpg" alt="Toyota RAV4" />
        <h3>Toyota RAV4</h3>
      </a>
      <span>$ 24 500</span><span>2019 г.</span><span>2.5 л.</span><span>170 000 км</span><span>гибрид</span>
    </article>`, "https://www.mashina.kg/search/all/", mashinaConfig);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].make, "Toyota");
  assert.equal(rows[0].model, "RAV4");
  assert.equal(rows[0].year, 2019);
  assert.equal(rows[0].price, 24_500);
  assert.equal(rows[0].currency, "USD");
  assert.match(rows[0].detailUrl, /\/details\/toyota-rav4-/);
});
