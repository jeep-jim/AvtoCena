import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rawDigest} from '../scripts/lib/catalog-raw-provenance.mjs';
import {ownedChinaFrozenFx} from '../scripts/lib/owned-china-frozen-pricing.mjs';

const capturedAt='2026-11-22T21:14:00.000Z',observedAt='2026-11-22T21:34:55.563Z';
function prepared(){
  const rates=Object.fromEntries(['CNY','EUR','RUB','USD'].map(currency=>[currency,{currency,cbrRate:currency==='RUB'?1:123,
    nominal:currency==='RUB'?1:10,effectiveRate:currency==='RUB'?1:12.3,rateSource:currency==='RUB'?'cbr':'cbr_live',rateDate:'2026-11-22'}]));
  const snapshot={version:1,market:'china',runId:'43722',capturedAt,rates};
  return {rates:snapshot,plan:{source:{observedAt:Date.parse(observedAt)},evidence:{rateSnapshot:{sha256:rawDigest(snapshot)},
    prepared:{rateRun:'43722'},download:{sourceObservedAt:observedAt}}}};
}
test('preserves the rate, nominal and original timestamps from the authenticated batch',()=>{
 const data=prepared(),wire=ownedChinaFrozenFx(data,randomUUID());
 assert.deepEqual(wire.receipt.rates,data.rates.rates);assert.equal(wire.receipt.pricingAsOf,capturedAt);
 assert.equal(wire.receipt.observedAt,observedAt);assert.equal(wire.receiptSha256,rawDigest(wire.receipt));
});
test('a changed archive, a preliminary or absent currency, an inverted clock and an incorrect nominal are refused',()=>{
 const unbound=prepared();unbound.rates.rates.CNY.nominal=100;
 assert.throws(()=>ownedChinaFrozenFx(unbound,randomUUID()),/archive_digest/);
 for(const change of [d=>delete d.rates.rates.RUB,d=>d.rates.rates.CNY.rateSource='fallback_env',
  d=>d.rates.rates.USD.nominal=1,d=>d.rates.capturedAt='2026-11-23T00:00:00.000Z']){
  const d=prepared();change(d);d.plan.evidence.rateSnapshot.sha256=rawDigest(d.rates);
  assert.throws(()=>ownedChinaFrozenFx(d,randomUUID()));
 }
});
