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

test("KB ChaChaCha concurrent detail challenge pauses queued requests and keeps exact listing galleries", async () => {
  const ids = ["28651936", "28651937", "28651938"];
  const html = ids.map((carSeq, index) => `<div class="area" data-car-seq="${carSeq}">
    <div class="thumnail"><img src="https://img.kbchachacha.com/IMG/carimg/l/x/${carSeq}_1.jpeg"><img src="https://img.kbchachacha.com/IMG/carimg/l/x/${carSeq}_2.jpeg"></div>
    <strong class="tit">기아 더 뉴 카니발 프레스티지</strong>
    <div class="data-line"><span>23/10식(24년형)</span><span>${12_345 + index}km</span></div>
    <span class="price">4,500<span class="unit">만원</span></span>
  </div>`).join("");
  const rows = parseKbChaChaChaList(html);
  assert.equal(rows.length, 3);
  const offers = rows.map((row) => kbChaChaChaExactSource.normalizeOffer(row));
  assert.equal(offers.filter(Boolean).length, 3);

  const originalFetch = globalThis.fetch;
  const originalInterval = process.env.KBCHACHACHA_DETAIL_MIN_INTERVAL_MS;
  const originalPause = process.env.KBCHACHACHA_DETAIL_PAUSE_MS;
  let fetchCalls = 0;
  process.env.KBCHACHACHA_DETAIL_MIN_INTERVAL_MS = "0";
  process.env.KBCHACHACHA_DETAIL_PAUSE_MS = "60000";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("<html><body>Access denied</body></html>", { status: 403, headers: { "content-type": "text/html" } });
  };

  try {
    const galleries = await Promise.all(offers.map((offer) => kbChaChaChaExactSource.fetchImages(offer!)));
    assert.equal(fetchCalls, 1);
    for (let index = 0; index < galleries.length; index++) {
      assert.deepEqual(galleries[index].map((image) => image.url), rows[index].images);
      assert.equal(offers[index]?.operational?.gallerySafetyMode, "kbchachacha_exact_listing_card_car_seq_v1");
      assert.ok(galleries[index].every((image) => new URL(image.url).pathname.includes(`/${ids[index]}_`)));
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalInterval === undefined) delete process.env.KBCHACHACHA_DETAIL_MIN_INTERVAL_MS;
    else process.env.KBCHACHACHA_DETAIL_MIN_INTERVAL_MS = originalInterval;
    if (originalPause === undefined) delete process.env.KBCHACHACHA_DETAIL_PAUSE_MS;
    else process.env.KBCHACHACHA_DETAIL_PAUSE_MS = originalPause;
  }
});
