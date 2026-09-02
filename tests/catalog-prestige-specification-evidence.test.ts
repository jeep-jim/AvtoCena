import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePrestigeJapanExactDetail,
  PrestigeJapanExactSource,
  isPrestigeJapanSourceBlockedError,
  prestigeJapanSpecificationEvidence,
} from "../apps/web/lib/catalog/prestige-japan-exact-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const url = "https://prestigemotorsport.com.au/auction-vehicle-display/?car_id=exact-evidence";

function soldDetail(capacity: string, year = "2022") {
  return `<table>
    <tr><td><strong>Year</strong></td><td>${year}</td></tr>
    <tr><td><strong>Make</strong></td><td>BMW</td></tr>
    <tr><td><strong>Model</strong></td><td>330i 258</td></tr>
    <tr><td><strong>Capacity</strong></td><td>${capacity}</td></tr>
    <tr><td><strong>Chassis</strong></td><td>3BA-5R20</td></tr>
    <tr><td><strong>Final Price</strong></td><td>2,200,000 YEN</td></tr>
    <tr><td><strong>Current Status</strong></td><td>Sold</td></tr>
  </table>`;
}

test("Prestige accepts one exact bounded value from the named Capacity field", () => {
  assert.deepEqual(prestigeJapanSpecificationEvidence({ year: "2022", capacity: "1,998 CC" }).engineCc, {
    value: 1998,
    rawValues: ["1,998 CC"],
    status: "exact",
  });
  assert.equal(prestigeJapanSpecificationEvidence({ year: "2022", capacity: "1998" }).engineCc.status, "exact");
});

test("Prestige never concatenates a capacity range or chooses a conflicting value", () => {
  assert.equal(prestigeJapanSpecificationEvidence({ capacity: "1,500 - 2,000 CC" }).engineCc.status, "ambiguous");
  assert.equal(prestigeJapanSpecificationEvidence({ capacity: "1500 CC / 2000 CC" }).engineCc.status, "conflict");
  assert.equal(prestigeJapanSpecificationEvidence({ capacity: "2.0 L" }).engineCc.status, "missing");
  assert.equal(parsePrestigeJapanExactDetail(soldDetail("1,500 - 2,000 CC"), url)?.engineCc, undefined);
  assert.equal(parsePrestigeJapanExactDetail(soldDetail("1500 CC / 2000 CC"), url)?.engineCc, undefined);
});

test("Prestige model and chassis numbers cannot become engine or power", () => {
  const row = parsePrestigeJapanExactDetail(soldDetail("--"), url);
  assert.ok(row);
  assert.equal(row.engineCc, undefined);
  assert.equal(row.semanticEvidence.engineCc.status, "missing");
  assert.equal(row.semanticEvidence.powerHp.status, "missing");
});

test("Prestige offer exposes exact source provenance without inventing fuel or power", () => {
  const row = parsePrestigeJapanExactDetail(soldDetail("1,998 CC"), url);
  assert.ok(row);
  const offer = new PrestigeJapanExactSource().normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.engineCc, 1998);
  assert.equal(offer.fuel, undefined);
  assert.equal(offer.powerHp, undefined);
  assert.equal(offer.powerKw, undefined);
  assert.equal((offer.operational as any).semanticEvidence.year.status, "exact");
  assert.equal((offer.operational as any).semanticEvidence.engineCc.status, "exact");
  assert.equal((offer.operational as any).semanticEvidence.fuel.status, "missing");
  assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "missing");
  assert.equal(classifySpecificationEvidence(offer, "year").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "missing");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "missing");
});

test("Prestige rejects conflicting model years instead of selecting the first", () => {
  assert.equal(prestigeJapanSpecificationEvidence({ year: "2021 / 2022" }).year.status, "conflict");
  assert.equal(parsePrestigeJapanExactDetail(soldDetail("1998 CC", "2021 / 2022"), url), null);
});

test("Prestige reports the live Turnstile response as a source block", () => {
  assert.equal(isPrestigeJapanSourceBlockedError(new Error('{"cf-turnstile":"failure","error":"Bot check failed. Please check the Cloudflare widget"}')), true);
  assert.equal(isPrestigeJapanSourceBlockedError(new Error("network timeout")), false);
});
