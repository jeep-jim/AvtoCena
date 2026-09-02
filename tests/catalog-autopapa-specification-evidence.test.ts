import assert from "node:assert/strict";
import test from "node:test";
import {
  AutoPapaGeorgiaAdapter,
  autoPapaSpecificationEvidence,
  enrichAutoPapaOfferFromExactDetail,
  parseAutoPapaGeorgiaListing,
} from "../apps/web/lib/catalog/autopapa-georgia-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new AutoPapaGeorgiaAdapter();

test("AutoPapa listing card preserves exact year fuel and engine evidence", () => {
  const rows = parseAutoPapaGeorgiaListing(`
    <a href="/en/usd/chevrolet/captiva/932906">Chevrolet Captiva</a>
    <div>minivan $13 000 2023 year, Rustavi, 22 K. km automatic 1.5 l, petrol</div>
    <img src="/system/car/photos/009/066/595/medium.jpg">
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].semanticEvidence?.year.status, "exact");
  assert.equal(rows[0].semanticEvidence?.fuel.status, "exact");
  assert.equal(rows[0].semanticEvidence?.engineCc.status, "exact");
  const offer = source.normalizeOffer(rows[0]);
  assert.ok(offer);
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "missing");
});

test("AutoPapa conflicts and ranges never select the first metric", () => {
  const evidence = autoPapaSpecificationEvidence({
    years: ["2023", "2024"],
    fuels: ["Petrol", "Diesel"],
    engines: ["1.5 l", "2.0 l"],
    power: ["100 hp", "150 hp"],
  });
  assert.equal(evidence.year.status, "conflict");
  assert.equal(evidence.fuel.status, "conflict");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.powerHp.status, "conflict");
  assert.equal(autoPapaSpecificationEvidence({ engines: ["1.5 - 2.0 l"] }).engineCc.status, "ambiguous");
});

test("AutoPapa generic normalization cannot restore title-only engine or power", () => {
  const offer = source.normalizeOffer({
    id: "932906", detailUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906", title: "Chevrolet Captiva 2.0L 200 hp",
    make: "Chevrolet", model: "Captiva", year: 2023, price: 13_000, currency: "USD", images: [],
    semanticEvidence: autoPapaSpecificationEvidence({ years: ["2023"] }),
  });
  assert.ok(offer);
  assert.equal(offer.engineCc, undefined);
  assert.equal(offer.powerHp, undefined);
  assert.equal(offer.powerKw, undefined);
  assert.equal(offer.powerDataConfidence, undefined);
});

test("AutoPapa identity-bound detail power upgrades only its own evidence", () => {
  const offer = source.normalizeOffer({
    id: "932906", detailUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906", title: "Chevrolet Captiva",
    make: "Chevrolet", model: "Captiva", year: 2023, price: 13_000, currency: "USD", images: [],
    semanticEvidence: autoPapaSpecificationEvidence({ years: ["2023"], fuels: ["petrol"], engines: ["1.5 l"] }),
  });
  assert.ok(offer);
  const facts = enrichAutoPapaOfferFromExactDetail(offer, "<div>Body Type: SUV Power: 147 hp Engine Vol: 1.5 l</div><div>Car description</div>", offer.operational.sourceUrl!);
  assert.ok(facts);
  assert.equal(offer.powerHp, 147);
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
});
