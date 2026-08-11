import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { currentRegionalMarketSources } from "../apps/web/lib/catalog/current-regional-market-sources";
import { parseRegionalMassPage } from "../apps/web/lib/catalog/regional-live-overrides";

const importer = fs.readFileSync(new URL("../apps/web/lib/catalog/importer.ts", import.meta.url), "utf8");
const autoConfig = { sourceId: "auto_georgia_open", baseUrl: "https://www.auto.ge", fallbackCurrency: "USD" as const, detailPattern: /\/(?:en|ru|ka)\/auto\/[^?#]+-\d+\.html(?:[?#]|$)/i };
const mashinaConfig = { sourceId: "mashina_kyrgyzstan_exact", baseUrl: "https://www.mashina.kg", fallbackCurrency: "USD" as const, detailPattern: /\/(?:en\/)?details\/[^?#]+(?:[?#]|$)/i };

test("AUTO.GE listing card keeps price, identity and listing image", () => {
  const rows = parseRegionalMassPage('<article><a href="/en/auto/toyota/rav4/toyota-rav4-1240551.html"><img src="https://cdn.auto.ge/cars/rav4-1240551.jpg" alt="Toyota RAV4"><h3>Toyota RAV4 2021</h3></a><span>2021</span><strong>24,500.00 $</strong><span>62 000 km</span><span>2.5 L Hybrid</span></article>', "https://www.auto.ge/en/auto/index.html", autoConfig);
  assert.equal(rows.length, 1); assert.equal(rows[0].make, "Toyota"); assert.equal(rows[0].year, 2021); assert.equal(rows[0].price, 24_500); assert.equal(rows[0].currency, "USD"); assert.ok(rows[0].images.length > 0);
});

test("Mashina current card keeps price and details route", () => {
  const rows = parseRegionalMassPage('<article><a href="/details/toyota-rav4-69c3564a5c6a8272426281"><img src="https://cdn.mashina.kg/vehicle/rav4.jpg" alt="Toyota RAV4"><h3>Toyota RAV4</h3></a><span>$ 24 500</span><span>2019 г.</span><span>2.5 л.</span><span>170 000 км</span><span>гибрид</span></article>', "https://www.mashina.kg/en/search/", mashinaConfig);
  assert.equal(rows.length, 1); assert.equal(rows[0].make, "Toyota"); assert.equal(rows[0].model, "RAV4"); assert.equal(rows[0].year, 2019); assert.equal(rows[0].price, 24_500); assert.equal(rows[0].currency, "USD"); assert.match(rows[0].detailUrl, /\/details\/toyota-rav4-/);
});

test("production Mashina adapter probes current search routes", () => {
  const mashina = currentRegionalMarketSources.find((source) => source.sourceId === "mashina_kyrgyzstan_exact") as any;
  assert.ok(mashina); const urls = mashina.listUrls(3);
  assert.ok(urls.some((url: string) => url.includes("www.mashina.kg/en/search/?page=3")));
  assert.ok(urls.some((url: string) => url.includes("www.mashina.kg/search/?page=3")));
  assert.ok(urls.every((url: string) => !url.includes("/search/all/")));
});

test("strict regional adapters replace generic adapters", () => {
  const genericAt = importer.indexOf("...regionalLiveOverrides.map(prepareSource)");
  const exactAt = importer.indexOf("...exactMarketSources.map(prepareSource)");
  const currentAt = importer.indexOf("...currentRegionalMarketSources.map(prepareSource)");
  const autoGeAt = importer.indexOf("prepareSource(autoGeorgiaStrictSource)");
  const mashinaAt = importer.indexOf("prepareSource(mashinaKyrgyzstanListSource)");
  assert.ok(genericAt >= 0 && exactAt > genericAt && currentAt > exactAt && autoGeAt > currentAt && mashinaAt > autoGeAt);
});

test("production collection caps listing galleries at 30 photos", () => {
  assert.match(importer, /if \(process\.env\.CATALOG_REBUILD_MARKET \|\| rawListingMode\)/);
  assert.match(importer, /CATALOG_MAX_IMAGES_PER_OFFER \|\|= "30"/);
  assert.match(importer, /CATALOG_COLLECTION_IMAGE_LIMIT \|\|= "30"/);
  assert.match(importer, /maxImagesPerOffer: Math\.min\(30/);
});
