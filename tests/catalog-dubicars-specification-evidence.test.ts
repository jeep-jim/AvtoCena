import assert from "node:assert/strict";
import test from "node:test";
import {
  DubicarsCurrentAdapter,
  dubicarsSpecificationEvidence,
  parseDubicarsCurrentListing,
} from "../apps/web/lib/catalog/dubicars-current-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new DubicarsCurrentAdapter();
const url = "https://www.dubicars.com/2024-toyota-camry-v6-1000265.html";
const gallery = Array.from({ length: 5 }, (_, index) =>
  `<img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/${index + 1}2345678-abcd-1234-abcd-123456789abc.jpg" />`,
).join("\n");

function detail(specifications: string, after = "") {
  return `<h1>Toyota Camry V6 3.5L</h1>
    <div>AED 145,000</div>
    <section>Model year 2024 ${specifications}
      Make Toyota Model Camry Trim V6 Transmission Automatic Drive type Front Wheel Drive
      Vehicle type Sedan Color White Service history Yes</section>
    ${after}
    ${gallery}`;
}

test("DubiCars promotes exact values only from the bounded specification block", () => {
  const row = parseDubicarsCurrentListing(
    detail(
      "Kilometers 12,000 Km Engine capacity 3.5 L Horsepower 301 HP Fuel Type Petrol",
      "<h2>Similar cars</h2><div>Engine capacity 5.6 L Horsepower 400 HP Fuel Type Diesel</div>",
    ),
    url,
  );
  assert.ok(row);
  assert.equal(row.engineCc, 3500);
  assert.equal(row.powerHp, 301);
  assert.equal(row.fuel, "petrol");
  assert.equal(row.semanticEvidence?.year.status, "exact");
  assert.equal(row.semanticEvidence?.engineCc.status, "exact");
  assert.equal(row.semanticEvidence?.powerHp.status, "exact");
  assert.equal(row.semanticEvidence?.fuel.status, "exact");

  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.calculationStatus, "needs_data");
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
});

test("DubiCars ranges, unknown fuel, and implausible power stay non-exact", () => {
  const evidence = dubicarsSpecificationEvidence({
    pageYear: 2024,
    urlYear: 2024,
    fuel: "Other / unknown",
    engine: "1.5 - 2.0 L",
    power: "1,997 HP",
  });
  assert.equal(evidence.fuel.status, "ambiguous");
  assert.equal(evidence.engineCc.status, "ambiguous");
  assert.equal(evidence.powerHp.status, "ambiguous");
  assert.equal(evidence.engineCc.value, undefined);
  assert.equal(evidence.powerHp.value, undefined);
});

test("DubiCars detects conflicting repeated named values", () => {
  const evidence = dubicarsSpecificationEvidence({
    pageYear: 2024,
    urlYear: 2024,
    fuel: ["Petrol", "Diesel"],
    engine: ["1998 cc", "2498 cc"],
    power: ["200 HP", "250 HP"],
  });
  assert.equal(evidence.fuel.status, "conflict");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.powerHp.status, "conflict");
});

test("DubiCars title numbers cannot reappear through generic normalization", () => {
  const row = parseDubicarsCurrentListing(`<h1>Toyota Highlander 2.5L AWD 248 HP</h1><div>AED 148,000</div>${gallery}`,
    "https://www.dubicars.com/2023-toyota-highlander-25l-awd-855685.html");
  assert.ok(row);
  assert.equal(row.engineCc, undefined);
  assert.equal(row.powerHp, undefined);
  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.engineCc, undefined);
  assert.equal(offer.powerHp, undefined);
  assert.equal(offer.powerKw, undefined);
  assert.equal(offer.powerDataConfidence, undefined);
  assert.equal((offer.operational as any).semanticEvidence.engineCc.status, "missing");
  assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "missing");
});

test("DubiCars electric fuel conflicts with non-zero displacement", () => {
  const evidence = dubicarsSpecificationEvidence({ fuel: "Electric", engine: "1998 cc" });
  assert.equal(evidence.fuel.status, "exact");
  assert.equal(evidence.fuel.value, "electric");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.engineCc.value, undefined);
});

test("DubiCars keeps an identity-bound EREV as a series hybrid", () => {
  const row = parseDubicarsCurrentListing(
    detail("Engine capacity 1.5 L Horsepower 490 HP Fuel Type Hybrid")
      .replace("Toyota Camry V6 3.5L", "Voyah Free EREV")
      .replace("Make Toyota Model Camry", "Make Voyah Model Free"),
    "https://www.dubicars.com/2024-voyah-free-erev-1000265.html",
  );
  assert.ok(row);
  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.powertrainKind, "series_hybrid");
  assert.equal(offer.fuel, "hybrid");
});
