import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseDubicarsCurrentListing } from "../apps/web/lib/catalog/dubicars-current-source";
import { catalogPowerSanity, parseCatalogHorsepowerToken, publicCatalogPowerHp } from "../apps/web/lib/catalog/power-sanity";
import { normalizeVehicleOfferSpecs } from "../apps/web/lib/catalog/spec-normalization";

const page = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/page.tsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../apps/web/app/(public)/cars/offer/[id]/layout.tsx", import.meta.url), "utf8");
const presentation = fs.readFileSync(new URL("../apps/web/lib/catalog/presentation.ts", import.meta.url), "utf8");
const currentDubicars = fs.readFileSync(new URL("../apps/web/lib/catalog/dubicars-current-source.ts", import.meta.url), "utf8");
const exactDubicars = fs.readFileSync(new URL("../apps/web/lib/catalog/dubicars-exact-source.ts", import.meta.url), "utf8");

test("horsepower tokens keep thousands separators instead of truncating 1,997 to 997", () => {
  assert.equal(parseCatalogHorsepowerToken("Horsepower 1,997 HP"), 1997);
  assert.equal(parseCatalogHorsepowerToken("Horsepower 238 HP"), 238);
});

test("gross combustion power-density outliers fail closed for public display", () => {
  const suspect = { engineCc: 2000, fuel: "petrol", powertrainKind: "combustion", powerHp: 997 } as any;
  const result = catalogPowerSanity(suspect);
  assert.equal(result.suspicious, true);
  assert.equal(result.reason, "combustion_power_density_outlier");
  assert.equal(publicCatalogPowerHp(suspect), undefined);

  const normal = { engineCc: 2000, fuel: "petrol", powertrainKind: "combustion", powerHp: 238 } as any;
  assert.equal(publicCatalogPowerHp(normal), 238);
});

test("normalization removes a historical 997 hp marketplace typo and its derived kW", () => {
  const normalized = normalizeVehicleOfferSpecs({
    sourceId: "dubicars_uae_exact",
    market: "uae",
    make: "Lexus",
    model: "RX300",
    year: 2021,
    engineCc: 2000,
    fuel: "petrol",
    powertrainKind: "combustion",
    powerHp: 997,
    powerKw: 733.28,
    operational: { raw: { horsepower: "997 HP" } },
  } as any);
  assert.equal(normalized.powerHp, undefined);
  assert.equal(normalized.powerKw, undefined);
  assert.equal(normalized.operational?.powerSanity?.rejected, true);
});

test("DubiCars source typo 1,997 HP is retained as source reality but not published as vehicle power", () => {
  const markup = `
    <html><head><meta property="og:title" content="Lexus RX300 2.0 TURBO RIGHT HAND"></head><body>
    <h1>Lexus RX300 2.0 TURBO RIGHT HAND</h1>
    <section>Model year 2021 Make Lexus Model RX300 Trim Other Color Blue Engine capacity 2 L Cylinders 4 Cylinders Horsepower 1,997 HP Transmission Automatic Drive type Four Wheel Drive Vehicle type SUV/Crossover Fuel Type Petrol Kilometers 41,000 Km Updated on 22 Aug 2026</section>
    <img src="https://cdn.example.com/images/abcdef/w_1200x800/car/123e4567-e89b-12d3-a456-426614174000.jpg">
    <img src="https://cdn.example.com/images/abcdef/w_1200x800/car/223e4567-e89b-12d3-a456-426614174001.jpg">
    </body></html>`;
  const row = parseDubicarsCurrentListing(markup, "https://www.dubicars.com/2021-lexus-rx300-20-turbo-right-hand-952952.html");
  assert.ok(row);
  assert.equal(row?.make, "Lexus");
  assert.match(String(row?.model || ""), /RX300/i);
  assert.equal(row?.engineCc, 2000);
  assert.equal(row?.powerHp, undefined);
});

test("both DubiCars adapters use full-token horsepower parsing", () => {
  assert.match(currentDubicars, /parseCatalogHorsepowerToken/);
  assert.match(exactDubicars, /parseCatalogHorsepowerToken/);
  assert.doesNotMatch(currentDubicars, /Horsepower\\s\*\[:：\]\?\\s\*\(\[0-9\]\{2,4\}\)/);
});

test("offer detail renders crawlable factual specs and hides generic Other trim", () => {
  assert.match(page, /id="vehicle-facts-heading"/);
  assert.match(page, /Характеристики \{o\.makeLabel\} \{o\.modelLabel\}/);
  assert.match(page, /<dl className=/);
  assert.match(page, /readableFacts/);
  assert.match(page, /publicCatalogPowerHp\(raw\)/);
  assert.match(page, /сомнительные характеристики не публикуются как факт/);
  assert.match(page, /rel="nofollow noopener noreferrer"/);
  assert.match(presentation, /other\|другое\|прочее\|прочий/);
});

test("vehicle JSON-LD uses the same safe power contract", () => {
  assert.match(layout, /publicCatalogPowerHp\(offer\)/);
  assert.match(layout, /"@type": "EngineSpecification"/);
  assert.match(layout, /engineDisplacement/);
  assert.match(layout, /enginePower/);
  assert.match(layout, /bodyType:/);
  assert.match(layout, /driveWheelConfiguration:/);
});
