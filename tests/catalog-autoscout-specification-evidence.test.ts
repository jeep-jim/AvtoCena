import assert from "node:assert/strict";
import test from "node:test";
import {
  AutoScoutEuropeExactAdapter,
  autoScoutSpecificationEvidence,
  autoscoutEuropeExactSource,
  parseAutoScoutNextData,
} from "../apps/web/lib/catalog/autoscout-exact-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new AutoScoutEuropeExactAdapter();
const id = "e69f4836-88ed-4c84-b8ae-034e73c485c7";

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id,
    url: `/offers/volvo-xc60-petrol-${id}`,
    vehicle: { make: "Volvo", model: "XC60", engineDisplacementInCCM: "1,969", fuel: "Gasoline" },
    tracking: { firstRegistration: "06/2024", mileage: "12,000 km" },
    price: { priceRaw: 45_000, currency: "EUR" },
    vehicleDetails: [
      { ariaLabel: "First registration", data: "06/2024" },
      { ariaLabel: "Fuel type", data: "Gasoline" },
      { ariaLabel: "Power", data: "150 kW (204 hp)" },
    ],
    images: Array.from({ length: 5 }, (_, index) => `https://prod.pictures.autoscout24.net/listing-images/${id}_${index}.jpg/250x188.webp`),
    ...overrides,
  };
}

function page(value: Record<string, unknown>) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { listings: [value], currency: "EUR" } } })}</script>`;
}

test("AutoScout promotes only mutually consistent named exact specification values", () => {
  const rows = parseAutoScoutNextData(page(listing()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].year, 2024);
  assert.equal(rows[0].fuel, "petrol");
  assert.equal(rows[0].engineCc, 1969);
  assert.equal(rows[0].powerKw, 150);
  assert.equal(rows[0].powerHp, 204);
  assert.equal(rows[0].semanticEvidence?.powerKw.status, "exact");
  assert.equal(rows[0].semanticEvidence?.powerHp.status, "exact");

  const offer = source.normalizeOffer(rows[0]);
  assert.ok(offer);
  assert.equal(offer.powertrainKind, "combustion");
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal(classifySpecificationEvidence(offer, "year").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");

  const productionOffer = autoscoutEuropeExactSource.normalizeOffer(rows[0]);
  assert.ok(productionOffer);
  assert.equal((productionOffer.operational as any).semanticEvidence.powerHp.status, "exact");
});

test("AutoScout rejects inconsistent kW and hp instead of selecting both independently", () => {
  const rows = parseAutoScoutNextData(page(listing({
    vehicleDetails: [
      { ariaLabel: "First registration", data: "06/2024" },
      { ariaLabel: "Fuel type", data: "Gasoline" },
      { ariaLabel: "Power", data: "150 kW (300 hp)" },
    ],
  })));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].powerKw, undefined);
  assert.equal(rows[0].powerHp, undefined);
  assert.equal(rows[0].semanticEvidence?.powerKw.status, "conflict");
  assert.equal(rows[0].semanticEvidence?.powerHp.status, "conflict");
  const offer = source.normalizeOffer(rows[0]);
  assert.ok(offer);
  assert.equal(offer.powerDataConfidence, undefined);
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "conflict");
});

test("AutoScout does not concatenate displacement or power ranges", () => {
  const evidence = autoScoutSpecificationEvidence({
    firstRegistrations: ["2024"],
    fuels: ["Gasoline"],
    engineDisplacementsCcm: ["1,500 - 1,999 ccm"],
    power: ["100-150 kW / 136-204 hp"],
  });
  assert.equal(evidence.engineCc.status, "ambiguous");
  assert.equal(evidence.engineCc.value, undefined);
  assert.equal(evidence.powerKw.status, "ambiguous");
  assert.equal(evidence.powerHp.status, "ambiguous");
});

test("AutoScout marks distinct repeated named values as conflicts", () => {
  const evidence = autoScoutSpecificationEvidence({
    firstRegistrations: ["2024", "2023"],
    fuels: ["Gasoline", "Diesel"],
    engineDisplacementsCcm: ["1,498 ccm", "1,998 ccm"],
    power: ["110 kW (150 hp)", "140 kW (190 hp)"],
  });
  assert.equal(evidence.year.status, "conflict");
  assert.equal(evidence.fuel.status, "conflict");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.powerKw.status, "conflict");
  assert.equal(evidence.powerHp.status, "conflict");
});

test("AutoScout keeps unknown named fuel non-exact", () => {
  const evidence = autoScoutSpecificationEvidence({ firstRegistrations: ["2024"], fuels: ["Other / unknown"] });
  assert.equal(evidence.fuel.status, "ambiguous");
  assert.equal(evidence.fuel.value, undefined);
});

test("AutoScout marks a non-zero engine displacement on a pure EV as conflict", () => {
  const evidence = autoScoutSpecificationEvidence({
    firstRegistrations: ["2024"],
    fuels: ["Electric"],
    engineDisplacementsCcm: ["1,998"],
  });
  assert.equal(evidence.fuel.status, "exact");
  assert.equal(evidence.fuel.value, "electric");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.engineCc.value, undefined);
});

test("AutoScout URL identity may prove only an unambiguous pure-electric fuel", () => {
  const exact = autoScoutSpecificationEvidence({
    firstRegistrations: ["2025"],
    sourceUrl: `https://www.autoscout24.com/offers/volvo-ex90-electric-${id}`,
  });
  const hybrid = autoScoutSpecificationEvidence({
    firstRegistrations: ["2025"],
    sourceUrl: `https://www.autoscout24.com/offers/volvo-xc60-electric-hybrid-${id}`,
  });
  assert.equal(exact.fuel.status, "exact");
  assert.equal(exact.fuel.value, "electric");
  assert.equal(hybrid.fuel.status, "missing");
});
