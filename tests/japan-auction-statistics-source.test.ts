import test from "node:test";
import assert from "node:assert/strict";
import { japanTransitAuctionStatisticsSource, parseJapanTransitAuctionStatistics } from "../apps/web/lib/catalog/japan-auction-statistics-source";

const markup = `
<section class="lot-card">
  <div class="grade">Оценка 4</div>
  <img data-src="https://japantransit.ru/storage/auction/note-e11.webp" src="/assets/img/skeleton-loading-img.gif" alt="NISSAN NOTE с аукциона в Японии">
  <div class="price">~ 665 000 ₽</div>
  <h3>NISSAN NOTE, 2008</h3>
  <div>15G+ Navi HDD</div>
  <div>E11 / 123 000 км. / 1 500 см³ / AT</div>
</section>`;

test("Japan Transit parser creates a real sold-auction statistics record", () => {
  const rows = parseJapanTransitAuctionStatistics(markup, "https://japantransit.ru/japan/stat?vendor=NISSAN&model=NOTE&page=1");
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.make, "NISSAN");
  assert.equal(row.model, "NOTE");
  assert.equal(row.year, 2008);
  assert.equal(row.price, 665_000);
  assert.equal(row.currency, "RUB");
  assert.equal(row.mileageKm, 123_000);
  assert.equal(row.engineCc, 1_500);
  assert.equal(row.frameNumber, "E11");
  assert.equal(row.auctionGrade, "4");
  assert.deepEqual(row.images, ["https://japantransit.ru/storage/auction/note-e11.webp"]);
});

test("Japan Transit keeps JPY when the sold price is published in yen", () => {
  const yenMarkup = markup.replace("~ 665 000 ₽", "665 000 ¥");
  const row = parseJapanTransitAuctionStatistics(yenMarkup)[0];
  assert.ok(row);
  assert.equal(row.price, 665_000);
  assert.equal(row.currency, "JPY");
});

test("Japan Transit adapter maps statistics to an auction-result catalogue card", () => {
  const row = parseJapanTransitAuctionStatistics(markup)[0];
  const offer = japanTransitAuctionStatisticsSource.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer?.market, "japan");
  assert.equal(offer?.offerType, "auction");
  assert.equal(offer?.catalogKind, "auction_result");
  assert.equal(offer?.auctionResult, "sold");
  assert.equal(offer?.auctionPriceKind, "published_result");
  assert.equal(offer?.sourcePrice, 665_000);
  assert.equal(offer?.sourceCurrency, "RUB");
  assert.equal(offer?.calculationStatus, "needs_data");
});

test("commercial auction lots are not imported into the passenger-car catalogue", () => {
  const truck = markup.replace(/NISSAN NOTE/g, "ISUZU TRUCK").replace(/E11/g, "CYL77CA");
  assert.equal(parseJapanTransitAuctionStatistics(truck).length, 0);
});
