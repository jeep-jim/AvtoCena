import assert from "node:assert/strict";
import test from "node:test";
import {
  MobileDeExactAdapter,
  mobileDeBodyEvidence,
  mobileDeSpecificationEvidence,
} from "../apps/web/lib/catalog/mobile-de-exact-source";
import { catalogSemanticEvidenceRejectionReason, isCrediblePublicOffer } from "../apps/web/lib/catalog/offer-quality";
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

test("saved Mobile.de normalization retains explicit make and model identity", () => {
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

test("saved Mobile.de listing and VIP specifications preserve agreeing exact evidence", () => {
  const evidence = mobileDeSpecificationEvidence({
    listingEngineCc: 999, detailEngineCc: 999,
    listingPowerHp: 150, detailPowerHp: 150,
    listingFuel: "Benzin", detailFuel: "Benzin",
  });
  assert.deepEqual(evidence.engineCc, {value: 999, rawValues: [999, 999], status: "exact"});
  assert.deepEqual(evidence.powerHp, {value: 150, rawValues: [150, 150], status: "exact"});
  assert.deepEqual(evidence.fuel, {value: "petrol", rawValues: ["Benzin"], status: "exact"});
  assert.equal(catalogSemanticEvidenceRejectionReason({operational: {semanticEvidence: evidence}}), "");
});

test("saved Mobile.de VIP conflicts retain both observations and cannot become exact calculation inputs", () => {
  const evidence = mobileDeSpecificationEvidence({
    listingEngineCc: 999, detailEngineCc: 1498,
    listingPowerHp: 150, detailPowerHp: 180,
    listingFuel: "Benzin", detailFuel: "Diesel",
  });
  assert.deepEqual(evidence.engineCc, {rawValues: [999, 1498], status: "conflict"});
  assert.deepEqual(evidence.powerHp, {rawValues: [150, 180], status: "conflict"});
  assert.deepEqual(evidence.fuel, {rawValues: ["Benzin", "Diesel"], status: "conflict"});
  assert.equal(evidence.engineCc.value, undefined);
  assert.equal(evidence.powerHp.value, undefined);
  assert.equal(evidence.fuel.value, undefined);
  assert.equal(catalogSemanticEvidenceRejectionReason({operational: {semanticEvidence: evidence}}), "semantic_fuel_conflict");
});

test("disabled Mobile.de VIP rejects before fetch and preserves the saved listing unchanged", async () => {
  const offer = source.normalizeOffer({...base, engineCc: 999, powerKw: 110, powerHp: 150, fuel: "Benzin"});
  assert.ok(offer);
  const before = structuredClone(offer), originalFetch = global.fetch;
  let requests = 0;
  global.fetch = async () => { requests++; throw new Error("unexpected_mobile_de_request"); };
  try {
    await assert.rejects(source.fetchImages(offer!), {
      name: "CollectionDisabledError", message: "collection_disabled_by_owner:mobile_de_open",
    });
    assert.equal(requests, 0);
    assert.deepEqual(offer, before);
    assert.equal(isCrediblePublicOffer(offer!), false);
  } finally { global.fetch = originalFetch; }
});

test("Mobile.de rejects source placeholder identity instead of inferring a model from the title", () => {
  assert.equal(source.normalizeOffer({ ...base, model: "Andere" }), null);
  assert.equal(
    source.normalizeOffer({ ...base, make: "Andere", model: "L5E" }),
    null,
  );
});

test("saved Mobile.de normalization enforces the Europe 2022 minimum without allowing publication", () => {
  for (const year of [2019, 2020, 2021]) assert.equal(source.normalizeOffer({ ...base, year }), null);
  const offer = source.normalizeOffer({ ...base, year: 2022 });
  assert.ok(offer);
  assert.equal(isCrediblePublicOffer(offer!), false);
});


test("Mobile.de VIP category plus sale condition agrees with the SRP OffRoad bucket", () => {
  const evidence = mobileDeBodyEvidence(["OffRoad", "SUV/Geländewagen/Pickup, Jahreswagen"]);
  assert.equal(evidence.status, "exact");
  assert.equal(evidence.value, "offroad");
  assert.deepEqual(evidence.rawValues, ["OffRoad", "SUV/Geländewagen/Pickup, Jahreswagen"]);
  assert.equal(mobileDeBodyEvidence(["Cabrio", "Cabrio, Gebrauchtfahrzeug"]).value, "convertible");
  assert.equal(mobileDeBodyEvidence(["Van", "Van/Minibus, Tageszulassung"]).value, "van");
  assert.equal(mobileDeBodyEvidence(["EstateCar", "Kombi, Jahreswagen"]).value, "wagon");
  assert.equal(mobileDeBodyEvidence(["OffRoad", "Coupé, Neufahrzeug"]).status, "conflict");
  assert.equal(mobileDeBodyEvidence(["Limousine, Gebrauchtfahrzeug"]).status, "ambiguous");
  assert.equal(mobileDeBodyEvidence(["SUV/Geländewagen/Pickup, unknown"]).status, "ambiguous");
});


test("unassigned optional body does not discard an otherwise credible car; invented bodies and pricing ambiguity still fail", () => {
  const offer = source.normalizeOffer({ ...base, bodyType: undefined, bodyEvidence: mobileDeBodyEvidence(["Limousine"]) })!;
  offer.images = Array.from({ length: 5 }, (_, index) => ({ id: "", url: `https://img.classistatic.de/api/v1/mo-prod/images/body-test-${index}.jpg`, mimeType: "image/jpeg", size: 0 }));
  assert.equal(offer.bodyType, undefined);
  assert.equal(catalogSemanticEvidenceRejectionReason(offer), "");
  assert.equal(isCrediblePublicOffer(offer), false, "saved Mobile.de rows stay excluded from publication");
  const approved = {...offer, sourceId: "autoscout_europe_open", operational: {...offer.operational,
    sourceUrl: "https://www.autoscout24.com/offers/fixture-body-1"}};
  assert.equal(isCrediblePublicOffer(approved), true);
  assert.equal(isCrediblePublicOffer({ ...approved, bodyType: "sedan" }), false);
  const contradiction = structuredClone(approved);
  (contradiction.operational as any).semanticEvidence.bodyType.status = "conflict";
  assert.equal(isCrediblePublicOffer(contradiction), false);
  const missingSpecs = structuredClone(approved);
  (missingSpecs.operational as any).semanticEvidence.engineCc.status = "ambiguous";
  assert.equal(isCrediblePublicOffer(missingSpecs), false);
});
