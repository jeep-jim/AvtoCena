import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTcvFieldMatrix,
  extractTcvListCandidates,
  parseTcvDetail,
  parseTcvDetailUrl,
  parseTcvListCard,
} from '../scripts/catalog-source-tcv-japan-qualification-v1.mjs';

test('TCV accepts only source-declared vehicle detail URLs on tc-v.com', () => {
  assert.deepEqual(parseTcvDetailUrl('https://www.tc-v.com/used_car/nissan/cima/43847281/'), {
    makeSlug: 'nissan',
    modelSlug: 'cima',
    listingId: '43847281',
    url: 'https://www.tc-v.com/used_car/nissan/cima/43847281/',
  });
  assert.equal(parseTcvDetailUrl('https://www.tc-v.com/used_car/all/all/'), null);
  assert.equal(parseTcvDetailUrl('https://example.com/used_car/nissan/cima/43847281/'), null);
});

test('TCV list card binds its exact data-car-id to the matching detail href and source fields', () => {
  const segment = `
    <article data-car-id="43847281">
      STOCK 2001 NISSAN CIMA FOB Price US$ 2,567
      Registration Year 2001/03 Engine Capacity 3,000cc Mileage 64,100 km RHD Gasoline/Petrol 2WD
      <a href="/used_car/nissan/cima/43847281/">2001 NISSAN CIMA 300G 3.0L TURBO 280PS</a>
    </article>
  `;
  const row = parseTcvListCard(segment, '43847281');
  assert.equal(row.listingId, '43847281');
  assert.equal(row.url, 'https://www.tc-v.com/used_car/nissan/cima/43847281/');
  assert.equal(row.list.yearMonth, '2001/03');
  assert.equal(row.list.engineCc, 3000);
  assert.equal(row.list.mileageKm, 64100);
  assert.equal(row.list.priceUsd, 2567);
  assert.equal(row.list.currency, 'USD');
  assert.equal(row.list.fuel, 'Gasoline/Petrol');
  assert.deepEqual(row.list.powerTokens, [{ value: 280, unit: 'PS' }]);
});

test('TCV rejects a segment whose data-car-id conflicts with its only detail href', () => {
  const segment = `
    <article data-car-id="43847281">
      STOCK 2001 NISSAN CIMA FOB Price US$ 2,567 Registration Year 2001/03 Engine Capacity 3,000cc Mileage 64,100 km RHD Gasoline/Petrol
      <a href="/used_car/nissan/cima/99999999/">wrong car</a>
    </article>
  `;
  assert.equal(parseTcvListCard(segment, '43847281'), null);
});

test('TCV list discovery de-duplicates repeated card markers and keeps distinct listing identities', () => {
  const html = `
    <div data-car-id="43847281">STOCK 2001 NISSAN CIMA FOB Price US$ 2,567 Registration Year 2001/03 Engine Capacity 3,000cc Mileage 64,100 km RHD Gasoline/Petrol <a href="/used_car/nissan/cima/43847281/">Cima 280PS</a></div>
    <div data-car-id="43847281"><a href="/used_car/nissan/cima/43847281/">same card image</a></div>
    <div data-car-id="43814804">STOCK 2000 SUBARU LEGACY TOURING WAGON FOB Price US$ 3,100 Registration Year 2000 Engine Capacity 2,000cc Mileage 86,350 km RHD Gasoline/Petrol <a href="/used_car/subaru/legacy%20touring%20wagon/43814804/">Legacy 260PS</a></div>
  `;
  const rows = extractTcvListCandidates(html, 10);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.listingId), ['43847281', '43814804']);
});

