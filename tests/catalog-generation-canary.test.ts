import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { canaryPrefix, PRODUCTION_INPUTS, assertCanaryObjectRequest, assertProductionInputsUnchanged,
  assertStoredCardParity } from '../scripts/lib/catalog-generation-canary.mjs';
import { kcarKoreaExactSource } from '../apps/web/lib/catalog/kcar-exact-source';
import { assertSafeImageUrl, cacheImageFromUrl } from '../apps/web/lib/catalog/storage';
import { resetJsonStorageForTests, getJsonStorage } from '../apps/web/lib/data';

test('the binary loader decodes KCar JPEG and mobile.de AVIF but rejects HTML and invalid AVIF', async () => {
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const originalDriver = process.env.JSON_STORAGE_DRIVER;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'kcar-image-mime-'));
  await fs.mkdir(path.join(temp, 'data'));
  const jpeg = await sharp({ create: { width: 780, height: 520, channels: 3, background: '#426680' } }).jpeg().toBuffer();
  let sourceBytes = jpeg;
  let contentType = 'image/jpg';
  globalThis.fetch = async () => new Response(sourceBytes, { headers: { 'content-type': contentType } });
  process.chdir(temp); process.env.JSON_STORAGE_DRIVER = 'local'; resetJsonStorageForTests();
  try {
    const image = await cacheImageFromUrl('https://img.kcar.com/canary-mime-test/good.jpg', 'korea');
    assert.ok(image);
    assert.equal(image.width, 780);
    assert.equal(image.height, 520);
    const stored = await getJsonStorage().getBinary!(image.objectKey);
    assert.equal(stored.checksum, image.checksum);
    assert.equal((await sharp(stored.data).metadata()).format, 'webp');
    contentType = 'text/html';
    assert.equal(await cacheImageFromUrl('https://img.kcar.com/canary-mime-test/bad.jpg', 'korea'), null);
    contentType = 'image/avif';
    sourceBytes = await sharp(jpeg).avif({ effort: 0 }).toBuffer();
    const avif = await cacheImageFromUrl('https://img.classistatic.de/api/v1/mo-prod/images/test-avif', 'europe');
    assert.ok(avif);
    assert.equal(avif.mimeType, 'image/webp');
    assert.equal(avif.width, 780);
    const avifStored = await getJsonStorage().getBinary!(avif.objectKey);
    assert.equal((await sharp(avifStored.data).metadata()).format, 'webp');
    sourceBytes = Buffer.from('not an AVIF image');
    assert.equal(await cacheImageFromUrl('https://img.classistatic.de/api/v1/mo-prod/images/test-invalid-avif', 'europe'), null);
  } finally {
    globalThis.fetch = originalFetch; process.chdir(originalCwd); resetJsonStorageForTests();
    if (originalDriver === undefined) delete process.env.JSON_STORAGE_DRIVER;
    else process.env.JSON_STORAGE_DRIVER = originalDriver;
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('mobile.de gallery CDN is admitted only at its exact HTTPS vehicle image route', () => {
  const url = 'https://img.classistatic.de/api/v1/mo-prod/images/abc-123?rule=mo-1024.jpg';
  assert.equal(assertSafeImageUrl(url), url);
  for (const rejected of [
    'https://img.classistatic.de/other/photo.jpg',
    'https://img.classistatic.de/api/v1/mo-prod/images/',
    'https://fake.img.classistatic.de/api/v1/mo-prod/images/abc',
    'https://img.classistatic.de.evil.test/api/v1/mo-prod/images/abc',
    'http://img.classistatic.de/api/v1/mo-prod/images/abc',
    'https://img.classistatic.de:8443/api/v1/mo-prod/images/abc',
    'https://user:password@img.classistatic.de/api/v1/mo-prod/images/abc',
    'https://127.0.0.1/photo.jpg',
  ]) assert.throws(() => assertSafeImageUrl(rejected), /image_url_/);
});

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
