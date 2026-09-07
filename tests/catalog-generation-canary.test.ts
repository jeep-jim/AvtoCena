import assert from 'node:assert/strict';
import test from 'node:test';
import { canaryPrefix, PRODUCTION_INPUTS, assertCanaryObjectRequest, assertProductionInputsUnchanged,
  assertStoredCardParity } from '../scripts/lib/catalog-generation-canary.mjs';
import { kcarKoreaExactSource } from '../apps/web/lib/catalog/kcar-exact-source';

test('canary object writes cannot touch the production pointer, settings or other runs', () => {
  const prefix = canaryPrefix('123-1', 'korea');
  const check = (key: string, method: string) => assertCanaryObjectRequest(new URL(`https://storage.example/bucket/live/${key}`), method,
    'https://storage.example', 'bucket', 'live', prefix);
  for (const key of PRODUCTION_INPUTS) {
    assert.equal(check(key, 'GET'), key);
    for (const method of ['PUT', 'DELETE', 'POST']) assert.throws(() => check(key, method), /blocked/);
  }
  assert.equal(check(`${prefix}catalog/manifest.json`, 'PUT'), `${prefix}catalog/manifest.json`);
  for (const key of ['catalog/generations/active/offers.json', 'catalog/images/korea/a.webp', 'catalog/canaries/other/korea/report.json']) {
    assert.throws(() => check(key, 'PUT'), /blocked/);
  }
  assert.throws(() => check(`${prefix}a?delete=1`, 'GET'), /blocked/);
  assert.throws(() => check(`${prefix}a`, 'DELETE'), /blocked/);
  assert.throws(() => canaryPrefix('../live', 'korea'), /invalid/);
  assert.throws(() => canaryPrefix('123-1', 'japan'), /invalid/);
});

test('a changed or missing CRM snapshot fails acceptance even when its ETag is reused', () => {
  const before = Object.fromEntries(PRODUCTION_INPUTS.map(key => [key, { found: true, etag: 'v1', value: { amount: 1 } }]));
  assertProductionInputsUnchanged(before, structuredClone(before));
  const after = structuredClone(before);
  after['markets/markets.json'].value.amount = 2;
  assert.throws(() => assertProductionInputsUnchanged(before, after), /input_changed/);
  after['markets/markets.json'] = { found: false, etag: 'v1', value: { amount: 1 } };
  assert.throws(() => assertProductionInputsUnchanged(before, after), /input_changed/);
});

test('persisted card audit rejects price drift, wrong CRM version and malformed breakdown amounts', () => {
  const offer = { id: 'one', totalRub: 123, images: [], calculationSnapshot: { businessConfigVersion: 'crm1', breakdown: [{ amountRub: 100 }, { amountRub: 23 }] } };
  const card = { id: 'one', totalRub: 123 };
  const visible = (row: any) => row.totalRub;
  assertStoredCardParity(offer, card, offer, 'crm1', visible);
  assert.throws(() => assertStoredCardParity(offer, { ...card, totalRub: 124 }, offer, 'crm1', visible), /parity/);
  assert.throws(() => assertStoredCardParity(offer, card, offer, 'crm2', visible), /parity/);
  assert.throws(() => assertStoredCardParity({ ...offer, calculationSnapshot: { ...offer.calculationSnapshot, breakdown: [{ amountRub: 'unknown' }] } }, card, offer, 'crm1', visible), /parity/);
});

test('KCar refresh re-reads active state, price and exact specifications instead of its cached gallery', async () => {
  const originalFetch = globalThis.fetch;
  const oldAttempts = process.env.CATALOG_SOURCE_RETRY_ATTEMPTS;
  process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = '1';
  const base = 'https://img.kcar.com/3dcarpicture/2026/07/081/61390500_1';
  const detail = { rvo: { carCd: 'EC61390500', statCd: 'CAR_STATUS010', mnuftrNm: '현대', modelNm: '아반떼',
    grdFullNm: '1.6', regModelyr: '2023', mfgDt: '202209', milg: 12000, fuelTypecdNm: '가솔린', fuelType: '001',
    engdispmnt: '1598', hrspow: '123', trnsmsncdNm: '오토', drvgYnNm: '전륜', carctgr: '세단', salprc: 1900 },
    outerPhotoList: [{ carCd: 'EC61390500', elanPath: `${base}/main/main780.jpg`, thumbnailType: '01' }],
    vrVo: { v_src_close: Array.from({ length: 8 }, (_, i) => `'${base}/close/close_${i}.jpg'`).join(',') } };
  let requests = 0;
  globalThis.fetch = async input => {
    requests++;
    assert.equal(new URL(String(input)).searchParams.get('i_sCarCd'), 'EC61390500');
    return new Response(JSON.stringify({ success: true, data: { data: detail } }), { headers: { 'content-type': 'application/json' } });
  };
  const old = { sourceId: 'kcar_korea_open', market: 'korea', sourceOfferId: 'EC61390500', sourcePrice: 1,
    firstSeenAt: '2026-09-01T00:00:00Z', images: [{ url: 'cached' }] } as any;
  try {
    const fresh = await kcarKoreaExactSource.refreshOffer(old);
    assert.equal(requests, 1);
    assert.equal(fresh.sourcePrice, 19_000_000);
    assert.equal(fresh.year, 2022);
    assert.equal(fresh.engineCc, 1598);
    assert.equal(fresh.firstSeenAt, old.firstSeenAt);
    assert.ok(fresh.images.length >= 5);
    detail.rvo.statCd = 'SOLD';
    await assert.rejects(() => kcarKoreaExactSource.refreshOffer(old), /not_active/);
    detail.rvo.carCd = 'EC99999999';
    await assert.rejects(() => kcarKoreaExactSource.refreshOffer(old), /identity/);
    await assert.rejects(() => kcarKoreaExactSource.refreshOffer({ ...old, sourceId: 'other' }), /source_identity/);
    assert.equal(requests, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldAttempts === undefined) delete process.env.CATALOG_SOURCE_RETRY_ATTEMPTS;
    else process.env.CATALOG_SOURCE_RETRY_ATTEMPTS = oldAttempts;
  }
});