test('TCV detail parser scopes exact vehicle fields, explicit power and listing-bound gallery', () => {
  const html = `
    <html><head><title>Used Nissan Cima 2001 300G 3.0L TURBO ( 280PS ! ) - TCV</title></head><body>
      <nav>Search By BodyStyle SUV Sedan Diesel</nav>
      <section>
        Specific information VIN (Vehicle Identification Number) /Serial No. HF50-600***
        Model Code HF50
        Registration Year / Month 2001/03
        Manufacture Year / Month Confirm with the Seller
        Mileage 64,100 km
        Transmission Automatic
        Engine Capacity (Displacement) 3,000cc
        Fuel Gasoline/Petrol
        BodyStyle1 Sedan
        BodyStyle2 -
        Steering Right
        Drive Type 2wheel drive
        ID 521478-380810
        Remarks (Any Problems) NEO VQ30DET 3.0L V6 DOHC TURBO, 280PS !!
        Comment 280PS !!
        Expiry Date Sep / 24 / 2026 (JST)
        Options Safety Driver Airbag
      </section>
      <div>FOB Price US$ 2,567</div>
      <img src="/images/43847281/01.jpg"><img src="/images/43847281/02.jpg"><img src="/images/43847281/03.jpg">
      <img src="/images/43847281/04.jpg"><img src="/images/43847281/05.jpg"><img src="/images/43847281/06.jpg">
      <img src="/images/site/logo.png">
    </body></html>
  `;
  const row = parseTcvDetail(html, 'https://www.tc-v.com/used_car/nissan/cima/43847281/', 2567);
  assert.equal(row.listingId, '43847281');
  assert.equal(row.yearMonth, '2001/03');
  assert.equal(row.mileageKm, 64100);
  assert.equal(row.engineCc, 3000);
  assert.equal(row.fuel, 'Gasoline/Petrol');
  assert.equal(row.body1, 'Sedan');
  assert.equal(row.modelCode, 'HF50');
  assert.equal(row.offerId, '521478-380810');
  assert.deepEqual(row.powerTokens, [{ value: 280, unit: 'PS' }]);
  assert.equal(row.listingBoundImageCount, 6);
  assert.equal(row.priceUsd, 2567);
  assert.equal(row.currency, 'USD');
  assert.ok(row.priceContexts.length >= 1);
});

test('TCV exact gate succeeds for a fully source-bound ICE card and fails closed if price evidence disappears', () => {
  const candidate = {
    listingId: '43847281',
    url: 'https://www.tc-v.com/used_car/nissan/cima/43847281/',
    list: {
      yearMonth: '2001/03', engineCc: 3000, mileageKm: 64100, priceUsd: 2567, currency: 'USD',
      fuel: 'Gasoline/Petrol', powerTokens: [{ value: 280, unit: 'PS' }],
    },
  };
  const detail = {
    listingId: '43847281', url: candidate.url, yearMonth: '2001/03', engineCc: 3000, mileageKm: 64100,
    priceUsd: 2567, currency: 'USD', fuel: 'Gasoline/Petrol', body1: 'Sedan',
    powerTokens: [{ value: 280, unit: 'PS' }], listingBoundImageCount: 8, priceContexts: ['FOB Price US$ 2,567'],
  };
  const good = buildTcvFieldMatrix(candidate, detail);
  assert.equal(good.exactReady, true);
  assert.equal(good.fields.certifiedPower, 'not_applicable');
  assert.deepEqual(good.deficits, []);

  const missingPrice = buildTcvFieldMatrix(candidate, { ...detail, priceUsd: null, currency: null, priceContexts: [] });
  assert.equal(missingPrice.exactReady, false);
  assert.ok(missingPrice.deficits.includes('price'));
  assert.ok(missingPrice.deficits.includes('currency'));
});

test('TCV electrified cards always require certified power even if ordinary power and gallery are present', () => {
  const candidate = {
    listingId: '45000001', url: 'https://www.tc-v.com/used_car/toyota/prius/45000001/',
    list: { yearMonth: '2021/05', engineCc: 1790, mileageKm: 22000, priceUsd: 10000, currency: 'USD', fuel: 'Hybrid', powerTokens: [{ value: 98, unit: 'PS' }] },
  };
  const detail = {
    listingId: '45000001', url: candidate.url, yearMonth: '2021/05', engineCc: 1790, mileageKm: 22000,
    priceUsd: 10000, currency: 'USD', fuel: 'Hybrid', body1: 'Hatchback', powerTokens: [{ value: 98, unit: 'PS' }],
    listingBoundImageCount: 8, priceContexts: ['FOB Price US$ 10,000'],
  };
  const matrix = buildTcvFieldMatrix(candidate, detail);
  assert.equal(matrix.fields.certifiedPower, 'missing');
  assert.equal(matrix.exactReady, false);
  assert.ok(matrix.deficits.includes('certifiedPower'));
});
