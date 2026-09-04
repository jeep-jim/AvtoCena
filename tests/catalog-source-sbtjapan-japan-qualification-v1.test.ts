import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSbtFieldMatrix,
  extractSbtListCandidates,
  parseSbtDetail,
  parseSbtDetailUrl,
  parseSbtListContext,
} from '../scripts/catalog-source-sbtjapan-japan-qualification-v1.mjs';

test('SBT detail identity accepts only a source stock page', () => {
  assert.deepEqual(parseSbtDetailUrl('https://www.sbtjapan.com/used-cars/DNC5379'), {
    stockId: 'DNC5379',
    url: 'https://www.sbtjapan.com/used-cars/DNC5379',
  });
  assert.equal(parseSbtDetailUrl('https://www.sbtjapan.com/used-cars/search?page=3'), null);
  assert.equal(parseSbtDetailUrl('https://example.com/used-cars/DNC5379'), null);
});

test('SBT list context preserves offer-bound USD price and named source fields', () => {
  const row = parseSbtListContext(`
    2019/11 TOYOTA HARRIER ELEGANCE Vehicle Price USD 14,100
    Stock Id: AO5656 Inventory location : YOKOHAMA, JAPAN
    Model Code ZSU60W 52,000km 1,998cc AT 2WD RHD PETROL
  `);
  assert.equal(row.stockId, 'AO5656');
  assert.equal(row.yearMonth, '2019/11');
  assert.equal(row.priceUsd, 14100);
  assert.equal(row.currency, 'USD');
  assert.equal(row.location, 'YOKOHAMA, JAPAN');
  assert.equal(row.mileageKm, 52000);
  assert.equal(row.engineCc, 1998);
  assert.equal(row.transmission, 'AT');
  assert.equal(row.drive, '2WD');
  assert.equal(row.steering, 'RHD');
  assert.equal(row.fuel, 'PETROL');
  assert.equal(row.modelCode, 'ZSU60W');
});

test('SBT listing discovery follows only source-declared stock anchors and binds Stock Id', () => {
  const html = `
    <section>
      <div>2019/11 TOYOTA HARRIER ELEGANCE Vehicle Price USD 14,100 Stock Id: AO5656 Inventory location : YOKOHAMA, JAPAN Model Code ZSU60W 52,000km 1,998cc AT 2WD RHD PETROL</div>
      <a href="/used-cars/AO5656">View Details</a>
    </section>
    <a href="/used-cars/search?page=3">Next</a>
  `;
  const rows = extractSbtListCandidates(html, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].stockId, 'AO5656');
  assert.equal(rows[0].list.priceUsd, 14100);
});

test('SBT detail parser keeps source fields and a coherent vehicle-image cluster', () => {
  const images = Array.from({ length: 6 }, (_, i) => `<img src="https://image.sbtjapan.com/vehicle/0500312A30260226W00${100 + i}.jpg">`).join('');
  const detail = parseSbtDetail(`
    <h1>2011/2 HONDA LIFE</h1>
    Stock Id: DNC5379 Vehicle Price USD 2,240 Inventory location : KANAGAWA, JAPAN
    Mileage 72,500km Engine 660cc Transmission AT Drive 2WD Steering RHD Fuel PETROL
    Body Type Hatchback
    ${images}
  `, 'https://www.sbtjapan.com/used-cars/DNC5379');
  assert.equal(detail.stockId, 'DNC5379');
  assert.equal(detail.priceUsd, 2240);
  assert.equal(detail.engineCc, 660);
  assert.equal(detail.body, 'Hatchback');
  assert.equal(detail.powerTokens.length, 0);
  assert.equal(detail.offerBoundImageCount, 6);
});

test('SBT exact gate stays fail-closed when horsepower is not source-bound', () => {
  const candidate = {
    stockId: 'DNC5379',
    url: 'https://www.sbtjapan.com/used-cars/DNC5379',
    list: {
      stockId: 'DNC5379', yearMonth: '2011/2', priceUsd: 2240, currency: 'USD', location: 'KANAGAWA, JAPAN',
      mileageKm: 72500, engineCc: 660, transmission: 'AT', drive: '2WD', steering: 'RHD', fuel: 'PETROL',
    },
  };
  const detail = {
    stockId: 'DNC5379', yearMonth: '2011/2', priceUsd: 2240, currency: 'USD', location: 'KANAGAWA, JAPAN',
    mileageKm: 72500, engineCc: 660, transmission: 'AT', drive: '2WD', steering: 'RHD', fuel: 'PETROL', body: 'Hatchback',
    powerTokens: [], offerBoundImageCount: 6, offerBoundImageSample: [],
  };
  const matrix = buildSbtFieldMatrix(candidate, detail);
  assert.equal(matrix.fields.identity, 'exact');
  assert.equal(matrix.fields.price, 'exact');
  assert.equal(matrix.fields.gallery, 'exact');
  assert.equal(matrix.fields.power, 'missing_or_ambiguous');
  assert.equal(matrix.fields.certifiedPower, 'not_applicable');
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('power'));
});

test('SBT electrified rows require certified power and cannot inherit ICE not_applicable', () => {
  const candidate = {
    stockId: 'DAJ2796',
    url: 'https://www.sbtjapan.com/used-cars/DAJ2796',
    list: {
      stockId: 'DAJ2796', yearMonth: '2026/4', priceUsd: 26400, currency: 'USD', mileageKm: 6, engineCc: 2000,
      transmission: 'AT', drive: '2WD', steering: 'RHD', fuel: 'HYBRID(PETROL)',
    },
  };
  const detail = {
    stockId: 'DAJ2796', yearMonth: '2026/4', priceUsd: 26400, currency: 'USD', mileageKm: 6, engineCc: 2000,
    transmission: 'AT', drive: '2WD', steering: 'RHD', fuel: 'HYBRID(PETROL)', body: 'Minivan',
    powerTokens: [{ value: 145, unit: 'HP' }], offerBoundImageCount: 15, offerBoundImageSample: [],
  };
  const matrix = buildSbtFieldMatrix(candidate, detail);
  assert.equal(matrix.fields.certifiedPower, 'missing');
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('certifiedPower'));
});
