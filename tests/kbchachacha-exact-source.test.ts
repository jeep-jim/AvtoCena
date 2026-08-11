import assert from "node:assert/strict";
import test from "node:test";
import { kbChaChaChaExactSource, parseKbChaChaChaDetail, parseKbChaChaChaList } from "../apps/web/lib/catalog/kbchachacha-exact-source";

test("KB ChaChaCha list parser binds title, price, year and exterior photos to carSeq", () => {
  const html = `<div class="area" data-car-seq="28651936">
    <div class="thumnail"><img src="https://img.kbchachacha.com/IMG/carimg/l/img05/img2865/28651936_1.jpeg?width=720" onerror="this.src='/images/common/noimage.jpg'"><img src="https://img.kbchachacha.com/IMG/carimg/l/img05/img2865/28651936_2.jpeg?width=720" onerror="this.src='/images/common/noimage.jpg'"></div>
    <strong class="tit">기아 더 뉴 카니발 프레스티지</strong>
    <div class="data-line"><span>23/10식(24년형)</span><span>12,345km</span></div>
    <span class="price">4,500<span class="unit">만원</span></span>
  </div>`;
  const rows = parseKbChaChaChaList(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].carSeq, "28651936");
  assert.equal(rows[0].make, "Kia");
  assert.match(rows[0].model, /Carnival/i);
  assert.equal(rows[0].year, 2024);
  assert.equal(rows[0].mileageKm, 12345);
  assert.equal(rows[0].sourcePrice, 45_000_000);
  assert.deepEqual(rows[0].images, [
    "https://img.kbchachacha.com/IMG/carimg/l/img05/img2865/28651936_1.jpeg",
    "https://img.kbchachacha.com/IMG/carimg/l/img05/img2865/28651936_2.jpeg",
  ]);
  const offer = kbChaChaChaExactSource.normalizeOffer(rows[0]);
  assert.equal(offer?.operational?.photoIdentityVerified, true);
  assert.equal(offer?.images.length, 2);
});

test("KB ChaChaCha detail parser rejects cross-car galleries and reads exact specs", () => {
  const images = Array.from({ length: 6 }, (_, index) => `https://img.kbchachacha.com/IMG/carimg/l/x/28651936_${index + 1}.jpeg`);
  const product = {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: "기아 더 뉴 카니발 프레스티지 (2024년형)",
    image: images,
    description: "2024년형",
    brand: { "@type": "Brand", name: "기아" },
    offers: { "@type": "Offer", url: "https://www.kbchachacha.com/public/car/detail.kbc?carSeq=28651936", priceCurrency: "KRW", price: "45000000" },
  };
  const html = `<script type="application/ld+json">${JSON.stringify(product)}</script><table><tbody>
    <tr><th>연식</th><td>23년10월(24년형)</td><th>주행거리</th><td>12,345km</td></tr>
    <tr><th>연료</th><td>가솔린</td><th>변속기</th><td>오토</td></tr>
    <tr><th>차종</th><td>RV</td><th>배기량</th><td>3,470cc</td></tr>
    <tr><th>차량색상</th><td>검정색</td></tr></tbody></table>`;
  const detail = parseKbChaChaChaDetail(html, "28651936");
  assert.equal(detail.make, "Kia");
  assert.equal(detail.year, 2024);
  assert.equal(detail.sourcePrice, 45_000_000);
  assert.equal(detail.engineCc, 3470);
  assert.equal(detail.mileageKm, 12345);
  assert.equal(detail.images.length, 6);
  assert.throws(() => parseKbChaChaChaDetail(html, "99999999"), /identity/);
});
