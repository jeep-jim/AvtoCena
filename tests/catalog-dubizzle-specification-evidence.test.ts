import assert from "node:assert/strict";
import test from "node:test";
import {
  DubizzleUaeExactAdapter,
  dubizzleSpecificationEvidence,
  parseDubizzleAlgoliaHit,
  parseDubizzleLabelBoundDetailFields,
} from "../apps/web/lib/catalog/dubizzle-exact-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new DubizzleUaeExactAdapter();
const uuid = "0123456789abcdef0123456789abcdef";
const url = `https://uae.dubizzle.com/en/motors/used-cars/toyota/camry/2026/9/1/exact-car---${uuid}/`;

function hit(overrides: Record<string, unknown> = {}) {
  return {
    uuid,
    price: 120_000,
    name: { en: "Toyota Camry 2.5" },
    absolute_url: { en: url },
    photo_thumbnails: Array.from({ length: 5 }, (_, index) => `https://dbz-images.dubizzle.com/images/camry-${index}.jpg`),
    category: { en: ["Used Cars", "Toyota", "Camry"] },
    details: {
      Make: { en: { value: "Toyota" } },
      Model: { en: { value: "Camry" } },
      Year: { en: { value: "2024" } },
      "Fuel Type": { en: { value: "Petrol" } },
      "Engine Capacity (cc)": { en: { value: "2498 cc" } },
      Horsepower: { en: { value: "204 hp" } },
    },
    ...overrides,
  };
}

test("Dubizzle Algolia promotes only exact named specification values", () => {
  const row = parseDubizzleAlgoliaHit(hit());
  assert.ok(row);
  assert.equal(row.engineCc, 2498);
  assert.equal(row.powerHp, 204);
  assert.equal(row.fuel, "petrol");
  assert.equal(row.semanticEvidence?.year.status, "exact");
  assert.equal(row.semanticEvidence?.fuel.status, "exact");
  assert.equal(row.semanticEvidence?.engineCc.status, "exact");
  assert.equal(row.semanticEvidence?.powerHp.status, "exact");

  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
});

test("Dubizzle never promotes ranges or unknown fuel", () => {
  const evidence = dubizzleSpecificationEvidence({
    year: "2024",
    fuel: "Other / unknown",
    engineCc: "0 - 1,499 cc",
    powerHp: "50 - 99 hp",
  });
  assert.equal(evidence.fuel.status, "ambiguous");
  assert.equal(evidence.engineCc.status, "ambiguous");
  assert.equal(evidence.powerHp.status, "ambiguous");
  assert.equal(evidence.engineCc.value, undefined);
  assert.equal(evidence.powerHp.value, undefined);

  const fields = parseDubizzleLabelBoundDetailFields(
    "<h2>Car Overview</h2><div>Fuel Type Other / unknown Engine Capacity 0 - 1,499 cc Horsepower 50 - 99 hp</div><h2>Description</h2>",
  );
  assert.equal(fields.engineCc, undefined);
  assert.equal(fields.powerHp, undefined);
  assert.equal(fields.semanticEvidence?.fuel.status, "ambiguous");
});

test("Dubizzle listing/detail conflicts clear calculation fields", async () => {
  const row = parseDubizzleAlgoliaHit(hit());
  assert.ok(row);
  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(
    "<h2>Car Overview</h2><div>Fuel Type Diesel Engine Capacity 2998 cc Horsepower 300 hp</div><h2>Description</h2>",
    { status: 200, headers: { "content-type": "text/html" } },
  );
  try {
    const images = await source.fetchImages(offer);
    assert.equal(images.length, 5);
    assert.equal(offer.fuel, undefined);
    assert.equal(offer.powertrainKind, "unknown");
    assert.equal(offer.engineCc, undefined);
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.powerKw, undefined);
    assert.equal(offer.powerDataConfidence, undefined);
    assert.equal((offer.operational as any).semanticEvidence.fuel.status, "conflict");
    assert.equal((offer.operational as any).semanticEvidence.engineCc.status, "conflict");
    assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "conflict");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Dubizzle electric fuel conflicts with a non-zero displacement", () => {
  const evidence = dubizzleSpecificationEvidence({ fuel: "Electric", engineCc: "1998 cc" });
  assert.equal(evidence.fuel.status, "exact");
  assert.equal(evidence.fuel.value, "electric");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.engineCc.value, undefined);
});
