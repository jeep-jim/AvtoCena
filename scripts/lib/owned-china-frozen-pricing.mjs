import assert from 'node:assert/strict';
import {rawDigest} from './catalog-raw-provenance.mjs';

const currencies = ['CNY','EUR','RUB','USD'];

// Only a verified owned-feed receipt supplies the rates and both clock bounds.
// The native receipt's UUID identifies this transformation, not the downloader.
export function ownedChinaFrozenFx(prepared, transportId) {
  const {rates:snapshot, plan} = prepared;
  assert.equal(rawDigest(snapshot), plan.evidence.rateSnapshot.sha256, 'owned_fx_archive_digest');
  assert.equal(snapshot.runId,plan.evidence.prepared.rateRun,'owned_fx_run');
  assert.equal(snapshot.market,'china');
  assert(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(transportId),'owned_fx_transport');
  const pricingAsOf = snapshot.capturedAt;
  const observedAt = plan.evidence.download.sourceObservedAt;
  assert(new Date(pricingAsOf).toISOString()===pricingAsOf && new Date(observedAt).toISOString()===observedAt &&
    pricingAsOf<=observedAt && Date.parse(observedAt)===plan.source.observedAt,'owned_fx_clock');
  const rates = Object.fromEntries(currencies.map(code=>{
    const quote=snapshot.rates[code];
    assert(quote?.currency===code && ['cbr','cbr_live'].includes(quote.rateSource) &&
      /^\d{4}-\d{2}-\d{2}$/.test(quote.rateDate) && Date.parse(quote.rateDate)<=Date.parse(observedAt)+86400000 &&
      [quote.nominal,quote.cbrRate,quote.effectiveRate].every(n=>Number.isFinite(n)&&n>0) &&
      quote.effectiveRate===quote.cbrRate/quote.nominal && (code!=='RUB'||quote.effectiveRate===1),
      'owned_fx_official_quote_'+code);
    return [code, structuredClone(quote)];
  }));
  const receipt={version:1,market:'china',runId:transportId,pricingAsOf,observedAt,rates};
  return {receipt,receiptSha256:rawDigest(receipt)};
}
