import assert from "node:assert/strict";
import test from "node:test";
import { GuaziRuAdapter, parseGuaziRuMarkup } from "../apps/web/lib/catalog/guazi-ru-source";
import "./catalog-yandex-source-bridge.test";

const markup = `
<section>
  <a href="/products/toyota-highlander-2011-27l-white-134200km-at-2wd-7-seats-uywhbkgqav.html">
    <img src="https://image-oversea.guazistatic-global.com/cars/highlander/main.webp" alt="Used Toyota Highlander 2011 2.7L Two-Wheel Drive 7-Seater Supreme Edition Guazi used car, China used car export">
  </a>
  <a href="/products/toyota-highlander-2011-27l-white-134200km-at-2wd-7-seats-uywhbkgqav.html">ОценкаBUsed Toyota Highlander 2011 2.7L Two-Wheel Drive 7-Seater Supreme Edition</a>
  <div>2011.11 134,200km Бензин Цена FOB$8,421</div>
  <a href="/products/buick-e4-2023-00l-white-40100km-at-2wd-5-seats-j3shshfxpy.html">
    <img src="https://global-image-pub.guazistatic-global.com/cars/e4/main.jpg" alt="Used Buick E4 2023 GS Edition Guazi used car, China used car export">
  </a>
  <a href="/products/buick-e4-2023-00l-white-40100km-at-2wd-5-seats-j3shshfxpy.html">Used Buick E4 2023 GS Edition</a>
  <div>2023.06 40,100km Полностью электромобиль Цена FOB$15,124</div>
  <a href="/products/foton-toano-2015-commercial-abc123def.html">
    <img src="https://image-oversea.guazistatic-global.com/cars/toano/main.jpg" alt="Used Foton Toano 2015 2.8T Commercial Version">
  </a>
  <a href="/products/foton-toano-2015-commercial-abc123def.html">Used Foton Toano 2015 2.8T Commercial Version</a>
  <div>2021.06 72,200km Дизель Цена FOB$5,856</div>
</section>`;

test("Guazi RU parser extracts passenger offers from current product routes", () => {
  const rows = parseGuaziRuMarkup(markup, "https://ru.guazi.com/used-cars/");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => `${row.make} ${row.model}`), ["Toyota Highlander", "Buick E4"]);
  assert.equal(rows[0].price, 8_421);
  assert.equal(rows[0].mileageKm, 134_200);
  assert.equal(rows[0].engineCc, 2_700);
  assert.equal(rows[0].productionDate, "2011-11");
  assert.equal(rows[1].fuel, "Electric");
});

test("Guazi RU normalized offer keeps USD FOB price and listing-bound photo", () => {
  const adapter = new GuaziRuAdapter();
  const row = parseGuaziRuMarkup(markup, "https://ru.guazi.com/used-cars/")[0];
  const offer = adapter.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.sourceId, "guazi_china_ru");
  assert.equal(offer?.market, "china");
  assert.equal(offer?.sourceCurrency, "USD");
  assert.equal(offer?.sourcePrice, 8_421);
  assert.equal(offer?.make, "Toyota");
  assert.equal(offer?.model, "Highlander");
  assert.match(String(offer?.operational?.sourceUrl), /\/products\/toyota-highlander/);
  assert.equal((offer?.operational?.raw as any)?.images?.length, 1);
});
