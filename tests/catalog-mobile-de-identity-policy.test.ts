import assert from "node:assert/strict";
import test from "node:test";
import {
  MobileDeExactAdapter,
  mobileDeBodyEvidence,
  mobileDeSpecificationEvidence,
} from "../apps/web/lib/catalog/mobile-de-exact-source";
import { catalogSemanticEvidenceRejectionReason } from "../apps/web/lib/catalog/offer-quality";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new MobileDeExactAdapter();
const base = {
  id: "462337527",
  sourceUrl: "https://suchen.mobile.de/fahrzeuge/details.html?id=462337527",
  title: "Volkswagen Taigo 1.0 TSI",
  make: "Volkswagen",
  model: "Taigo",
  year: 2025,
  mileageKm: 12000,
  price: 23990,
  currency: "EUR",
  raw: {},
};

test("Mobile.de accepts a current listing with explicit make and model identity", () => {
  const offer = source.normalizeOffer(base);
  assert.ok(offer);
  assert.equal(offer!.make, "Volkswagen");
  assert.equal(offer!.model, "Taigo");
});

test("Mobile.de SRP preserves exact fuel, engine and power provenance", () => {
  const offer = source.normalizeOffer({
    ...base,
    engineCc: 999,
    powerKw: 110,
    powerHp: 150,
    fuel: "Benzin",
  });
  assert.ok(offer);
  assert.equal(offer!.fuel, "petrol");
  assert.equal(offer!.powertrainKind, "combustion");
  assert.equal(
    classifySpecificationEvidence(offer!, "fuelPowertrain").state,
    "exact",
  );
  assert.equal(
    classifySpecificationEvidence(offer!, "engineCc").state,
    "exact",
  );
  assert.equal(classifySpecificationEvidence(offer!, "powerHp").state, "exact");
});

test("Mobile.de evidence tolerates only equivalent PS and kW rounding", () => {
  assert.equal(
    mobileDeSpecificationEvidence({ listingPowerHp: 150, detailPowerHp: 149.6 })
      .powerHp.status,
    "exact",
  );
  assert.equal(
    mobileDeSpecificationEvidence({ listingPowerHp: 150, detailPowerHp: 180 })
      .powerHp.status,
    "conflict",
  );
  assert.equal(
    mobileDeSpecificationEvidence({
      listingEngineCc: 999,
      detailEngineCc: 1498,
    }).engineCc.status,
    "conflict",
  );
  assert.equal(
    mobileDeSpecificationEvidence({
      listingFuel: "Benzin",
      detailFuel: "Diesel",
    }).fuel.status,
    "conflict",
  );
});

test("Mobile.de never treats the ambiguous Limousine bucket as an exact sedan body", () => {
  assert.deepEqual(mobileDeBodyEvidence(["Limousine"]), {
    rawValues: ["Limousine"],
    status: "ambiguous",
  });
  assert.equal(mobileDeBodyEvidence(["Cabrio", "Cabrio"]).value, "convertible");
  assert.equal(mobileDeBodyEvidence(["SUV", "Coupé"]).status, "conflict");

  const offer = source.normalizeOffer({
    ...base,
    bodyType: "Limousine",
    bodyEvidence: mobileDeBodyEvidence(["Limousine"]),
  });
  assert.ok(offer);
  assert.equal(offer!.bodyType, undefined);
  assert.equal(
    (offer!.operational as any).semanticEvidence.bodyType.status,
    "ambiguous",
  );
});

function vipAd(overrides: Record<string, unknown> = {}) {
  return {
    id: base.id,
    price: { grossAmount: base.price },
    makeKey: base.make,
    modelKey: base.model,
    title: base.title,
    attributes: [
      { tag: "power", value: "110 kW (150 PS)" },
      { tag: "firstRegistration", value: "01/2025" },
      { tag: "mileage", value: "12,000 km" },
      { tag: "cubicCapacity", value: "999 cm³" },
      { tag: "fuel", value: "Benzin" },
      { tag: "transmission", value: "Automatik" },
      { tag: "category", value: "SUV" },
    ],
    galleryImages: Array.from({ length: 5 }, (_, index) => ({
      src: `https://img.classistatic.de/api/v1/mo-prod/images/mobile-test-${index}`,
    })),
    ...overrides,
  };
}

test("Mobile.de VIP keeps agreeing listing-bound specification evidence", async () => {
  const offer = source.normalizeOffer({
    ...base,
    engineCc: 999,
    powerKw: 110,
    powerHp: 150,
    fuel: "Benzin",
  });
  assert.ok(offer);
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ ad: vipAd() }), {
      headers: { "content-type": "application/json" },
    });
  try {
    const images = await source.fetchImages(offer!);
    assert.equal(images.length, 5);
    assert.equal(offer!.engineCc, 999);
    assert.equal(offer!.powerHp, 150);
    assert.equal(offer!.fuel, "petrol");
    assert.equal(
      (offer!.operational as any).semanticEvidence.engineCc.status,
      "exact",
    );
    assert.equal(catalogSemanticEvidenceRejectionReason(offer!), "");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Mobile.de VIP conflicts clear calculation fields and fail closed", async () => {
  const offer = source.normalizeOffer({
    ...base,
    engineCc: 999,
    powerKw: 110,
    powerHp: 150,
    fuel: "Benzin",
  });
  assert.ok(offer);
  const conflicting = vipAd({
    attributes: [
      { tag: "power", value: "132 kW (180 PS)" },
      { tag: "firstRegistration", value: "01/2025" },
      { tag: "cubicCapacity", value: "1,498 cm³" },
      { tag: "fuel", value: "Diesel" },
    ],
  });
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(JSON.stringify({ ad: conflicting }), {
      headers: { "content-type": "application/json" },
    });
  try {
    await source.fetchImages(offer!);
    assert.equal(offer!.engineCc, undefined);
    assert.equal(offer!.powerHp, undefined);
    assert.equal(offer!.powerKw, undefined);
    assert.equal(offer!.fuel, undefined);
    assert.equal(offer!.powertrainKind, "unknown");
    assert.equal(offer!.calculationStatus, "needs_data");
    assert.equal(
      (offer!.operational as any).semanticEvidence.fuel.status,
      "conflict",
    );
    assert.equal(
      (offer!.operational as any).semanticEvidence.engineCc.status,
      "conflict",
    );
    assert.equal(
      (offer!.operational as any).semanticEvidence.powerHp.status,
      "conflict",
    );
    assert.equal(
      catalogSemanticEvidenceRejectionReason(offer!),
      "semantic_fuel_conflict",
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("Mobile.de rejects source placeholder identity instead of inferring a model from the title", () => {
  assert.equal(source.normalizeOffer({ ...base, model: "Andere" }), null);
  assert.equal(
    source.normalizeOffer({ ...base, make: "Andere", model: "L5E" }),
    null,
  );
});

test("Mobile.de enforces the non-Japan 2020 minimum at collector normalization", () => {
  assert.equal(source.normalizeOffer({ ...base, year: 2019 }), null);
  assert.ok(source.normalizeOffer({ ...base, year: 2020 }));
});
