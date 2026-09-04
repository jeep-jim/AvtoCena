import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBeforwardFieldMatrix,
  extractBeforwardStockCandidates,
  parseBeforwardDetailUrl,
  parseBeforwardListContext,
} from '../scripts/catalog-source-beforward-japan-qualification-v1.mjs';

test('BE FORWARD detail identity is accepted only from the source-declared ref/id path', () => {
  assert.deepEqual(parseBeforwardDetailUrl('https://www.beforward.jp/nissan/march/ce621935/id/16508049/'), {
    makeSlug: 'nissan',
    modelSlug: 'march',
    refNo: 'CE621935',
    numericId: '16508049',
    url: 'https://www.beforward.jp/nissan/march/ce621935/id/16508049/',
  });
  assert.equal(parseBeforwardDetailUrl('https://www.beforward.jp/stocklist?page=2'), null);
  assert.equal(parseBeforwardDetailUrl('https://example.com/nissan/march/ce621935/id/16508049/'), null);
});

test('BE FORWARD list context keeps exact named list-side values and USD price', () => {
  const row = parseBeforwardListContext(`
    Ref No. CE621935 | 2017 NISSAN MARCH X V SELECTION
    Mileage 81,267 km Year 2017/7 Engine 1,190cc Trans. AT Location Nagoya
    Model code DBA-K13 Steering Right Fuel Petrol Seats 5 Engine code HR12 Color Green Drive 2WD Doors 5
    Price $2,120 Total Price $4,397
  `);
  assert.equal(row.refNo, 'CE621935');
  assert.equal(row.priceUsd, 2120);
  assert.equal(row.currency, 'USD');
  assert.equal(row.year, '2017/7');
  assert.equal(row.mileageKm, 81267);
  assert.equal(row.engineCc, 1190);
  assert.equal(row.transmission, 'AT');
  assert.equal(row.location, 'Nagoya');
  assert.equal(row.modelCode, 'DBA-K13');
  assert.equal(row.fuel, 'Petrol');
  assert.equal(row.drive, '2WD');
});

test('BE FORWARD stock discovery follows only real detail anchors and binds list Ref No.', () => {
  const html = `
    <div>Ref No. CE621935 | 2017 NISSAN MARCH X V SELECTION Mileage 81,267 km Year 2017/7 Engine 1,190cc Trans. AT Location Nagoya Model code DBA-K13 Steering Right Fuel Petrol Seats 5 Engine code HR12 Color Green Drive 2WD Doors 5 Price $2,120
      <a href="/nissan/march/ce621935/id/16508049/">2017 NISSAN MARCH</a>
    </div>
    <a href="/stocklist?page=2">Next</a>
  `;
  const rows = extractBeforwardStockCandidates(html, 10);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].refNo, 'CE621935');
  assert.equal(rows[0].numericId, '16508049');
  assert.equal(rows[0].list.location, 'Nagoya');
});

test('BE FORWARD exact gate stays fail-closed when body, power or listing-bound gallery are unproven', () => {
  const candidate = {
    makeSlug: 'nissan', modelSlug: 'march', refNo: 'CE621935', numericId: '16508049',
    url: 'https://www.beforward.jp/nissan/march/ce621935/id/16508049/',
    list: { refNo: 'CE621935', priceUsd: 2120, currency: 'USD', year: '2017/7', mileageKm: 81267, engineCc: 1190, fuel: 'Petrol' },
  };
  const detail = {
    refNo: 'CE621935', priceUsd: 2120, currency: 'USD', year: '2017/7', mileageKm: 81267, engineCc: 1190,
    fuel: 'Petrol', body: null, powerTokens: [], bodyPairs: [], images: ['https://cdn.beforward.jp/photo.jpg'],
  };
  const matrix = buildBeforwardFieldMatrix(candidate, detail);
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('body'));
  assert.ok(matrix.deficits.includes('power'));
  assert.ok(matrix.deficits.includes('gallery'));
  assert.equal(matrix.fields.certifiedPower, 'not_applicable');
});

test('BE FORWARD electrified rows require certified power and never inherit ICE not_applicable', () => {
  const candidate = {
    makeSlug: 'toyota', modelSlug: 'aqua', refNo: 'CE621828', numericId: '16513034',
    url: 'https://www.beforward.jp/toyota/aqua/ce621828/id/16513034/',
    list: { refNo: 'CE621828', priceUsd: 4550, currency: 'USD', year: '2020/5', mileageKm: 155725, engineCc: 1490, fuel: 'Hybrid(Petrol)' },
  };
  const detail = {
    refNo: 'CE621828', priceUsd: 4550, currency: 'USD', year: '2020/5', mileageKm: 155725, engineCc: 1490,
    fuel: 'Hybrid(Petrol)', body: 'Hatchback', powerTokens: [{ value: 74, unit: 'HP' }], bodyPairs: [],
    images: Array.from({ length: 6 }, (_, i) => `https://cdn.beforward.jp/CE621828_${i}.jpg`),
  };
  const matrix = buildBeforwardFieldMatrix(candidate, detail);
  assert.equal(matrix.fields.certifiedPower, 'missing');
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('certifiedPower'));
});
