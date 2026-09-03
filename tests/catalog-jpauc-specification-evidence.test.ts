import assert from "node:assert/strict";
import test from "node:test";
import {
  JpaucPastAdapter,
  jpaucIdentityGalleryEvidence,
  jpaucSpecificationEvidence,
  parseJpaucListingRows,
} from "../apps/web/lib/catalog/jpauc-past-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

function rowHtml(engineText: string, yearText = "Year: 2022 FX") {
  return `<table><tr data-id="344621799" data-r="1" data-r-total="43">
    <td></td><td></td><td>2026-08-26</td><td>Atsugi | 89</td>
    <td>BMW<br>330i 258</td><td>${yearText}</td><td>${engineText}</td>
    <td>AT | 12,345 KM</td><td>Color: WHITE Auc.Grade: 4</td><td>Status: Sold | Start: ¥ 200,000</td>
    <td><img data-original="https://auctions.aleado.com/pic?sys=1&id=344621799&number=0"></td>
  </tr></table>`;
}

test("JPAuc accepts only one explicit bounded cc value", () => {
  const evidence = jpaucSpecificationEvidence({ yearText: "Year: 2022 FX", engineText: "1,998 cc | 3BA-5R20" });
  assert.deepEqual(evidence.year, { value: 2022, rawValues: ["Year: 2022 FX"], status: "exact" });
  assert.deepEqual(evidence.engineCc, { value: 1998, rawValues: ["1,998 cc | 3BA-5R20"], status: "exact" });
  assert.equal(evidence.fuel.status, "missing");
  assert.equal(evidence.powerHp.status, "missing");
  assert.equal(evidence.powerKw.status, "missing");
});

test("JPAuc fails closed for cc ranges and conflicting cc values", () => {
  assert.equal(jpaucSpecificationEvidence({ engineText: "1,500-2,000 cc" }).engineCc.status, "ambiguous");
  assert.equal(jpaucSpecificationEvidence({ engineText: "1500 cc / 2000 cc" }).engineCc.status, "conflict");
  assert.equal(jpaucSpecificationEvidence({ engineText: "99 cc" }).engineCc.status, "ambiguous");
  assert.equal(parseJpaucListingRows(rowHtml("1,500-2,000 cc | MODEL-2000"))[0].engineCc, undefined);
  assert.equal(parseJpaucListingRows(rowHtml("1500 cc / 2000 cc | MODEL-330"))[0].engineCc, undefined);
});

test("JPAuc model and grade numbers never become engine or power", () => {
  const rows = parseJpaucListingRows(rowHtml("| 3BA-5R20", "Year: 2022 330i 258"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].engineCc, undefined);
  assert.equal(rows[0].semanticEvidence.engineCc.status, "missing");
  assert.equal(rows[0].semanticEvidence.powerHp.status, "missing");
});

test("JPAuc offer carries source evidence and never invents fuel or power", () => {
  const row = parseJpaucListingRows(rowHtml("1,998 cc | 3BA-5R20"))[0];
  const offer = new JpaucPastAdapter().normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.engineCc, 1998);
  assert.equal(offer.fuel, undefined);
  assert.equal(offer.powerHp, undefined);
  assert.equal(offer.powerKw, undefined);
  assert.equal((offer.operational as any).minimumImages, 3);
  assert.equal((offer.operational as any).semanticEvidence.year.status, "exact");
  assert.equal((offer.operational as any).semanticEvidence.engineCc.status, "exact");
  assert.equal((offer.operational as any).semanticEvidence.fuel.status, "missing");
  assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "missing");
  assert.equal(classifySpecificationEvidence(offer, "year").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "missing");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "missing");
});

test("JPAuc identity and gallery evidence remains non-public without an exact joined price", () => {
  const row = parseJpaucListingRows(rowHtml("1,998 cc | 3BA-5R20"))[0];
  const withheld = { ...row, startPrice: 0, sourceStatus: "available" };
  assert.deepEqual(jpaucIdentityGalleryEvidence(withheld), { ok: true, imageCount: 3, priceAvailable: false });
  assert.equal(new JpaucPastAdapter().normalizeOffer(withheld), null);
  assert.equal(jpaucIdentityGalleryEvidence({ ...withheld, listingImage: withheld.listingImage.replace(withheld.dataId, "999") }).ok, false);
});
