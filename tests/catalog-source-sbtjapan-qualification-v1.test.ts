import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSbtFieldMatrix,
  extractSbtStockLinks,
  parseSbtDetailEvidence,
  parseSbtDetailUrl,
} from '../scripts/catalog-source-sbtjapan-qualification-v1.mjs';

test('SBT detail URLs are accepted only from source stock-id route', () => {
  assert.deepEqual(parseSbtDetailUrl('https://www.sbtjapan.com/used-cars/DQW2874'), {
    stockId: 'DQW2874',
    url: 'https://www.sbtjapan.com/used-cars/DQW2874',
  });
  assert.equal(parseSbtDetailUrl('https://www.sbtjapan.com/used-cars/search?page=3'), null);
  assert.equal(parseSbtDetailUrl('https://example.com/used-cars/DQW2874'), null);
});

test('SBT list discovery follows only source-declared stock anchors', () => {
  const html = `
    <a href="/used-cars/DQW2874">1991/5 NISSAN BLUEBIRD</a>
    <a href="https://www.sbtjapan.com/used-cars/DBQ6278">2026 SUZUKI SOLIO</a>
    <a href="/used-cars/search?page=2">Next</a>
  `;
  assert.deepEqual(extractSbtStockLinks(html), [
    { stockId: 'DQW2874', url: 'https://www.sbtjapan.com/used-cars/DQW2874' },
    { stockId: 'DBQ6278', url: 'https://www.sbtjapan.com/used-cars/DBQ6278' },
  ]);
});

test('SBT detail parser keeps source-bound price, year, cc, fuel, body and gallery without inventing power', () => {
  const gallery = Array.from({ length: 6 }, (_, i) => `<img src="https://img.sbtjapan.com/stock/DQW2874/photo-${i + 1}.jpg">`).join('');
  const html = `
    <html><head><title>1991/5 NISSAN BLUEBIRD | SBT Japan | Stock Id:DQW2874</title></head><body>
    <h1>1991/5 NISSAN BLUEBIRD</h1>
    Stock Id: DQW2874 Inventory location: Kanagawa, JAPAN
    ${gallery}
    View photo list
    Vehicle Price USD 5,160
    Mileage 119,158km Engine 1,800cc Transmission MT Steering RHD Fuel PETROL Door 4 Seats 5
    Vehicle Details Make NISSAN Model EU12 Body color WHITE Body Type Sedan Doors 4 Seats 5
    Reviews on nissan bluebird
    </body></html>
  `;
  const e = parseSbtDetailEvidence(html);
  assert.equal(e.stockId, 'DQW2874');
  assert.equal(e.yearMonth, '1991/5');
  assert.equal(e.priceUsd, 5160);
  assert.equal(e.mileageKm, 119158);
  assert.equal(e.engineCc, 1800);
  assert.equal(e.fuel, 'PETROL');
  assert.equal(e.bodyType, 'Sedan');
  assert.equal(e.make, 'NISSAN');
  assert.equal(e.model, 'EU12');
  assert.equal(e.imageCount, 6);
  assert.deepEqual(e.powerTokens, []);
});

test('SBT exact gate remains closed when all offer fields are exact except source-bound power', () => {
  const stock = { stockId: 'DQW2874', url: 'https://www.sbtjapan.com/used-cars/DQW2874' };
  const evidence = {
    title: '1991/5 NISSAN BLUEBIRD', stockId: 'DQW2874', yearMonth: '1991/5', priceUsd: 5160, currency: 'USD',
    mileageKm: 119158, engineCc: 1800, fuel: 'PETROL', bodyType: 'Sedan', inventoryLocation: 'Kanagawa, JAPAN',
    imageCount: 20, powerTokens: [],
  };
  const matrix = buildSbtFieldMatrix(stock, evidence);
  assert.equal(matrix.exactReady, false);
  assert.deepEqual(matrix.deficits, ['power']);
  assert.equal(matrix.fields.certifiedPower, 'not_applicable');
});

test('SBT electrified row also requires certified power', () => {
  const stock = { stockId: 'ABC1234', url: 'https://www.sbtjapan.com/used-cars/ABC1234' };
  const evidence = {
    title: '2020/1 TOYOTA PRIUS', stockId: 'ABC1234', yearMonth: '2020/1', priceUsd: 9000, currency: 'USD',
    mileageKm: 50000, engineCc: 1800, fuel: 'HYBRID', bodyType: 'Hatchback', inventoryLocation: 'Tokyo, JAPAN',
    imageCount: 10, powerTokens: [{ value: 98, unit: 'HP' }],
  };
  const matrix = buildSbtFieldMatrix(stock, evidence);
  assert.equal(matrix.fields.power, 'exact');
  assert.equal(matrix.fields.certifiedPower, 'missing');
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('certifiedPower'));
});
