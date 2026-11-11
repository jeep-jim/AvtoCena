import assert from 'node:assert/strict';
import test from 'node:test';
import { goodCarManualPriceReviewReason } from '../apps/web/lib/catalog/chngoodcar-price-review';
import { ChnGoodCarReviewedPaginatedExactAdapter } from '../apps/web/lib/catalog/chngoodcar-reviewed-exact-source';
import type { GoodCarPaginatedExactRawOffer } from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';

function exactRow(overrides: Partial<GoodCarPaginatedExactRawOffer> = {}): GoodCarPaginatedExactRawOffer {
  return {
    sourceOfferId: '2049030561644670976',
    detailUrl: 'https://www.chngoodcar.com/Home/Cars?id=2049030561644670976',
    sourceTitle: '马自达CX-5 2022款 2.0L 自动两驱舒适型',
    listTitle: '马自达CX-5 2022款 2.0L 自动两驱舒适型',
    sourcePrice: 100,
    listPrice: 100,
    currency: 'USD',
    currencyLabelVerified: true,
    listCurrencyVerified: true,
    listDetailPriceParity: true,
    listDetailTitleParity: true,
    productionDate: '2022-01',
    listProductionDate: '2022-01',
    listDetailProductionDateParity: true,
    year: 2022,
    mileageKm: 10000,
    listMileageKm: 10000,
    listDetailMileageParity: true,
    engineCc: 1998,
    powerKw: 114,
    fuel: '汽油',
    transmission: '手自一体',
    bodyType: 'SUV',
    drive: '前置前驱',
    imageUrls: [1,2,3,4,5,6].map((n) => `https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/${n}.jpg`),
    discoverySource: 'CarsList/SearchCarList',
    ...overrides,
  };
}

test('Good Car manual-price gate holds modern rows below the source 2000 USD band boundary without changing the price', () => {
  assert.equal(goodCarManualPriceReviewReason({ year: 2022, sourcePrice: 100 }), 'modern_offer_in_source_under_2000_usd_band');
  assert.equal(goodCarManualPriceReviewReason({ year: 2025, sourcePrice: 1999.99 }), 'modern_offer_in_source_under_2000_usd_band');
  assert.equal(goodCarManualPriceReviewReason({ year: 2025, sourcePrice: 2000 }), null);
  assert.equal(goodCarManualPriceReviewReason({ year: 2016, sourcePrice: 100 }), null);
});

test('Good Car reviewed v3 adapter blocks the exact-parity 2022 Mazda 100 USD row but accepts the same evidence at a non-review price', () => {
  const adapter = new ChnGoodCarReviewedPaginatedExactAdapter();
  assert.equal(adapter.normalizeOffer(exactRow()), null);
  const normal = adapter.normalizeOffer(exactRow({ sourcePrice: 23600, listPrice: 23600 }));
  assert.ok(normal);
  assert.equal(normal.sourcePrice, 23600);
  assert.match(String((normal.operational.semanticEvidence as any)?.priceReviewBoundary), /never replaced/i);
});

test('Good Car verified exact-version Mazda3 93,900 USD outlier is held for manual review without replacing source price', () => {
  const sourceOfferId = '1432600975113187328';
  const sourceTitle = '马自达 昂克赛拉 2017款 三厢 1.5L 自动舒适型 国V';
  assert.equal(
    goodCarManualPriceReviewReason({ sourceOfferId, sourceTitle, year: 2018, sourcePrice: 93900 }),
    'verified_exact_version_extreme_price_outlier_manual_review',
  );
  assert.equal(goodCarManualPriceReviewReason({ sourceOfferId, sourceTitle, year: 2018, sourcePrice: 5000 }), null);

  const adapter = new ChnGoodCarReviewedPaginatedExactAdapter();
  const row = exactRow({
    sourceOfferId,
    detailUrl: `https://www.chngoodcar.com/Home/Cars?id=${sourceOfferId}`,
    sourceTitle,
    listTitle: sourceTitle,
    sourcePrice: 93900,
    listPrice: 93900,
    productionDate: '2018-03',
    listProductionDate: '2018-03',
    year: 2018,
    mileageKm: 66000,
    listMileageKm: 66000,
    engineCc: 1498,
    powerKw: 86,
    bodyType: '三厢车',
  });
  assert.equal(adapter.normalizeOffer(row), null);
  assert.equal(row.sourcePrice, 93900);
  assert.equal(row.listPrice, 93900);
});
