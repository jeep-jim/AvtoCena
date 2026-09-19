import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { loadPublicRates } from '../apps/web/lib/catalog/public-rates-client';
import { loadPublicRateExtras } from '../apps/web/lib/catalog/public-rates';
import { LocalJsonStorage } from '../apps/web/lib/data';

test('rate widgets share requests, refresh after TTL and recover after failure', async () => {
  let now = 1_000_000;
  const clock = mock.method(Date, 'now', () => now);
  let calls = 0;
  let fail = false;
  const request = mock.method(globalThis, 'fetch', async (url: any) => {
    assert.equal(url, '/api/catalog/rates');
    calls++;
    if (fail) return new Response('', { status: 503 });
    return Response.json({ rates: [{ currency: 'JPY', effectiveRate: calls / 2 }] });
  });
  try {
    const [a,b,c] = await Promise.all([loadPublicRates(),loadPublicRates(),loadPublicRates()]);
    assert.deepEqual(a,b); assert.deepEqual(b,c); assert.equal(calls,1);
    await loadPublicRates(); assert.equal(calls,1);
    now += 900_001; fail = true;
    await assert.rejects(loadPublicRates()); assert.equal(calls,2);
    fail = false;
    assert.equal((await loadPublicRates())[0].effectiveRate,1.5);
    assert.equal(calls,3);
  } finally { request.mock.restore(); clock.mock.restore(); }
});

test('public rates share storage/history reads and never read the vehicle catalog', async () => {
  let reads = 0;
  const read = mock.method(LocalJsonStorage.prototype, 'readJsonWithMeta', async (key: string) => {
    assert.equal(key,'fees/exchange-rates.json'); reads++;
    return { found:true, value:{ rates:[{currency:'JPY',effectiveRate:0.5},{currency:'GEL',effectiveRate:30}] } };
  });
  let historyReads = 0;
  const request = mock.method(globalThis, 'fetch', async (url: any) => {
    assert.equal(new URL(String(url)).hostname,'www.cbr.ru'); historyReads++;
    return new Response('<ValCurs Date="19.09.2026"><Valute><CharCode>JPY</CharCode><Nominal>100</Nominal><Value>50,00</Value></Valute></ValCurs>');
  });
  try {
    const [a,b] = await Promise.all([loadPublicRateExtras(),loadPublicRateExtras()]);
    assert.deepEqual(a,b); assert.equal(a.rates.find(r=>r.currency==='JPY')?.effectiveRate,0.5);
    assert.equal(reads,1); assert.equal(historyReads,14);
    await loadPublicRateExtras(); assert.equal(reads,1); assert.equal(historyReads,14);
  } finally { request.mock.restore(); read.mock.restore(); }
});
